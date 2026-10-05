/**
 * End-to-end check on a local Sui network:
 *   sui start --with-faucet --force-regenesis
 *   SUI_BIN=$(which sui) pnpm e2e
 *
 * Publishes blockpay::channel, runs a facilitator and an Express API, and pays it
 * with `exact` (self-paid and sponsored gas) and `batch-settlement` (channel vouchers).
 */
import type { AddressInfo } from 'node:net';
import { createAgentWallet } from '@blockpay402/agent';
import { PaymentCapExceededError, PaymentClient, createPayingFetch, exitChannel, getPaymentResponse } from '@blockpay402/client';
import { HEADERS, type SuiNetwork } from '@blockpay402/core';
import { paymentMiddleware } from '@blockpay402/express';
import { createFacilitator, createFacilitatorApp } from '@blockpay402/facilitator';
import { getChannel } from '@blockpay402/sui';
import { serve } from '@hono/node-server';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import express from 'express';
import { GRPC_URL, balance, depositToAddressBalance, fund, publishChannelPackage, sui } from './localnet.js';

const NETWORK: SuiNetwork = 'sui:localnet';
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

async function check(name: string, fn: () => Promise<string | void>) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: `${detail ?? ''} (${Date.now() - started}ms)`.trim() });
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    results.push({ name, ok: false, detail: String((error as Error)?.message ?? error) });
    console.log(`  ✗ ${name} — ${(error as Error)?.stack ?? error}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Wait until a paid response's transaction is indexed, so balance reads include it. */
async function indexed(res: Response) {
  const digest = getPaymentResponse(res)?.transaction;
  if (digest && !digest.includes(':')) await sui.core.waitForTransaction({ digest, timeout: 10_000 });
}

async function expectStatus(res: Response, status: number) {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${await res.text()}`);
}

/** Address balances settle at checkpoint boundaries: poll until the balance moves (or time out). */
async function balanceAfter(owner: string, before: bigint, timeoutMs = 5000): Promise<bigint> {
  const deadline = Date.now() + timeoutMs;
  let current = await balance(owner);
  while (current === before && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    current = await balance(owner);
  }
  return current;
}

