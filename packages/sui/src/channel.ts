import {
  type ChannelDeployment,
  base64ToBytes,
  bytesToBase64,
  normalizeAddress,
  normalizeCoinType,
} from '@blockpay402/core';
import { bcs } from '@mysten/sui/bcs';
import { Ed25519Keypair, Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { SUI_CLOCK_OBJECT_ID, deriveObjectID } from '@mysten/sui/utils';
import type { SuiClient } from './client.js';
import { SPONSORED_GAS_BUDGET } from './exact.js';

const VOUCHER_DOMAIN = new TextEncoder().encode('blockpay/channel/voucher/v1');

// --- Vouchers ---------------------------------------------------------------

/** Bytes a voucher key signs. Must match `blockpay::channel::voucher_message`. */
export function voucherMessage(channelId: string, cumulativeAmount: bigint | string): Uint8Array {
  const id = bcs.Address.serialize(normalizeAddress(channelId)).toBytes();
  const amount = bcs.u64().serialize(BigInt(cumulativeAmount)).toBytes();
  const message = new Uint8Array(VOUCHER_DOMAIN.length + id.length + amount.length);
  message.set(VOUCHER_DOMAIN, 0);
  message.set(id, VOUCHER_DOMAIN.length);
  message.set(amount, VOUCHER_DOMAIN.length + id.length);
  return message;
}

export async function signVoucher(
  authorizer: Ed25519Keypair,
  channelId: string,
  cumulativeAmount: bigint | string,
): Promise<string> {
  return bytesToBase64(await authorizer.sign(voucherMessage(channelId, cumulativeAmount)));
}

export async function verifyVoucher(params: {
  authorizer: Uint8Array;
  channelId: string;
  cumulativeAmount: bigint | string;
  signature: string;
}): Promise<boolean> {
  try {
    const key = new Ed25519PublicKey(params.authorizer);
    return await key.verify(
      voucherMessage(params.channelId, params.cumulativeAmount),
      base64ToBytes(params.signature),
    );
  } catch {
    return false;
  }
}

// --- IDs --------------------------------------------------------------------

const ChannelKeyBcs = bcs.struct('ChannelKey', { payer: bcs.Address, nonce: bcs.u64() });

/** The registry shard a payer opens channels in: stable per payer, spread evenly across shards. */
export function registryFor(deployment: ChannelDeployment, payer: string): string {
  const shards = deployment.registryIds;
  if (!shards?.length) return deployment.registryId;
  return shards[Number(BigInt(normalizeAddress(payer)) % BigInt(shards.length))]!;
}

/** The ID `blockpay::channel::open` will assign, known before the transaction runs. */
export function deriveChannelId(deployment: ChannelDeployment, payer: string, nonce: bigint): string {
  const key = ChannelKeyBcs.serialize({ payer: normalizeAddress(payer), nonce }).toBytes();
  return deriveObjectID(
    registryFor(deployment, payer),
    `${normalizeAddress(deployment.packageId)}::channel::ChannelKey`,
    key,
  );
}

export function randomNonce(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return new DataView(bytes.buffer).getBigUint64(0, true);
}

// --- On-chain state ----------------------------------------------------------

const ChannelBcs = bcs.struct('Channel', {
  id: bcs.Address,
  payer: bcs.Address,
  payee: bcs.Address,
  operator: bcs.Address,
  authorizer: bcs.byteVector(),
  funds: bcs.u64(),
  deposited: bcs.u64(),
  claimed: bcs.u64(),
  withdraw_delay_ms: bcs.u64(),
  close_requested_at_ms: bcs.option(bcs.u64()),
});

export const ChannelOpenedBcs = bcs.struct('ChannelOpened', {
  channel_id: bcs.Address,
  payer: bcs.Address,
  payee: bcs.Address,
  operator: bcs.Address,
  authorizer: bcs.byteVector(),
  nonce: bcs.u64(),
  deposit: bcs.u64(),
  withdraw_delay_ms: bcs.u64(),
});

export const ChannelToppedUpBcs = bcs.struct('ChannelToppedUp', {
  channel_id: bcs.Address,
  amount: bcs.u64(),
  deposited: bcs.u64(),
});

export const ChannelClaimedBcs = bcs.struct('ChannelClaimed', {
  channel_id: bcs.Address,
  payee: bcs.Address,
  amount: bcs.u64(),
  claimed: bcs.u64(),
});

export interface ChannelState {
  id: string;
  coinType: string;
  payer: string;
  payee: string;
  operator: string;
  authorizer: Uint8Array;
  balance: bigint;
  deposited: bigint;
  claimed: bigint;
  withdrawDelayMs: bigint;
  closeRequestedAtMs: bigint | null;
}

/**
 * Read a channel of the `blockpay::channel` package `packageId`. Returns `null` when it does not
 * exist (never opened, or closed) or when the object is not a `Channel` of that package: anyone can
 * publish a look-alike `channel::Channel` with the same layout, so the package must be pinned.
 */
export async function getChannel(client: SuiClient, channelId: string, packageId: string): Promise<ChannelState | null> {
  const { objects } = await client.core.getObjects({ objectIds: [channelId], include: { content: true } });
  const object = objects[0];
  if (!object || object instanceof Error || !object.content) return null;
  const coinType = parseChannelCoinType(object.type, packageId);
  if (!coinType) return null;
  const raw = ChannelBcs.parse(object.content);
  return {
    id: normalizeAddress(raw.id),
    coinType,
    payer: normalizeAddress(raw.payer),
    payee: normalizeAddress(raw.payee),
    operator: normalizeAddress(raw.operator),
    authorizer: Uint8Array.from(raw.authorizer),
    balance: BigInt(raw.funds),
    deposited: BigInt(raw.deposited),
    claimed: BigInt(raw.claimed),
    withdrawDelayMs: BigInt(raw.withdraw_delay_ms),
    closeRequestedAtMs: raw.close_requested_at_ms == null ? null : BigInt(raw.close_requested_at_ms),
  };
}

/** `0xpkg::channel::Channel<0x…::usdc::USDC>` → normalized coin type, or `null` unless `pkg` is `packageId`. */
export function parseChannelCoinType(type: string, packageId: string): string | null {
  const match = /^(0x[0-9a-f]+)::channel::Channel<(.+)>$/i.exec(type);
  if (!match?.[1] || !match[2]) return null;
  if (normalizeAddress(match[1]) !== normalizeAddress(packageId)) return null;
  return normalizeCoinType(match[2]);
}

/** Coin type of a `ChannelOpened<T>`-style event type. */
export function parseEventCoinType(eventType: string): string | null {
  const match = /<(.+)>$/.exec(eventType);
  return match?.[1] ? normalizeCoinType(match[1]) : null;
}

// --- Transactions ------------------------------------------------------------

const target = (deployment: ChannelDeployment, fn: string) =>
  `${normalizeAddress(deployment.packageId)}::channel::${fn}` as const;

function applySponsor(tx: Transaction, feePayer?: string) {
  if (!feePayer) return;
  tx.setGasOwner(normalizeAddress(feePayer));
  tx.setGasPayment([]);
  tx.setGasBudget(SPONSORED_GAS_BUDGET);
}

export function buildOpenChannelTransaction(params: {
  deployment: ChannelDeployment;
  sender: string;
  coinType: string;
  payee: string;
  operator: string;
  authorizer: Uint8Array;
  withdrawDelayMs: number | bigint;
  nonce: bigint;
  deposit: bigint;
  feePayer?: string;
}): Transaction {
  const coinType = normalizeCoinType(params.coinType);
  const tx = new Transaction();
  tx.setSender(normalizeAddress(params.sender));
  tx.moveCall({
    target: target(params.deployment, 'open'),
    typeArguments: [coinType],
    arguments: [
      tx.object(registryFor(params.deployment, params.sender)),
      tx.pure.address(normalizeAddress(params.payee)),
      tx.pure.address(normalizeAddress(params.operator)),
      tx.pure.vector('u8', Array.from(params.authorizer)),
      tx.pure.u64(params.withdrawDelayMs),
      tx.pure.u64(params.nonce),
      tx.balance({ type: coinType, balance: params.deposit, useGasCoin: !params.feePayer }),
    ],
  });
  applySponsor(tx, params.feePayer);
  return tx;
}

export function buildTopUpTransaction(params: {
  deployment: ChannelDeployment;
  sender: string;
  coinType: string;
  channelId: string;
  amount: bigint;
  feePayer?: string;
}): Transaction {
  const coinType = normalizeCoinType(params.coinType);
  const tx = new Transaction();
  tx.setSender(normalizeAddress(params.sender));
  tx.moveCall({
    target: target(params.deployment, 'top_up'),
    typeArguments: [coinType],
    arguments: [
      tx.object(params.channelId),
      tx.balance({ type: coinType, balance: params.amount, useGasCoin: !params.feePayer }),
    ],
  });
  applySponsor(tx, params.feePayer);
  return tx;
}

export interface ClaimInput {
  channelId: string;
  coinType: string;
  cumulativeAmount: bigint | string;
  signature: string;
  /** Also close the channel and refund the payer (sender must be payee or operator). */
  close?: boolean;
}

/** Redeem many vouchers in one transaction. */
export function buildClaimTransaction(deployment: ChannelDeployment, claims: ClaimInput[]): Transaction {
  const tx = new Transaction();
  for (const claim of claims) {
    const coinType = normalizeCoinType(claim.coinType);
    const channel = tx.object(claim.channelId);
    tx.moveCall({
      target: target(deployment, 'claim'),
      typeArguments: [coinType],
      arguments: [
        channel,
        tx.pure.u64(BigInt(claim.cumulativeAmount)),
        tx.pure.vector('u8', Array.from(base64ToBytes(claim.signature))),
      ],
    });
    if (claim.close) {
      tx.moveCall({ target: target(deployment, 'close'), typeArguments: [coinType], arguments: [channel] });
    }
  }
  return tx;
}

export function buildCloseTransaction(deployment: ChannelDeployment, channelId: string, coinType: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(deployment, 'close'),
    typeArguments: [normalizeCoinType(coinType)],
    arguments: [tx.object(channelId)],
  });
  return tx;
}

export function buildRequestCloseTransaction(deployment: ChannelDeployment, channelId: string, coinType: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(deployment, 'request_close'),
    typeArguments: [normalizeCoinType(coinType)],
    arguments: [tx.object(channelId), tx.object(SUI_CLOCK_OBJECT_ID)],
  });
  return tx;
}

export function buildWithdrawTransaction(deployment: ChannelDeployment, channelId: string, coinType: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(deployment, 'withdraw'),
    typeArguments: [normalizeCoinType(coinType)],
    arguments: [tx.object(channelId), tx.object(SUI_CLOCK_OBJECT_ID)],
  });
  return tx;
}

export { Ed25519Keypair };
