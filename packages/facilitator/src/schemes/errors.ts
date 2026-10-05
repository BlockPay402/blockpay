import { ErrorReason } from '@blockpay402/core';

/** Map a failed execution status to an x402 reason. */
export function executionFailureReason(status: { success: boolean; error?: unknown }): string {
  const text = JSON.stringify(status.error ?? '').toLowerCase();
  if (text.includes('insufficient') || text.includes('balance')) return ErrorReason.insufficientFunds;
  return ErrorReason.invalidTransactionState;
}

/** Network-level failures where a broadcast may still have landed. */
export function isTransientError(error: unknown): boolean {
  const text = String((error as Error)?.message ?? error).toLowerCase();
  return /timeout|timed out|abort|deadline|unavailable|econnreset|socket|network|fetch failed|503|504/.test(text);
}

/**
 * Simulate exactly the bytes that were signed: never let the node re-select gas.
 * (`doGasSelection` is a gRPC-transport option, so it is typed loosely.)
 */
export const verbatimSimulation = { doGasSelection: false } as {};

/** Upper bound for broadcasting; keeps /settle well inside a resource server's HTTP timeout. */
export const EXECUTION_TIMEOUT_MS = 20_000;
