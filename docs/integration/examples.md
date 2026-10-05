# Examples & testing

### In this repository

| Path | What it shows |
| --- | --- |
| `examples/e2e-localnet/run.ts` | Full end-to-end on a local Sui network: publish the contract, run a facilitator and an Express API, pay with `exact` (self-paid and sponsored gas), channels (open, vouchers, top-up, redemption, unilateral exit), replay attempts, caps and an agent wallet. 14 checks. |

```bash
sui start --with-faucet --force-regenesis      # terminal 1
pnpm build && SUI_BIN=$(which sui) pnpm e2e     # terminal 2
```

### Unit tests without a chain

Use the mock facilitator: it accepts any payload whose `accepted` matches the requirements and records settlements.

```ts
import { createMockFacilitator } from '@blockpay402/facilitator/mock';

const mock = createMockFacilitator();
app.use(paymentMiddleware({ facilitator: mock, network: 'sui:testnet', payTo, routes }));

// …make a paid request…
expect(mock.settlements).toHaveLength(1);
expect(mock.settlements[0].amount).toBe('1000');
```

Options: `rejectWith` (fail every verify), `failSettleWith` (fail every settle), `payer`. `await mock.listen()` serves it over HTTP and sets `mock.url`.

### Patterns

**Dynamic prices**

```ts
'GET /datasets/:id': {
  price: (req) => {
    const dataset = DATASETS[req.params.id];
    return dataset ? `$${dataset.priceUsd}` : null; // null → pass through (e.g. to your 404)
  },
}
```

**Pay-per-call LLM proxy** — default `after-handler` mode: if the upstream call fails, return a 5xx and the caller is not charged.

**Several receiving addresses** — set `payTo` per route; register each address with the hosted facilitator.

**Reading a receipt**

```ts
const receipt = getPaymentResponse(res);
// exact: receipt.transaction is a Sui digest — verify it with any explorer or RPC.
```
