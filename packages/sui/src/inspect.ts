import { base64ToBytes, normalizeAddress } from '@blockpay402/core';
import { Transaction } from '@mysten/sui/transactions';

export interface ParsedTransaction {
  bytes: Uint8Array;
  digest: string;
  sender: string;
  gasOwner: string;
  gasPayment: readonly unknown[];
  gasBudget: bigint;
  gasPrice: bigint;
  data: ReturnType<Transaction['getData']>;
}

/** Decode base64 BCS `TransactionData` and compute its digest offline. */
export async function parseTransaction(base64: string): Promise<ParsedTransaction> {
  const bytes = base64ToBytes(base64);
  const tx = Transaction.from(bytes);
  const data = tx.getData();
  if (!data.sender) throw new Error('Transaction has no sender');
  const sender = normalizeAddress(data.sender);
  return {
    bytes,
    digest: await tx.getDigest(),
    sender,
    gasOwner: normalizeAddress(data.gasData.owner ?? sender),
    gasPayment: data.gasData.payment ?? [],
    gasBudget: BigInt(data.gasData.budget ?? 0),
    gasPrice: BigInt(data.gasData.price ?? 0),
    data,
  };
}

/**
 * A sponsor must not pay for arbitrary programs. Accept only framework coin/balance
 * operations, plus calls into explicitly allowed packages (e.g. `blockpay::channel`).
 */
export function checkSponsorableCommands(
  data: ParsedTransaction['data'],
  allowedTargets: readonly string[] = [],
  maxCommands = 16,
): string | null {
  if (data.commands.length > maxCommands) return `Sponsored transactions are limited to ${maxCommands} commands`;
  const allowed = new Set(allowedTargets.map(normalizeTarget));
  for (const command of data.commands) {
    switch (command.$kind) {
      case 'MoveCall': {
        const call = command.MoveCall;
        const fqn = normalizeTarget(`${call.package}::${call.module}::${call.function}`);
        const isFramework =
          normalizeAddress(call.package) === normalizeAddress('0x2') &&
          (call.module === 'balance' || call.module === 'coin') &&
          FRAMEWORK_FUNCTIONS.has(call.function);
        if (!isFramework && !allowed.has(fqn)) return `Move call ${fqn} is not sponsorable`;
        break;
      }
      case 'SplitCoins':
      case 'MergeCoins':
      case 'TransferObjects':
        break;
      default:
        return `${command.$kind} commands are not sponsorable`;
    }
    if (JSON.stringify(command).includes('"GasCoin"')) return 'Sponsored transactions must not use the gas coin';
  }
  return null;
}

const FRAMEWORK_FUNCTIONS = new Set([
  'send_funds',
  'redeem_funds',
  'into_balance',
  'from_balance',
  'split',
  'join',
  'zero',
  'destroy_zero',
]);

function normalizeTarget(value: string): string {
  const [pkg, ...rest] = value.split('::');
  return [normalizeAddress(pkg ?? ''), ...rest].join('::');
}
