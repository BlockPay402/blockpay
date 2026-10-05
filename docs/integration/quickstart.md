# Quickstart

A paid Express API and a client that pays it, on Sui testnet.

### 1. Prerequisites

* Node.js 20+.
* Two Sui addresses: one receives payments (server), one pays (client).
* The client address funded with testnet USDC ([Circle faucet](https://faucet.circle.com/)). USDC payments of $0.01 or more are gasless, so the client needs no SUI for them.
* A facilitator API key: sign in to the [dashboard](../platform/README.md) with the server's wallet and create one.

### 2. Server

```bash
mkdir paid-api && cd paid-api && npm init -y
npm i express @blockpay402/express
```

`server.ts`:

```ts
import express from 'express';
import { paymentMiddleware } from '@blockpay402/express';

const app = express();

app.use(
  paymentMiddleware({
    facilitator: { url: process.env.BLOCKPAY_FACILITATOR_URL!, apiKey: process.env.BLOCKPAY_API_KEY },
    network: 'sui:testnet',
    payTo: process.env.BLOCKPAY_PAY_TO!,
    routes: {
      'GET /weather': { price: '$0.01', description: 'Current weather for a city' },
    },
  }),
);

app.get('/weather', (req, res) => {
  res.json({ city: req.query.city ?? 'Hanoi', tempC: 31, paidBy: req.blockpay?.payer });
});

app.listen(3000, () => console.log('listening on :3000'));
```

```bash
npx tsx server.ts
curl -i "http://localhost:3000/weather?city=Hanoi"
# HTTP/1.1 402 Payment Required
# PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Mi…
```

### 3. Client

```bash
mkdir payer && cd payer && npm init -y
npm i @blockpay402/client
```

`client.ts`:

```ts
import { createPayingFetch, getPaymentResponse } from '@blockpay402/client';

const pay = createPayingFetch({
  privateKey: process.env.BLOCKPAY_PRIVATE_KEY!,
  network: 'sui:testnet',
  maxPerRequest: '$0.05', // refuse anything more expensive, before signing
});

const res = await pay('http://localhost:3000/weather?city=Hanoi');
console.log(res.status, await res.json());
console.log('paid in tx', getPaymentResponse(res)?.transaction);
```

```bash
npx tsx client.ts
# 200 { city: 'Hanoi', tempC: 31, paidBy: '0x…' }
# paid in tx 7f3a…
```

### 4. What happened

1. The first request got `402` with the price: 10 000 atomic USDC to your address, gasless.
2. The client checked the price against `maxPerRequest`, built a `send_funds` transaction, signed it, and retried with `PAYMENT-SIGNATURE`.
3. The middleware asked the facilitator to verify (signature + simulation), ran your handler, then settled. The transaction executed on Sui.
4. The response carried `PAYMENT-RESPONSE` with the digest. The payment shows up in the dashboard.

### 5. Next

* Charge less than a cent: see [channels](client-sdk.md#channels) — set the route price to `'$0.0005'` and the client pays with vouchers.
* Give an agent a budget: [AI agents](agents.md).
* Move to mainnet only after testing, and after reading the [Disclaimer](../disclaimer.md).
