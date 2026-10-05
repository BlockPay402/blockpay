import type { AddressInfo } from 'node:net';
import {
  HEADERS,
  type PaymentRequired,
  decodePaymentRequired,
  decodePaymentResponse,
  encodePaymentPayload,
} from '@blockpay402/core';
import { paymentMiddleware } from '@blockpay402/express';
import { createMockFacilitator } from '@blockpay402/facilitator/mock';
import { withPayment } from '@blockpay402/server';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PAY_TO = `0x${'a'.repeat(64)}`;

function payFor(required: PaymentRequired, index = 0, tamper: Record<string, unknown> = {}) {
  return encodePaymentPayload({
    x402Version: 2,
    resource: required.resource,
    accepted: { ...required.accepts[index]!, ...tamper },
    payload: { transaction: 'AAAA', signature: 'AAAA' },
  });
}

describe('express middleware (mock facilitator)', () => {
  const mock = createMockFacilitator();
  const failing = createMockFacilitator({ failSettleWith: 'insufficient_funds' });
  let base = '';
  let server: ReturnType<express.Express['listen']>;
  let handlerRuns = 0;

  beforeAll(async () => {
    const app = express();
    const config = { network: 'testnet', payTo: PAY_TO };
    app.use(
      '/fail',
      paymentMiddleware({ ...config, facilitator: failing, routes: { 'GET /fail/x': '$0.01' } }),
    );
    app.use(
      paymentMiddleware({
        ...config,
        facilitator: mock,
        routes: {
          'GET /weather': { price: '$0.001', description: 'Weather' },
          'GET /big': '$0.05',
          'GET /broken': '$0.001',
          'GET /upfront': { price: '$0.001', settle: 'before-handler' },
          'GET /maybe/:id': { price: (req) => (req.params.id === 'free' ? null : '$0.002') },
        },
      }),
    );
    app.get('/weather', (req, res) => {
      handlerRuns++;
      res.json({ tempC: 31, payer: req.blockpay?.payer });
    });
    app.get('/big', (_req, res) => res.send('big'));
    app.get('/broken', (_req, res) => res.status(500).json({ error: 'down' }));
    app.get('/upfront', (_req, res) => res.json({ settledBefore: mock.settlements.length }));
    app.get('/maybe/:id', (req, res) => res.json({ id: req.params.id }));
    app.get('/fail/x', (_req, res) => res.json({ secret: 'paid content' }));
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => server.close());

  async function required(path: string) {
    const res = await fetch(base + path);
    expect(res.status).toBe(402);
    return decodePaymentRequired(res.headers.get(HEADERS.paymentRequired)!);
  }

  it('answers unpaid requests with a v2 402', async () => {
    const body = await required('/weather');
    expect(body.x402Version).toBe(2);
    expect(body.resource).toMatchObject({ url: `${base}/weather`, description: 'Weather' });
    expect(body.accepts[0]).toMatchObject({ scheme: 'exact', network: 'sui:testnet', amount: '1000', payTo: PAY_TO });
    expect(body.accepts[0]!.extra?.gasless).toBeUndefined(); // below the 0.01 gasless minimum
  });

  it('flags gasless transfers at or above 0.01 USDC', async () => {
    expect((await required('/big')).accepts[0]!.extra?.gasless).toBe(true);
  });

  it('serves and settles a paid request', async () => {
    const header = payFor(await required('/weather'));
    const before = mock.settlements.length;
    const res = await fetch(`${base}/weather`, { headers: { [HEADERS.paymentSignature]: header } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tempC: 31, payer: `0x${'1'.repeat(64)}` });
    expect(decodePaymentResponse(res.headers.get(HEADERS.paymentResponse)!).success).toBe(true);
    expect(mock.settlements.length).toBe(before + 1);
  });

  it('rejects a payment for different terms', async () => {
    const header = payFor(await required('/weather'), 0, { amount: '1' });
    const runs = handlerRuns;
    const res = await fetch(`${base}/weather`, { headers: { [HEADERS.paymentSignature]: header } });
    expect(res.status).toBe(402);
    expect(decodePaymentRequired(res.headers.get(HEADERS.paymentRequired)!).error).toBe('payment_requirements_mismatch');
    expect(handlerRuns).toBe(runs);
  });

  it('rejects a malformed header with 400', async () => {
    const res = await fetch(`${base}/weather`, { headers: { [HEADERS.paymentSignature]: 'not-base64!' } });
    expect(res.status).toBe(400);
  });

  it('does not settle when the handler fails', async () => {
    const header = payFor(await required('/broken'));
    const before = mock.settlements.length;
    const res = await fetch(`${base}/broken`, { headers: { [HEADERS.paymentSignature]: header } });
    expect(res.status).toBe(500);
    expect(mock.settlements.length).toBe(before);
  });

  it('settles before the handler in before-handler mode', async () => {
    const header = payFor(await required('/upfront'));
    const before = mock.settlements.length;
    const res = await fetch(`${base}/upfront`, { headers: { [HEADERS.paymentSignature]: header } });
    expect(await res.json()).toEqual({ settledBefore: before + 1 });
  });

  it('never leaks the response when settlement fails', async () => {
    const header = payFor(await required('/fail/x'));
    const res = await fetch(`${base}/fail/x`, { headers: { [HEADERS.paymentSignature]: header } });
    expect(res.status).toBe(402);
    const text = await res.text();
    expect(text).not.toContain('paid content');
    expect(decodePaymentResponse(res.headers.get(HEADERS.paymentResponse)!).errorReason).toBe('insufficient_funds');
  });

  it('lets a dynamic price make a request free', async () => {
    expect((await fetch(`${base}/maybe/free`)).status).toBe(200);
    expect((await required('/maybe/paid')).accepts[0]!.amount).toBe('2000');
  });
});

describe('withPayment (fetch API)', () => {
  const mock = createMockFacilitator();
  const handler = withPayment(
    { facilitator: mock, network: 'sui:testnet', payTo: PAY_TO, price: '$0.003', description: 'report' },
    async (_req, { payment }) => Response.json({ payer: payment?.payer }),
  );

  it('charges a single-route handler', async () => {
    const unpaid = await handler(new Request('https://api.example.com/report'));
    expect(unpaid.status).toBe(402);
    const required = decodePaymentRequired(unpaid.headers.get(HEADERS.paymentRequired)!);
    expect(required.accepts[0]!.amount).toBe('3000');
    const paid = await handler(
      new Request('https://api.example.com/report', { headers: { [HEADERS.paymentSignature]: payFor(required) } }),
    );
    expect(paid.status).toBe(200);
    expect(paid.headers.get(HEADERS.paymentResponse)).toBeTruthy();
    expect(mock.settlements).toHaveLength(1);
  });
});
