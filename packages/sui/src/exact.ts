import {
  type ExactSuiExtra,
  type ExactSuiPayload,
  type PaymentRequirements,
  bytesToBase64,
  normalizeAddress,
  normalizeCoinType,
} from '@blockpay402/core';
import type { Signer } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import type { SuiClient } from './client.js';

export type GasMode = 'auto' | 'gasless' | 'sponsored' | 'self';

/**
 * Budget for sponsored transactions (MIST). Setting it skips node-side gas selection, so the
 * sponsor pays from its address balance and only the gas actually used is charged.
 */
export const SPONSORED_GAS_BUDGET = 10_000_000n;

/**
 * The `exact` payment transaction: move `amount` of `asset` into `payTo`'s address balance.
 * `tx.balance()` draws from the payer's address balance first, then owned coins.
 */
export function buildExactTransaction(params: {
  sender: string;
  requirements: PaymentRequirements;
  gas: Exclude<GasMode, 'auto'>;
}): Transaction {
  const { sender, requirements, gas } = params;
  const coinType = normalizeCoinType(requirements.asset);
  const extra = (requirements.extra ?? {}) as ExactSuiExtra;
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: '0x2::balance::send_funds',
    typeArguments: [coinType],
    arguments: [
      // Never fund the payment from the gas coin: when sponsored, it belongs to the sponsor.
      tx.balance({ type: coinType, balance: BigInt(requirements.amount), useGasCoin: gas === 'self' }),
      tx.pure.address(normalizeAddress(requirements.payTo)),
    ],
  });
  if (gas === 'sponsored') {
    if (!extra.feePayer) throw new Error('Requirements do not offer a gas sponsor (extra.feePayer)');
    tx.setGasOwner(normalizeAddress(extra.feePayer));
    // Empty payment: the sponsor pays from its address balance, so no interactive coin selection.
    tx.setGasPayment([]);
    tx.setGasBudget(SPONSORED_GAS_BUDGET);
  } else if (gas === 'gasless') {
    tx.setGasPrice(0);
    tx.setGasPayment([]);
  }
  return tx;
}

export function chooseGasMode(requirements: PaymentRequirements, preferred: GasMode = 'auto'): Exclude<GasMode, 'auto'> {
  if (preferred !== 'auto') return preferred;
  const extra = (requirements.extra ?? {}) as ExactSuiExtra;
  if (extra.gasless) return 'gasless';
  if (extra.feePayer) return 'sponsored';
  return 'self';
}

/** Build and sign an `exact` payment. The facilitator only broadcasts what the payer signed. */
export async function createExactPayment(params: {
  client: SuiClient;
  signer: Signer;
  requirements: PaymentRequirements;
  gas?: GasMode;
}): Promise<ExactSuiPayload> {
  const { client, signer, requirements } = params;
  const tx = buildExactTransaction({
    sender: signer.toSuiAddress(),
    requirements,
    gas: chooseGasMode(requirements, params.gas),
  });
  const bytes = await tx.build({ client });
  const { signature } = await signer.signTransaction(bytes);
  return { transaction: bytesToBase64(bytes), signature };
}
