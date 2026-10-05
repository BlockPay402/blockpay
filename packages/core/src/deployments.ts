import type { ChannelDeployment } from './networks.js';
import type { SuiNetwork } from './types.js';

/**
 * Canonical `blockpay::channel` deployments. Clients trust these for `batch-settlement`
 * without extra configuration. Fill in from `deployments/<network>.json` after
 * `pnpm contract:publish <network>`, then release the SDK.
 */
export const CHANNEL_DEPLOYMENTS: Partial<Record<SuiNetwork, ChannelDeployment>> = {
  'sui:testnet': { packageId: '0x84443af24c3b4fdfc5dc3df15d1cb11c6c0f00434890d58cf0188c6a5eb8083e', registryId: '0x96dbbded5ab4bf48bfc3643b57ef1d18c156b28475506e8a182564f25ddab228' },
  // 'sui:mainnet': { packageId: '0x…', registryId: '0x…' },
};
