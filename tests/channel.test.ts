import { toHex } from '@mysten/sui/utils';
import {
  Ed25519Keypair,
  buildOpenChannelTransaction,
  deriveChannelId,
  getChannel,
  parseChannelCoinType,
  registryFor,
  signVoucher,
  verifyVoucher,
  voucherMessage,
} from '@blockpay402/sui';
import { describe, expect, it } from 'vitest';

// Same vectors as contracts/blockpay/tests/channel_tests.move.
const CHANNEL_ID = '0xf2da499fab28a98b32d0788f8ed85defe9b59ff154c8e3e4d4c6a79fc9646964';
const MOVE_MESSAGE_300 =
  '626c6f636b7061792f6368616e6e656c2f766f75636865722f7631f2da499fab28a98b32d0788f8ed85defe9b59ff154c8e3e4d4c6a79fc96469642c01000000000000';
const MOVE_SIG_300 =
  '8796c177e6980560c293c5c3a67d81aac4b49da31fedcd6732ef9d8f4d8c10e76fdd253e89c598f0c27e6935a4ed63a96a6f642a5148b514fb3bbd691ae97e0e';

describe('vouchers', () => {
  const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7));

  it('builds the same message bytes as blockpay::channel::voucher_message', () => {
    expect(toHex(voucherMessage(CHANNEL_ID, 300n))).toBe(MOVE_MESSAGE_300);
  });

  it('produces the signature the Move tests verify on-chain', async () => {
    const signature = await signVoucher(key, CHANNEL_ID, 300n);
    expect(Buffer.from(signature, 'base64').toString('hex')).toBe(MOVE_SIG_300);
  });

  it('verifies only the signed channel and amount', async () => {
    const signature = await signVoucher(key, CHANNEL_ID, 300n);
    const authorizer = key.getPublicKey().toRawBytes();
    expect(await verifyVoucher({ authorizer, channelId: CHANNEL_ID, cumulativeAmount: 300n, signature })).toBe(true);
    expect(await verifyVoucher({ authorizer, channelId: CHANNEL_ID, cumulativeAmount: 301n, signature })).toBe(false);
    expect(await verifyVoucher({ authorizer, channelId: '0x1', cumulativeAmount: 300n, signature })).toBe(false);
    expect(await verifyVoucher({ authorizer, channelId: CHANNEL_ID, cumulativeAmount: 300n, signature: 'AAAA' })).toBe(false);
  });
});

// F-01: a `channel::Channel` published by anyone else must never be read as a BlockPay channel.
describe('channel objects', () => {
  const PKG = '0x84443af24c3b4fdfc5dc3df15d1cb11c6c0f00434890d58cf0188c6a5eb8083e';
  const USDC = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';

  it('only accepts the pinned package, in short or long address form', () => {
    expect(parseChannelCoinType(`${PKG}::channel::Channel<${USDC}>`, PKG)).toBe(USDC);
    expect(parseChannelCoinType(`${PKG}::channel::Channel<${USDC}>`, `0x${PKG.slice(2).toUpperCase()}`)).toBe(USDC);
    const lookAlike = `0x${'e'.repeat(64)}::channel::Channel<${USDC}>`;
    expect(parseChannelCoinType(lookAlike, PKG)).toBeNull();
    expect(parseChannelCoinType(`${PKG}::other::Channel<${USDC}>`, PKG)).toBeNull();
  });

  it('getChannel treats a look-alike object as missing', async () => {
    const client = {
      core: {
        getObjects: async () => ({
          objects: [{ type: `0x${'e'.repeat(64)}::channel::Channel<${USDC}>`, content: new Uint8Array(200) }],
        }),
      },
    } as never;
    expect(await getChannel(client, CHANNEL_ID, PKG)).toBeNull();
  });
});

// C-02: payers are spread across registry shards; the derived ID and the open transaction agree.
describe('registry shards', () => {
  const PKG = `0x${'1'.repeat(64)}`;
  const shards = Array.from({ length: 16 }, (_, i) => `0x${(i + 16).toString(16).repeat(32)}`);
  const sharded = { packageId: PKG, registryId: shards[0]!, registryIds: shards };
  const single = { packageId: PKG, registryId: shards[0]! };

  it('uses the one registry of an unsharded deployment', () => {
    expect(registryFor(single, `0x${'7'.repeat(64)}`)).toBe(shards[0]);
  });

  it('picks a stable shard from the payer address', () => {
    const payer = `0x${'0'.repeat(63)}5`;
    expect(registryFor(sharded, payer)).toBe(shards[5]);
    expect(registryFor(sharded, payer.toUpperCase().replace('0X', '0x'))).toBe(shards[5]);
    const counts = new Map<string, number>();
    for (let i = 0; i < 1600; i++) {
      const r = registryFor(sharded, Ed25519Keypair.generate().toSuiAddress());
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    expect(counts.size).toBe(16);
  });

  it('derives the ID under the payer’s shard, the registry the open transaction uses', () => {
    const payer = Ed25519Keypair.generate().toSuiAddress();
    const viaShard = deriveChannelId(sharded, payer, 7n);
    expect(viaShard).toBe(deriveChannelId({ packageId: PKG, registryId: registryFor(sharded, payer) }, payer, 7n));
    const tx = buildOpenChannelTransaction({
      deployment: sharded, sender: payer, coinType: '0x2::sui::SUI', payee: payer, operator: payer,
      authorizer: new Uint8Array(32), withdrawDelayMs: 900_000n, nonce: 7n, deposit: 1n,
    });
    const inputs = JSON.stringify(tx.getData().inputs);
    expect(inputs).toContain(registryFor(sharded, payer).slice(2));
  });
});
