import { ErrorReason, type PaymentPayload, type PaymentRequirements } from '@blockpay402/core';
import { ExactSuiScheme, MemoryStore, type NetworkContext } from '@blockpay402/facilitator';
import { checkSponsorableCommands } from '@blockpay402/sui';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { describe, expect, it } from 'vitest';

const USDC = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
const payer = Ed25519Keypair.generate();
const sponsor = Ed25519Keypair.generate();
const payTo = Ed25519Keypair.generate().toSuiAddress();

/** A sponsored payment, built offline: one `send_funds` of an object input. */
async function sponsoredPayment(extraCommands = 0) {
  const tx = new Transaction();
  tx.setSender(payer.toSuiAddress());
  tx.setGasOwner(sponsor.toSuiAddress());
  tx.setGasPayment([]);
  tx.setGasBudget(10_000_000);
  tx.setGasPrice(1000);
  tx.setExpiration({ None: true });
  const coin = tx.objectRef({ objectId: `0x${'1'.repeat(64)}`, version: '1', digest: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi' });
  for (let i = 0; i < extraCommands; i++) tx.mergeCoins(coin, []);
  tx.transferObjects([coin], payTo);
  const bytes = await tx.build();
  const { signature } = await payer.signTransaction(bytes);
  return { transaction: toBase64(bytes), signature, data: Transaction.from(bytes).getData() };
}

function scheme(storage: { storageCost: string; storageRebate: string }, simulations: { n: number }) {
  const ctx = {
    network: 'sui:testnet',
    client: {
      core: {
        simulateTransaction: async () => {
          simulations.n++;
          return {
            $kind: 'Transaction',
            Transaction: {
              effects: { gasUsed: { computationCost: '1000000', ...storage } },
              balanceChanges: [{ address: payTo, coinType: USDC, amount: '1000' }],
            },
          };
        },
        executeTransaction: async () => {
          throw new Error('must not execute');
        },
      },
    },
    assets: new Set<string>(),
    withdrawDelayMs: 3_600_000,
    channelStateTtlMs: 30_000,
    signer: sponsor,
    address: sponsor.toSuiAddress(),
    sponsor: { exact: true, channels: true, maxGasBudget: 10_000_000n, maxCommands: 16, maxExactStorage: 2_000_000n, maxChannelStorage: 10_000_000n },
    store: new MemoryStore(),
    logger: { info() {}, warn() {}, error() {} },
  } as unknown as NetworkContext;
  return new ExactSuiScheme(ctx);
}

const requirements: PaymentRequirements = { scheme: 'exact', network: 'sui:testnet', amount: '1000', asset: USDC, payTo, maxTimeoutSeconds: 60 };
const payload = (p: { transaction: string; signature: string }): PaymentPayload => ({ x402Version: 2, accepted: requirements, payload: p });

// F-04: the sponsor must not pay to store objects the payer keeps (storage-rebate farming).
describe('sponsor policy', () => {
  it('accepts a canonical sponsored payment', async () => {
    const sims = { n: 0 };
    const result = await scheme({ storageCost: '988000', storageRebate: '0' }, sims).verify(payload(await sponsoredPayment()), requirements);
    expect(result).toEqual({ isValid: true, payer: payer.toSuiAddress() });
    expect(sims.n).toBe(1); // the policy simulation is reused by verify
  });

  it('rejects a sponsored payment that stores new objects, on verify and on settle', async () => {
    const farming = scheme({ storageCost: '39672000', storageRebate: '0' }, { n: 0 });
    const p = payload(await sponsoredPayment());
    expect((await farming.verify(p, requirements)).invalidReason).toBe(ErrorReason.exactSponsorPolicy);
    const settled = await farming.settle(p, requirements); // a server can skip /verify
    expect(settled).toMatchObject({ success: false, errorReason: ErrorReason.exactSponsorPolicy });
  });

  it('caps the number of commands', async () => {
    expect(checkSponsorableCommands((await sponsoredPayment(15)).data, [], 16)).toBeNull();
    expect(checkSponsorableCommands((await sponsoredPayment(16)).data, [], 16)).toMatch(/limited to 16/);
  });
});
