# Server SDK

Put a price on routes. The middleware answers unpaid requests with `402`, verifies payments with the facilitator, runs your handler and settles before the response leaves.

### Express

```ts
import express from 'express';
import { paymentMiddleware } from '@blockpay402/express';

app.use(
  paymentMiddleware({
    facilitator: { url: process.env.BLOCKPAY_FACILITATOR_URL!, apiKey: process.env.BLOCKPAY_API_KEY },
    network: 'sui:mainnet',
    payTo: '0x9c4e…a71f',
    serviceName: 'Acme Data',
    routes: {
      'GET /v1/credit/:companyId': '$0.01',                         // shorthand
      'POST /v1/research/summarize': { price: '$0.02', description: 'Investment research summary', maxTimeoutSeconds: 90 },
      'GET /v1/macro/*': { price: '$0.0005' },                       // sub-cent per data point: paid via channels
      'GET /datasets/:id': {
        price: (req) => DATASETS[req.params.id]?.price ?? null,      // null → free / pass through
        description: (req) => `Dataset ${req.params.id}`,
      },
    },
  }),
);

app.get('/v1/credit/:companyId', (req, res) => {
  req.blockpay?.payer;   // payer address
  req.blockpay?.amount;  // "10000"
  req.blockpay?.scheme;  // "exact" | "batch-settlement"
  res.json({ company: req.params.companyId, score: 712, band: 'A-' });
});
```

After settlement, `res.locals.blockpaySettlement` holds the `SettleResponse`.

#### Routes

Keys are `"METHOD /path"` (or just `"/path"` for any method). Paths support `:param`, `*` (one segment) and `**` (any depth). The first match wins.

#### Route options

| Option | Default | Description |
| --- | --- | --- |
| `price` | — | `'$0.01'`, `0.01`, `{ amount, asset }`, or a function of the request. `null` makes the request free. |
| `description` | — | Shown to payers (and agents) in the 402. String or function. |
| `mimeType` | — | Expected response type. |
| `maxTimeoutSeconds` | `60` | How long the payment stays valid for this request. |
| `schemes` | all supported | `['exact']`, `['batch-settlement']`, or an order of preference. By default `exact` comes first when the payment is gasless, `batch-settlement` first otherwise. |
| `payTo` | handler `payTo` | Per-route receiving address (must be registered with a hosted facilitator). |
| `settle` | `'after-handler'` | `'before-handler'` settles before running the handler. |
| `minDeposit` | `100 × price` | Suggested channel deposit for `batch-settlement`. |

#### Settlement modes

* **`after-handler`** (default): the handler runs, its response is buffered, then the payment settles. A handler status ≥ 400 is returned unchanged and **nothing is charged**. If settlement fails, the client gets `402`, never the content.
* **`before-handler`**: settle, then run the handler. For expensive or non-idempotent work.

Buffering means streaming responses (SSE) are delivered after settlement. For streams, use `before-handler`.

### Next.js (and other Fetch-API runtimes)

```ts
// app/api/macro/[country]/[indicator]/route.ts
import { withPayment } from '@blockpay402/next';

export const GET = withPayment(
  {
    facilitator: { url: process.env.BLOCKPAY_FACILITATOR_URL!, apiKey: process.env.BLOCKPAY_API_KEY },
    network: 'sui:mainnet',
    payTo: process.env.BLOCKPAY_PAY_TO!,
    price: '$0.0005',
    description: 'Latest value of a macroeconomic indicator',
  },
  // Illustrative values: serve your own dataset.
  async (req, { payment }) => Response.json({ country: 'VN', indicator: 'cpi_yoy', period: '2026-08', value: 3.1, unit: '%', payer: payment?.payer }),
);
```

`withPayment` accepts either a single route (`price`, `description`, …) or a full `routes` map. It works with any `(Request) => Response` handler: Hono (`app.get('/x', (c) => handler(c.req.raw))`), Bun, Deno and Cloudflare Workers.

### Framework-agnostic

```ts
import { createPaymentHandler } from '@blockpay402/server';

const payments = createPaymentHandler({ facilitator, network: 'sui:mainnet', payTo, routes });

const result = await payments.handle({
  method: req.method,
  path: url.pathname,
  url: req.url,
  header: (name) => req.headers[name.toLowerCase()],
});

switch (result.kind) {
  case 'free':
    return next();
  case 'payment-required':
  case 'invalid':
    return send(result.status, result.headers, result.body);
  case 'verified': {
    const body = await yourHandler(result.payment);
    const settled = await result.settle();
    return settled.ok ? send(200, settled.headers, body) : send(settled.status, settled.headers, settled.body);
  }
}
```

### Using a facilitator instance directly

`facilitator` accepts any object with `verify`, `settle` and `supported` — an in-process `Facilitator` from `@blockpay402/facilitator`, or the mock for tests:

```ts
import { createMockFacilitator } from '@blockpay402/facilitator/mock';
paymentMiddleware({ facilitator: createMockFacilitator(), network: 'sui:testnet', payTo, routes });
```

### Logging

Pass `logger` (anything with `info`, `warn`, `error`) to see facilitator errors. Protocol failures (bad payment, insufficient funds) are answered with `402`, not thrown.
