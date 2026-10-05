# Facilitator

A facilitator verifies payments and settles them on Sui for resource servers, so servers need no Sui node connection, gas account or chain code.

### HTTP API

All endpoints use JSON. Hosted facilitators require `Authorization: Bearer <api key>` on `/verify` and `/settle`.

#### `GET /supported`

```json
{
  "kinds": [
    { "x402Version": 2, "scheme": "exact", "network": "sui:mainnet", "extra": { "feePayer": "0x5494…" } },
    { "x402Version": 2, "scheme": "batch-settlement", "network": "sui:mainnet",
      "extra": { "operator": "0x5494…", "channelPackage": "0x…", "channelRegistry": "0x…",
                 "withdrawDelayMs": 3600000, "feePayer": "0x5494…" } }
  ],
  "extensions": [],
  "signers": { "sui:*": ["0x5494…"] }
}
```

Servers merge `extra` from here into the requirements they advertise.

#### `POST /verify`

```json
{ "x402Version": 2, "paymentPayload": { "…": "…" }, "paymentRequirements": { "…": "…" } }
```

```json
{ "isValid": true, "payer": "0x123…" }
{ "isValid": false, "invalidReason": "insufficient_funds", "payer": "0x123…" }
```

Read-only: never changes on-chain or facilitator state.

#### `POST /settle`

Same request. Response:

```json
{ "success": true, "transaction": "7f3a…", "network": "sui:mainnet", "payer": "0x123…", "amount": "10000" }
{ "success": false, "errorReason": "settlement_pending", "transaction": "7f3a…", "network": "sui:mainnet" }
```

Call it only after `verify` succeeded and, in the default flow, after the handler succeeded.

#### `GET /health`, `GET /metrics`

Health includes the sponsor's gas balance per network. Metrics are Prometheus counters of verify/settle outcomes.

### What it checks

See [exact](schemes/exact.md#verification-facilitator) and [batch-settlement](schemes/batch-settlement.md#verification-facilitator). Common to both:

* `paymentPayload.accepted` must equal `paymentRequirements`.
* Network, scheme and asset must be enabled on this facilitator.
* With an API key, `payTo` must be one of the merchant's registered receiving addresses (`pay_to_not_allowed` otherwise).
* Optional `beforeVerify` hook for your own policy (sanctions screening, allow-lists).

### Gas sponsorship

The facilitator's key pays gas for:

* `exact` payments that are not gasless (below $0.01, or non-stablecoin assets), when the client opts in;
* channel open and top-up;
* voucher redemption.

It pays from its **address balance**, so sponsorship needs no coin selection and no extra round trip. Policy: only framework coin/balance calls (plus `channel::open` / `top_up`), never the gas coin, gas budget ≤ 0.05 SUI by default. Keep the sponsor funded and monitor `/health`.

### Hosted or self-hosted

| Option | Effort | Notes |
| --- | --- | --- |
| Hosted BlockPay facilitator | Lowest | API key from the [dashboard](../platform/README.md); ledger, analytics and webhooks included. |
| Reference facilitator (`@blockpay402/facilitator`) | Medium | Your own sponsor key, store and policy. See [Facilitator SDK](../integration/facilitator-sdk.md). |
| Your own implementation | Highest | Implement the three endpoints and the scheme checks. |

### Security

* Keep the sponsor key in a KMS or hardware signer (the SDK accepts any `Signer`).
* Rate-limit `/verify` and `/settle` per API key and per IP.
* Log payer, recipient, amount and digest; never log full payloads or keys.
* Alert on sponsor balance and on settlement failure rates.
