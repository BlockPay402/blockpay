import { CHANNEL_DEPLOYMENTS } from './deployments.js';
import type { SuiNetwork } from './types.js';

export interface ChannelDeployment {
  packageId: string;
  /** Registry shard 0. Identifies the deployment in `batch-settlement` requirements (`channelRegistry`). */
  registryId: string;
  /**
   * Every registry shard, in shard order (`registryIds[0]` is `registryId`). Payers are spread
   * across shards so channel opens do not all contend on one shared object. Absent: one registry.
   */
  registryIds?: readonly string[];
}

export interface SuiNetworkConfig {
  network: SuiNetwork;
  /** Name accepted by `SuiGrpcClient({ network })`. */
  name: 'mainnet' | 'testnet' | 'devnet' | 'localnet';
  grpcUrl: string;
  graphqlUrl?: string;
  explorerTxUrl?: string;
  /** `blockpay::channel` deployment, when published on this network. */
  channel?: ChannelDeployment;
}

export const SUI_NETWORKS: Record<SuiNetwork, SuiNetworkConfig> = {
  'sui:mainnet': {
    network: 'sui:mainnet',
    name: 'mainnet',
    grpcUrl: 'https://fullnode.mainnet.sui.io:443',
    graphqlUrl: 'https://graphql.mainnet.sui.io/graphql',
    explorerTxUrl: 'https://suiscan.xyz/mainnet/tx/',
  },
  'sui:testnet': {
    network: 'sui:testnet',
    name: 'testnet',
    grpcUrl: 'https://fullnode.testnet.sui.io:443',
    graphqlUrl: 'https://graphql.testnet.sui.io/graphql',
    explorerTxUrl: 'https://suiscan.xyz/testnet/tx/',
  },
  'sui:devnet': {
    network: 'sui:devnet',
    name: 'devnet',
    grpcUrl: 'https://fullnode.devnet.sui.io:443',
    explorerTxUrl: 'https://suiscan.xyz/devnet/tx/',
  },
  'sui:localnet': {
    network: 'sui:localnet',
    name: 'localnet',
    grpcUrl: 'http://127.0.0.1:9000',
  },
};

export function isSuiNetwork(network: string): network is SuiNetwork {
  return network in SUI_NETWORKS;
}

/** Network config with caller overrides applied (custom RPC, local channel deployment, …). */
export function resolveNetwork(
  network: SuiNetwork,
  overrides: Partial<Omit<SuiNetworkConfig, 'network' | 'name'>> = {},
): SuiNetworkConfig {
  const base = SUI_NETWORKS[network];
  if (!base) throw new Error(`Unsupported network: ${network}`);
  const channel = CHANNEL_DEPLOYMENTS[network];
  return { ...base, ...(channel ? { channel } : {}), ...stripUndefined(overrides) };
}

/** Accepts the CAIP-2 id or the short names used by Sui tooling (`testnet`, `sui-testnet`). */
export function toSuiNetwork(value: string): SuiNetwork {
  const short = value.replace(/^sui[:-]/, '');
  const network = `sui:${short}`;
  if (!isSuiNetwork(network)) throw new Error(`Unsupported Sui network: ${value}`);
  return network;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
