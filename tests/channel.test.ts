import { toHex } from '@mysten/sui/utils';
import { Ed25519Keypair, signVoucher, verifyVoucher, voucherMessage } from '@blockpay402/sui';
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
