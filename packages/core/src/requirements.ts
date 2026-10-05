import { normalizeAddress, normalizeCoinType } from './assets.js';
import type { PaymentRequirements } from './types.js';

/**
 * Whether the requirements a client says it accepted are the ones the server offers.
 * Addresses and coin types are compared in normalized form; `extra` must match exactly.
 */
export function requirementsMatch(a: PaymentRequirements, b: PaymentRequirements): boolean {
  return (
    a.scheme === b.scheme &&
    a.network === b.network &&
    a.amount === b.amount &&
    a.maxTimeoutSeconds === b.maxTimeoutSeconds &&
    sameCoinType(a.asset, b.asset) &&
    sameAddress(a.payTo, b.payTo) &&
    stableStringify(a.extra ?? {}) === stableStringify(b.extra ?? {})
  );
}

export function findMatchingRequirements(
  accepts: readonly PaymentRequirements[],
  accepted: PaymentRequirements,
): PaymentRequirements | undefined {
  return accepts.find((r) => requirementsMatch(r, accepted));
}

export function sameAddress(a: string, b: string): boolean {
  try {
    return normalizeAddress(a) === normalizeAddress(b);
  } catch {
    return false;
  }
}

export function sameCoinType(a: string, b: string): boolean {
  try {
    return normalizeCoinType(a) === normalizeCoinType(b);
  } catch {
    return false;
  }
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
