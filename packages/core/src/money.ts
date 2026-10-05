import { defaultUsdAsset, resolveAsset, type AssetInfo } from './assets.js';
import type { SuiNetwork } from './types.js';

/**
 * A price as integrators write it:
 * - `"$0.001"` or `0.001` — US dollars, paid in the network's USD stablecoin (USDC)
 * - `{ amount: "1000", asset: "USDC" }` — atomic units of a known asset
 * - `{ amount: "1000", asset: "0x…::coin::COIN", decimals: 6 }` — any coin type
 */
export type Price =
  | `$${string}`
  | number
  | { amount: string | bigint; asset: string; decimals?: number };

export interface ResolvedPrice {
  amount: string;
  asset: AssetInfo;
}

export function resolvePrice(network: SuiNetwork, price: Price): ResolvedPrice {
  if (typeof price === 'number' || typeof price === 'string') {
    const usd = typeof price === 'number' ? numberToDecimal(price) : price.slice(1);
    const asset = defaultUsdAsset(network);
    if (!asset) {
      throw new Error(`No USD stablecoin registered for ${network}; use { amount, asset } instead`);
    }
    return { amount: toAtomic(usd, asset.decimals), asset };
  }
  const asset = resolveAsset(network, price.asset, price.decimals);
  const amount = BigInt(price.amount);
  if (amount < 0n) throw new Error('Price must not be negative');
  return { amount: amount.toString(), asset };
}

/** `toAtomic("0.001", 6) === "1000"`. Rejects precision the asset cannot represent. */
export function toAtomic(value: string, decimals: number): string {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid decimal amount: "${value}"`);
  const [, whole = '0', fraction = ''] = match;
  const trimmed = fraction.replace(/0+$/, '');
  if (trimmed.length > decimals) {
    throw new Error(`"${value}" has more than ${decimals} decimal places`);
  }
  return BigInt(whole + trimmed.padEnd(decimals, '0')).toString();
}

/** `fromAtomic("1000", 6) === "0.001"`. */
export function fromAtomic(amount: string | bigint, decimals: number): string {
  const value = BigInt(amount);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function numberToDecimal(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid price: ${value}`);
  // toFixed avoids exponent notation (1e-7) for small prices.
  return value.toFixed(12).replace(/\.?0+$/, '');
}
