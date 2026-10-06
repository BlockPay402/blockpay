# Payment flow

A payment is one HTTP exchange that loops once when payment is required.

```
Client                    Resource server                Facilitator              Sui
  │ 1. GET /v1/credit/acme     │                              │                     │
  │───────────────────────────▶│                              │                     │
  │ 2. 402 + PAYMENT-REQUIRED  │                              │                     │
  │◀───────────────────────────│                              │                     │
  │ 3. sign payment            │                              │                     │
  │ 4. GET /v1/credit/acme     │                              │                     │
  │    PAYMENT-SIGNATURE       │                              │                     │
  │───────────────────────────▶│ 5. POST /verify              │                     │
  │                            │─────────────────────────────▶│ 6. simulate          │
  │                            │                              │────────────────────▶│
  │                            │ { isValid: true, payer }     │                     │
  │                            │◀─────────────────────────────│                     │
  │                            │ 7. run handler (buffered)    │                     │
  │                            │ 8. POST /settle              │                     │
  │                            │─────────────────────────────▶│ 9. execute           │
  │                            │                              │────────────────────▶│
  │                            │ { success, transaction }     │◀────────────────────│
  │                            │◀─────────────────────────────│                     │
  │ 10. 200 + PAYMENT-RESPONSE │                              │                     │
  │◀───────────────────────────│                              │                     │
```

### 1–2. Price discovery

An unpaid request to a priced route gets:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Miwi...
```

The header is base64 JSON (the body repeats it for humans and `curl`):

```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": { "url": "https://api.example.com/v1/credit/acme-trading-co", "description": "Business credit score" },
  "accepts": [
    {
      "scheme": "exact",
      "network": "sui:mainnet",
      "amount": "10000",
      "asset": "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
      "payTo": "0x9c4e…a71f",
      "maxTimeoutSeconds": 60,
      "extra": { "feePayer": "0x5494…9665", "gasless": true }
    },
    {
      "scheme": "batch-settlement",
      "network": "sui:mainnet",
      "amount": "10000",
      "asset": "0xdba3…::usdc::USDC",
      "payTo": "0x9c4e…a71f",
      "maxTimeoutSeconds": 60,
      "extra": {
        "operator": "0x5494…9665",
        "channelPackage": "0x…",
        "channelRegistry": "0x…",
        "withdrawDelayMs": 3600000,
        "minDeposit": "1000000",
        "feePayer": "0x5494…9665"
      }
    }
  ]
}
```

Amounts are in the asset's smallest unit (USDC has 6 decimals: `10000` = $0.01). Servers list their preferred option first; BlockPay servers put `exact` first when it is gasless and `batch-settlement` first for smaller prices.

### 3–4. Paying

The client picks an option, signs, and retries with `PAYMENT-SIGNATURE` — base64 JSON of a `PaymentPayload`:

```json
{
  "x402Version": 2,
  "resource": { "url": "https://api.example.com/v1/credit/acme-trading-co" },
  "accepted": { "...the chosen PaymentRequirements, unchanged..." },
  "payload": { "transaction": "AAAC…", "signature": "AKz…" }
}
```

`accepted` must equal one of the offered requirements exactly; otherwise the server answers `402` with `payment_requirements_mismatch`. The `payload` shape depends on the scheme — see [exact](schemes/exact.md) and [batch-settlement](schemes/batch-settlement.md).

### 5–6. Verification

The server sends `{ x402Version, paymentPayload, paymentRequirements }` to `POST /verify`. Verification is read-only. For `exact` it checks the signature, the sponsorship policy, that the transaction was not already settled, and simulates it to confirm that `payTo` receives exactly `amount` of `asset`.

### 7–9. Handler, then settlement

By default (`after-handler`, the x402 `authorization` flow) the handler runs first and its response is held back. Then:

* **Handler returned ≥ 400** → the response is sent as-is; nothing is settled, the client pays nothing.
* **Settlement succeeded** → the response goes out with `PAYMENT-RESPONSE`.
* **Settlement failed** → the client gets `402` with `PAYMENT-RESPONSE` describing the failure. The handler's output is discarded, never leaked.

Routes can choose `before-handler` (the x402 `upfront` flow): settle first, then run the handler. Use it when the work is expensive or not repeatable and the price is the larger risk.

### 10. Receipt

```http
HTTP/1.1 200 OK
PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLCJ0cmFuc2FjdGlvbiI6Ijd…
```

```json
{ "success": true, "transaction": "7f3a…c21e", "network": "sui:mainnet", "payer": "0x123…", "amount": "10000" }
```

For `exact`, `transaction` is the Sui transaction digest: anyone can confirm it on-chain. For `batch-settlement` it is the commitment `<channelId>:<cumulativeAmount>`; value moves when the voucher is redeemed.

### Errors

| Situation | Response |
| --- | --- |
| No payment | `402` + `PAYMENT-REQUIRED` |
| Malformed `PAYMENT-SIGNATURE` | `400` + `PAYMENT-REQUIRED` (`invalid_payload`) |
| Wrong terms, bad signature, insufficient funds, replay | `402` + `PAYMENT-REQUIRED` with `error` set to the reason |
| Settlement failed | `402` + `PAYMENT-RESPONSE` (`success: false`, `errorReason`) |
| Broadcast sent but not confirmed in time | `402` + `PAYMENT-RESPONSE` with `settlement_pending` and the digest; reconcile on-chain before retrying |
| Facilitator unreachable | `402` with `unexpected_settle_error` (nothing is served) |

All reasons are listed in [Error codes](../reference/errors.md).

### Latency

Measured on a local Sui network (single machine), for orientation only:

| Path | Paid-request overhead |
| --- | --- |
| `exact` (verify + simulate + execute) | one round trip to Sui for simulation plus execution to finality |
| `batch-settlement` voucher | ~10–15 ms (signature checks, no chain access) |
| Channel open / top-up | one execution plus a checkpoint wait, once per channel |

Publish mainnet numbers measured from your own deployment before quoting them.

### Verify-then-settle risk

Between verification and settlement of an `exact` payment, a payer could spend the same funds elsewhere, so settlement fails after the handler ran. The client receives `402`, not the resource, but the server did the work. The exposure per request is bounded by the price. Use `before-handler` for routes where that matters, or `batch-settlement`, where funds are already escrowed.
