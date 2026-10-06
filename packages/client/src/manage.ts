import { type ChannelDeployment, type SuiNetwork, resolveNetwork } from '@blockpay402/core';
import {
  type ChannelState,
  buildRequestCloseTransaction,
  buildWithdrawTransaction,
  getChannel,
} from '@blockpay402/sui';
import { Transaction } from '@mysten/sui/transactions';
import type { PaymentClient } from './payment-client.js';

export type ExitStatus =
  | { state: 'closed' }
  | { state: 'requested'; withdrawableAtMs: bigint; digest?: string }
  | { state: 'withdrawn'; digest: string };

/**
 * Recover a channel's unspent deposit without the facilitator: request a close, then
 * call again after the withdraw delay to withdraw. The payee can still redeem vouchers
 * it already holds during the delay.
 */
export async function exitChannel(
  client: PaymentClient,
  params: { network: SuiNetwork; channelId: string; deployment?: ChannelDeployment },
): Promise<ExitStatus> {
  const sui = client.client(params.network);
  const deployment = params.deployment ?? resolveNetwork(params.network).channel;
  if (!deployment) throw new Error(`No channel deployment configured for ${params.network}`);
  const channel: ChannelState | null = await getChannel(sui, params.channelId, deployment.packageId);
  if (!channel) return { state: 'closed' };

  if (channel.closeRequestedAtMs == null) {
    const tx = buildRequestCloseTransaction(deployment, channel.id, channel.coinType);
    const result = await sui.core.signAndExecuteTransaction({ transaction: tx, signer: client.signer });
    if (result.$kind === 'FailedTransaction') throw new Error(`request_close failed: ${result.FailedTransaction.digest}`);
    await sui.core.waitForTransaction({ result });
    const refreshed = await getChannel(sui, params.channelId, deployment.packageId);
    return {
      state: 'requested',
      withdrawableAtMs: (refreshed?.closeRequestedAtMs ?? BigInt(Date.now())) + channel.withdrawDelayMs,
      digest: result.Transaction.digest,
    };
  }
  const withdrawableAtMs = channel.closeRequestedAtMs + channel.withdrawDelayMs;
  if (BigInt(Date.now()) < withdrawableAtMs) return { state: 'requested', withdrawableAtMs };
  const tx = buildWithdrawTransaction(deployment, channel.id, channel.coinType);
  const result = await sui.core.signAndExecuteTransaction({ transaction: tx, signer: client.signer });
  if (result.$kind === 'FailedTransaction') throw new Error(`withdraw failed: ${result.FailedTransaction.digest}`);
  await sui.core.waitForTransaction({ result });
  return { state: 'withdrawn', digest: result.Transaction.digest };
}

/**
 * Move all coin objects of `coinType` into the payer's address balance. Payments drawn from
 * an address balance do not depend on coin versions, so many can be built and run in parallel.
 */
export async function depositCoinsToAddressBalance(
  client: PaymentClient,
  params: { network: SuiNetwork; coinType: string },
): Promise<string | null> {
  const sui = client.client(params.network);
  const { objects } = await sui.core.listCoins({ owner: client.address, coinType: params.coinType });
  const isSui = /^0x0*2::sui::SUI$/.test(params.coinType);
  // For SUI keep the gas coin; it pays for this transaction.
  const coins = isSui ? objects.slice(1) : objects;
  if (coins.length === 0) return null;
  const tx = new Transaction();
  const [first, ...rest] = coins.map((c) => tx.object(c.objectId));
  if (rest.length) tx.mergeCoins(first!, rest);
  tx.moveCall({
    target: '0x2::coin::send_funds',
    typeArguments: [params.coinType],
    arguments: [first!, tx.pure.address(client.address)],
  });
  const result = await sui.core.signAndExecuteTransaction({ transaction: tx, signer: client.signer });
  if (result.$kind === 'FailedTransaction') throw new Error(`deposit failed: ${result.FailedTransaction.digest}`);
  await sui.core.waitForTransaction({ result });
  return result.Transaction.digest;
}