async function main() {
  const facilitatorKey = Ed25519Keypair.generate();
  const merchant = Ed25519Keypair.generate().toSuiAddress();
  const payer = Ed25519Keypair.generate();
  const agentKey = Ed25519Keypair.generate();

  console.log('Setup');
  await fund(facilitatorKey.toSuiAddress(), payer.toSuiAddress(), agentKey.toSuiAddress());
  const channel = await publishChannelPackage(facilitatorKey);
  console.log(`  package ${channel.packageId}\n  registry ${channel.registryId}`);
  await depositToAddressBalance(facilitatorKey, 5_000_000_000n);

  // Facilitator ---------------------------------------------------------------
  const facilitator = createFacilitator({
    privateKey: facilitatorKey.getSecretKey(),
    networks: [{ network: NETWORK, grpcUrl: GRPC_URL, client: sui, channel, withdrawDelayMs: 900_000, channelStateTtlMs: 0 }],
    redeem: { autoStart: false },
    logger: process.env.DEBUG ? console : undefined,
  });
  const facilitatorServer = serve({ fetch: createFacilitatorApp(facilitator).fetch, port: 0 });
  await new Promise((r) => facilitatorServer.once('listening', r));
  const facilitatorUrl = `http://127.0.0.1:${(facilitatorServer.address() as AddressInfo).port}`;

  // Resource server -------------------------------------------------------------
  const app = express();
  app.use(
    paymentMiddleware({
      facilitator: { url: facilitatorUrl },
      network: NETWORK,
      payTo: merchant,
      routes: {
        'GET /exact': { price: { amount: '1000000', asset: 'SUI' }, schemes: ['exact'], description: 'exact' },
        'GET /upfront': { price: { amount: '1000000', asset: 'SUI' }, schemes: ['exact'], settle: 'before-handler' },
        'GET /broken': { price: { amount: '1000000', asset: 'SUI' }, schemes: ['exact'] },
        'GET /micro': { price: { amount: '1000', asset: 'SUI' }, schemes: ['batch-settlement'], minDeposit: '5000' },
      },
    }),
  );
  app.get('/exact', (req, res) => res.json({ ok: true, payer: req.blockpay?.payer }));
  app.get('/upfront', (_req, res) => res.json({ ok: true }));
  app.get('/broken', (_req, res) => res.status(500).json({ error: 'upstream down' }));
  app.get('/micro', (_req, res) => res.json({ ok: true }));
  const apiServer = app.listen(0);
  await new Promise((r) => apiServer.once('listening', r));
  const api = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;

  const networks = { [NETWORK]: { client: sui, channel } };
  const caps = { maxPerRequest: { amount: '2000000', asset: 'SUI' }, channels: { maxDeposit: { amount: '100000000', asset: 'SUI' } } };

  console.log('\nexact');
  await check('unpaid request gets 402 with PAYMENT-REQUIRED', async () => {
    const res = await fetch(`${api}/exact`);
    assert(res.status === 402, `status ${res.status}`);
    assert(res.headers.get(HEADERS.paymentRequired), 'missing header');
  });

  const selfPay = createPayingFetch({ signer: payer, networks, gas: 'self', ...caps });
  await check('pays with self-paid gas; merchant receives exact amount', async () => {
    const before = await balance(merchant);
    const res = await selfPay(`${api}/exact`);
    const settlement = getPaymentResponse(res);
    await expectStatus(res, 200);
    assert(settlement?.success, 'no successful PAYMENT-RESPONSE');
    const body = (await res.json()) as { payer: string };
    assert(body.payer === payer.toSuiAddress(), 'req.blockpay.payer mismatch');
    const received = (await balanceAfter(merchant, before)) - before;
    assert(received === 1_000_000n, `merchant received ${received}`);
    return `tx ${settlement.transaction.slice(0, 12)}…`;
  });

  const sponsored = createPayingFetch({ signer: payer, networks, ...caps });
  await check('pays with gas sponsored by the facilitator; payer spends only the price', async () => {
    const before = await balance(payer.toSuiAddress());
    const res = await sponsored(`${api}/exact`);
    await expectStatus(res, 200);
    await indexed(res);
    const spent = before - (await balanceAfter(payer.toSuiAddress(), before));
    assert(spent === 1_000_000n, `payer spent ${spent}`);
  });

  await check('upfront (before-handler) mode settles before the handler', async () => {
    const res = await sponsored(`${api}/upfront`);
    assert(res.status === 200 && getPaymentResponse(res)?.success, `status ${res.status}`);
    await indexed(res);
  });

  await check('a failing handler is not charged', async () => {
    const before = await balance(payer.toSuiAddress());
    const res = await sponsored(`${api}/broken`);
    assert(res.status === 500, `status ${res.status}`);
    assert((await balance(payer.toSuiAddress())) === before, 'payer was charged');
  });

  await check('a payment header cannot be replayed for a second request', async () => {
    const client = new PaymentClient({ signer: payer, networks, ...caps });
    const first = await fetch(`${api}/exact`);
    const required = JSON.parse(Buffer.from(first.headers.get(HEADERS.paymentRequired)!, 'base64').toString());
    const prepared = await client.prepare(`${api}/exact`, required);
    const paid = await fetch(`${api}/exact`, { headers: { [HEADERS.paymentSignature]: prepared.header } });
    assert(paid.status === 200, `first use ${paid.status}`);
    const before = await balance(merchant);
    const replay = await fetch(`${api}/exact`, { headers: { [HEADERS.paymentSignature]: prepared.header } });
    assert(replay.status === 402, `replay status ${replay.status}`);
    assert((await balance(merchant)) === before, 'replay moved funds');
    return `replay → 402`;
  });

  await check('per-request cap refuses before signing', async () => {
    const capped = createPayingFetch({ signer: payer, networks, maxPerRequest: { amount: '10', asset: 'SUI' } });
    try {
      await capped(`${api}/exact`);
      throw new Error('expected PaymentCapExceededError');
    } catch (error) {
      assert(error instanceof PaymentCapExceededError, String(error));
    }
  });

  console.log('\nbatch-settlement');
  const channelClient = new PaymentClient({ signer: payer, networks, ...caps });
  const channelFetch = createPayingFetch(channelClient);
  await check('first request opens a sponsored channel and pays with a voucher', async () => {
    const res = await channelFetch(`${api}/micro`);
    await expectStatus(res, 200);
    const [entry] = await channelClient.listChannels();
    assert(entry, 'no channel recorded');
    const onChain = await getChannel(sui, entry.channelId);
    assert(onChain && onChain.deposited === 5000n && onChain.payee === merchant.toLowerCase(), 'channel state');
    return `channel ${entry.channelId.slice(0, 12)}…`;
  });

  await check('next requests are off-chain vouchers (no transaction)', async () => {
    const before = await balance(payer.toSuiAddress());
    const started = Date.now();
    for (let i = 0; i < 4; i++) {
      const res = await channelFetch(`${api}/micro`);
      assert(res.status === 200, `status ${res.status}`);
      assert(getPaymentResponse(res)?.transaction.includes(':'), 'expected commitment id');
    }
    assert((await balance(payer.toSuiAddress())) === before, 'vouchers should not move funds');
    return `${Math.round((Date.now() - started) / 4)}ms per paid call`;
  });

  await check('exhausting the deposit triggers a top-up', async () => {
    const res = await channelFetch(`${api}/micro`); // cumulative 6000 > deposit 5000
    await expectStatus(res, 200);
    const [entry] = await channelClient.listChannels();
    const onChain = await getChannel(sui, entry!.channelId);
    assert(onChain && onChain.deposited > 5000n, `deposit ${onChain?.deposited}`);
  });

  await check('a voucher cannot be replayed', async () => {
    const [entry] = await channelClient.listChannels();
    const first = await fetch(`${api}/micro`);
    const required = JSON.parse(Buffer.from(first.headers.get(HEADERS.paymentRequired)!, 'base64').toString());
    const prepared = await channelClient.prepare(`${api}/micro`, required);
    const ok = await fetch(`${api}/micro`, { headers: { [HEADERS.paymentSignature]: prepared.header } });
    await prepared.complete(getPaymentResponse(ok), ok.ok);
    const replay = await fetch(`${api}/micro`, { headers: { [HEADERS.paymentSignature]: prepared.header } });
    assert(ok.status === 200 && replay.status === 402, `statuses ${ok.status}/${replay.status}`);
    return `cumulative ${entry?.cumulative} → replay 402`;
  });

  await check('redeemer claims accepted vouchers to the merchant', async () => {
    const before = await balance(merchant);
    const [result] = await facilitator.redeemNow(NETWORK);
    assert(result, 'nothing redeemed');
    const received = (await balanceAfter(merchant, before)) - before;
    assert(received === 7000n, `merchant received ${received}`);
    return `7 calls → 1 claim tx ${result.digest.slice(0, 12)}…`;
  });

  await check('payer can start a unilateral exit without the facilitator', async () => {
    const [entry] = await channelClient.listChannels();
    const status = await exitChannel(channelClient, { network: NETWORK, channelId: entry!.channelId, deployment: channel });
    assert(status.state === 'requested', status.state);
    // The facilitator refuses vouchers on a closing channel; the client opens a new one and retries.
    const res = await channelFetch(`${api}/micro`);
    await expectStatus(res, 200);
    const active = (await channelClient.listChannels()).filter((c) => !c.key.includes('#abandoned'));
    assert(active.length === 1 && active[0]!.channelId !== entry!.channelId, 'expected a new channel');
    return 'closing channel refused, replaced by a new one';
  });

  console.log('\nagent');
  await check('agent wallet enforces per-host budget and records an audit trail', async () => {
    const audit: string[] = [];
    const wallet = createAgentWallet({
      network: NETWORK,
      signer: agentKey,
      networks,
      budgets: {
        perRequest: { amount: '2000000', asset: 'SUI' },
        perHost: { [new URL(api).host]: { amount: '1500000', asset: 'SUI' } },
      },
      onSettled: (r) => void audit.push(`${r.scheme}:${r.amount}:${r.success}`),
    });
    const tool = wallet.asTool();
    const first = await tool.execute({ url: `${api}/exact` });
    assert(first.status === 200 && first.paid, `first ${first.status} ${first.body}`);
    const second = await tool.execute({ url: `${api}/exact` });
    assert(second.status === 0 && second.body.includes('budget'), `second ${second.status} ${second.body}`);
    assert(audit.length === 1 && wallet.spent === 1_000_000n, `audit ${audit}`);
    return 'second call refused by host budget';
  });

  facilitator.close();
  apiServer.close();
  facilitatorServer.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
