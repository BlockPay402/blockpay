import { MemoryStore, Redeemer, defaultRedeemPolicy } from '@blockpay402/facilitator';
import type { NetworkContext } from '@blockpay402/facilitator';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { describe, expect, it } from 'vitest';

const USDC = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
const id = (c: string) => `0x${c.repeat(64)}`;
const GOOD_A = id('a');
const GOOD_B = id('b');
const POISON = id('e');

/** A client whose transaction fails to build when it touches the poisoned object, like a look-alike channel. */
function fakeClient(executed: string[][], rpcDown: boolean) {
  return {
    core: {
      signAndExecuteTransaction: async ({ transaction }: { transaction: { getData(): { inputs: Array<Record<string, { objectId?: string }>> } } }) => {
        const objects = transaction
          .getData()
          .inputs.map((i) => i.UnresolvedObject?.objectId ?? i.Object?.objectId)
          .filter((o): o is string => !!o);
        if (objects.includes(POISON)) throw new Error('object is not a Channel of this package');
        executed.push(objects);
        return { $kind: 'Transaction', Transaction: { digest: `d${executed.length}` } };
      },
      // Not a channel of this package (or gone) reads as `null`; a transient RPC error throws.
      getObjects: async () => {
        if (rpcDown) throw new Error('unavailable');
        return { objects: [{ type: `${id('e')}::channel::Channel<${USDC}>`, content: new Uint8Array(8) }] };
      },
    },
  } as never;
}

async function setup(rpcDown = false) {
  const store = new MemoryStore();
  const executed: string[][] = [];
  const signer = Ed25519Keypair.generate();
  const ctx = {
    network: 'sui:testnet',
    client: fakeClient(executed, rpcDown),
    assets: new Set<string>(),
    channel: { packageId: id('1'), registryId: id('2') },
    withdrawDelayMs: 3_600_000,
    channelStateTtlMs: 30_000,
    signer,
    address: signer.toSuiAddress(),
    sponsor: { exact: true, channels: true, maxGasBudget: 10_000_000n },
    store,
    logger: { info() {}, warn() {}, error() {} },
  } as unknown as NetworkContext;
  for (const channelId of [GOOD_A, POISON, GOOD_B]) {
    await store.putChannel({
      channelId, network: 'sui:testnet', coinType: USDC, payer: id('9'), payee: id('8'), operator: ctx.address,
      authorizer: 'AA==', deposited: '1000', acceptedAmount: '0', acceptedSignature: null, claimedAmount: '0',
      closeRequestedAtMs: null, withdrawDelayMs: '3600000', status: 'open', lastVoucherAt: null, lastClaimAt: null,
      lastClaimDigest: null, createdAt: Date.now(),
    });
    await store.acceptVoucher(channelId, 500n, 'c2ln', Date.now());
  }
  const redeemer = new Redeemer(ctx, { ...defaultRedeemPolicy, intervalMs: 60_000 });
  return { store, executed, redeemer };
}

// F-02: one channel that cannot be claimed must not block the rest of its batch.
describe('redeemer', () => {
  it('splits a failing batch and still redeems the good channels', async () => {
    const { store, executed, redeemer } = await setup();
    await redeemer.runOnce();
    expect(executed.flat().sort()).toEqual([GOOD_A, GOOD_B].sort());
    // The look-alike is not a channel of this package, so it is retired for good.
    expect(await store.listRedeemable('sui:testnet')).toEqual([]);
    expect((await store.getChannel(POISON))?.status).toBe('closed');
  });

  it('backs off a channel that keeps failing', async () => {
    const { store, executed, redeemer } = await setup(true);
    await redeemer.runOnce();
    expect((await store.listRedeemable('sui:testnet')).map((r) => r.channelId)).toEqual([POISON]);
    const attempts = executed.length;
    await redeemer.runOnce(); // still unclaimable, but in backoff: not retried this round
    expect(executed.length).toBe(attempts);
  });
});
