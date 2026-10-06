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
  // Not audited yet: see docs/disclaimer.md. UpgradeCap held by a cold wallet, to be frozen after the audit.
  'sui:mainnet': {
    packageId: '0x270a878bd91a97830e4e399ad9343fb45f35904e1fa58782d22b9f5f09be222a',
    registryId: '0x163e8384a8d5e82d5f56ad00cf94ff6459780a5ab42b00d8c7dbf1947652d99d',
    registryIds: [
      '0x163e8384a8d5e82d5f56ad00cf94ff6459780a5ab42b00d8c7dbf1947652d99d',
      '0x5e81319c0a3f4632089d4901015aa87062a882794410bc636bafc79003ed0a8a',
      '0x909a6fafe2ca56ba60ee55a4e9ef2c44a45551508458d0aa2d9381d43ab5449b',
      '0x9de275496ee94b39e44afde2e1f2e24e54f755fd1cb226c23ed688ef1e1df5f9',
      '0x61bf979fad0c718070f898176dad29bc545726354bddb2ddb42aaf4f3a8ef050',
      '0x24180e4f4a3ed8f7f03b794865922535d400fb5065eedda57752f162f2fe1086',
      '0x47c387c4c5b80ee10201749b57c3d8644ada14abae95c8d7b3601925907b3bb2',
      '0x4ac29a4f58279db7ca7907e890e2e0aa142fa36072094e56a78a576321802361',
      '0x84f104e0a2b436ff2b90dd2dacb03b1299755611921e8fe178101f2a441712d2',
      '0x371121b1bb09013ee78a00b309381d2ec8551752bf196b085408547390b44711',
      '0x0f2a510dc83841a7382d22044e53c304b5d532e381e872ece582c566643a2fa4',
      '0x75a29daabff72cc61b48a80daa3e01c346bd8334210c3f6949249e707e925eed',
      '0x7e2feb8a7d519e7f1b54897dd9fd331d988301e8e20be81553b70412e503436f',
      '0x28e4621b8649604d51027ceb7db8d9620fd83993f9334dd73e85a3cd2095eb3b',
      '0x1b436a49138a275fe2530da63d05139795c53058f14c7f738ae13b89d70ac94e',
      '0xa40fed5a4b560e836913ff17be7278090f53818bf13a2b78d110c8d03e5064d3',
    ],
  },
};
