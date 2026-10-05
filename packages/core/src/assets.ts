import type { SuiNetwork } from './types.js';

export interface AssetInfo {
  symbol: string;
  coinType: string;
  decimals: number;
  /** Network-level gasless transfers (Sui Address Balances) apply to this coin. */
  gasless?: boolean;
  /** Pegged to USD: `$`-denominated prices resolve to it. */
  usd?: boolean;
}

const SUI: AssetInfo = {
  symbol: 'SUI',
  coinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  decimals: 9,
};

/** Known assets per network. Callers can register more with {@link registerAsset}. */
const ASSETS: Record<SuiNetwork, AssetInfo[]> = {
  'sui:mainnet': [
    {
      symbol: 'USDC',
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      decimals: 6,
      gasless: true,
      usd: true,
    },
    SUI,
  ],
  'sui:testnet': [
    {
      symbol: 'USDC',
      coinType: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
      decimals: 6,
      gasless: true,
      usd: true,
    },
    SUI,
  ],
  'sui:devnet': [SUI],
  'sui:localnet': [SUI],
};

/** Minimum amount, in whole units, for a network-sponsored gasless stablecoin transfer. */
export const GASLESS_MIN_UNITS = '0.01';

export function registerAsset(network: SuiNetwork, asset: AssetInfo): void {
  const list = ASSETS[network];
  const normalized = { ...asset, coinType: normalizeCoinType(asset.coinType) };
  const index = list.findIndex(
    (a) => a.symbol === normalized.symbol || a.coinType === normalized.coinType,
  );
  if (index >= 0) list[index] = normalized;
  else list.push(normalized);
}

export function listAssets(network: SuiNetwork): readonly AssetInfo[] {
  return ASSETS[network];
}

/** Resolve `USDC`, `SUI` or a full coin type to asset info. Unknown coin types need `decimals`. */
export function resolveAsset(network: SuiNetwork, asset: string, decimals?: number): AssetInfo {
  const list = ASSETS[network];
  const bySymbol = list.find((a) => a.symbol.toLowerCase() === asset.toLowerCase());
  if (bySymbol) return bySymbol;
  if (!asset.includes('::')) throw new Error(`Unknown asset "${asset}" on ${network}`);
  const coinType = normalizeCoinType(asset);
  const byType = list.find((a) => a.coinType === coinType);
  if (byType) return byType;
  if (decimals === undefined) {
    throw new Error(`Unknown coin type ${coinType} on ${network}: pass "decimals" or registerAsset()`);
  }
  return { symbol: coinType.split('::').pop() ?? coinType, coinType, decimals };
}

export function findAssetByType(network: SuiNetwork, coinType: string): AssetInfo | undefined {
  const normalized = normalizeCoinType(coinType);
  return ASSETS[network].find((a) => a.coinType === normalized);
}

export function defaultUsdAsset(network: SuiNetwork): AssetInfo | undefined {
  return ASSETS[network].find((a) => a.usd);
}

/** Pad the address part of a coin type to 32 bytes so types compare reliably. */
export function normalizeCoinType(coinType: string): string {
  const [address, ...rest] = coinType.split('::');
  if (!address || rest.length < 2) throw new Error(`Invalid coin type: ${coinType}`);
  return [normalizeAddress(address), ...rest].join('::');
}

export function normalizeAddress(address: string): string {
  const hex = address.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{1,64}$/.test(hex)) throw new Error(`Invalid Sui address: ${address}`);
  return `0x${hex.padStart(64, '0')}`;
}
