import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '@blockpay402/facilitator/sqlite';
import { describe, expect, it } from 'vitest';

const USDC = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
const openDb = (_: string) => new DatabaseSync(':memory:');

describe('SqliteStore', () => {
  it('reserves digests once and only raises channel watermarks', async () => {
    const store = new SqliteStore(openDb(':memory:'));
    expect(await store.reserveTransaction('d1')).toBe(true);
    expect(await store.reserveTransaction('d1')).toBe(false);
    await store.releaseTransaction('d1');
    expect(await store.reserveTransaction('d1')).toBe(true);

    const record = {
      channelId: '0x1',
      network: 'sui:testnet',
      coinType: USDC,
      payer: '0x2',
      payee: '0x3',
      operator: '0x4',
      authorizer: 'AA==',
      deposited: '1000',
      acceptedAmount: '0',
      acceptedSignature: null,
      claimedAmount: '0',
      closeRequestedAtMs: null,
      withdrawDelayMs: '900000',
      status: 'open' as const,
      lastVoucherAt: null,
      lastClaimAt: null,
      lastClaimDigest: null,
      createdAt: Date.now(),
    };
    await store.putChannel(record);
    expect(await store.acceptVoucher('0x1', 300n, 'sig300', 1)).toBe(true);
    expect(await store.acceptVoucher('0x1', 300n, 'sig300', 2)).toBe(false);
    expect(await store.acceptVoucher('0x1', 200n, 'sig200', 3)).toBe(false);
    // F-03: two vouchers checked against the same older watermark must not both be accepted.
    // At write time 301 is only 1 above 300, below the 100 price of the request it pays for.
    expect(await store.acceptVoucher('0x1', 301n, 'sig301', 3, 100n)).toBe(false);
    expect(await store.acceptVoucher('0x1', 400n, 'sig400', 3, 100n)).toBe(true);
    await store.putChannel({ ...record, deposited: '2000' }); // a refresh must not reset the watermark
    expect((await store.getChannel('0x1'))).toMatchObject({ acceptedAmount: '400', acceptedSignature: 'sig400', deposited: '2000' });
    expect(await store.listRedeemable('sui:testnet')).toHaveLength(1);
    await store.markClaimed('0x1', 400n, 'claim', false, 4);
    expect(await store.listRedeemable('sui:testnet')).toHaveLength(0);
  });
});

describe('SqliteStore persistence', () => {
  it('keeps state across instances on the same database', async () => {
    const db = new DatabaseSync(':memory:');
    await new SqliteStore(db).reserveTransaction('d1');
    expect(await new SqliteStore(db).hasTransaction('d1')).toBe(true);
  });
});
