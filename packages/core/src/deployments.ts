import type { ChannelDeployment } from './networks.js';
import type { SuiNetwork } from './types.js';

/**
 * Canonical `blockpay::channel` deployments. Clients trust these for `batch-settlement`
 * without extra configuration. Fill in from `deployments/<network>.json` after
 * `pnpm contract:publish <network>`, then release the SDK.
 */
export const CHANNEL_DEPLOYMENTS: Partial<Record<SuiNetwork, ChannelDeployment>> = {
  'sui:testnet': {
    packageId: '0x2ea95b4e89bd9b06de0dba42061d83233eccbdf06d88ff011cd4b9e85a8499e4',
    registryId: '0xbe4322c2ddef5534617dc80e93360d6a7c92a0d2b8b1535bbab37ab2b2f9c997',
    registryIds: [
      '0xbe4322c2ddef5534617dc80e93360d6a7c92a0d2b8b1535bbab37ab2b2f9c997',
      '0xcde66f5bc8b3c5363084bd144319633c33805f76f7967f809c05fc027a8ed7b4',
      '0x842bd468619eb3a23f7778d0e49b7f38910bfcbd842b509f61418c16b5fa79de',
      '0x870e018e655d2ccdc4876ce9c0eadf7edc8c410c1099ed1f72c5d7989e910698',
      '0x4ef3ef6932416aba8af827196c25bcc761103f066bb819b57a065d1fc14327cc',
      '0xbca7444af4532865d99c623a419a4144d23df213c0440a8f0649960e00d746fc',
      '0xf06324f92f2490ec1f991a317fef2ffa85ce725186bb5545a7a2adb1b4f7e481',
      '0x17692e2eaebff3ea969ce04f3be40dc0eea977fd6c0e7349536394132053e024',
      '0xdae881ba4c4211790ecaf993c19a99de801fbe0434572c675c87f18154d89978',
      '0xe0310c4e35dde86fdea4bc2c6d61d4c29924f1bce09bc8ee57bbcb79aead35c6',
      '0x043e60ee5f87c2513e91e96e08f42c4cd2eb38ffcebe3b876c1d09401f45b0c8',
      '0x4b36eeb35f522bbfb6b376a5546dd48f293b82165e5b64ff954eb8b7b79b1fbc',
      '0x54f96ff2fc00185c79b44bac3e9f059e07278b8bd7a87b4d1657a57d84485c3b',
      '0xeb7a2274744fb95c83f484674aa7c4d089248741c7cb23f61b0376f75f1ec6ea',
      '0x35d9e36006c25c4de0a855911663eb9958f650314a846c06e13eceef350115cb',
      '0x6648992c7bacf92f4f8bc458247886f7e42e8058be8dda8b52d2ae01df7a5537',
    ],
  },
  // 'sui:mainnet': { packageId: '0x…', registryId: '0x…' },
};
