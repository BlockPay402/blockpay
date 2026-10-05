import type { ChannelDeployment } from './networks.js';
import type { SuiNetwork } from './types.js';

/**
 * Canonical `blockpay::channel` deployments. Clients trust these for `batch-settlement`
 * without extra configuration. Fill in from `deployments/<network>.json` after
 * `pnpm contract:publish <network>`, then release the SDK.
 */
export const CHANNEL_DEPLOYMENTS: Partial<Record<SuiNetwork, ChannelDeployment>> = {
  // 'sui:testnet': { packageId: '0x…', registryId: '0x…' },
  // 'sui:mainnet': { packageId: '0x…', registryId: '0x…' },
};
