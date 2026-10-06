# Management API

Base URL: your platform origin. All `/v1` endpoints except sign-in need `Authorization: Bearer <session token>`. Errors are `{ "error": "message" }` with a 4xx/5xx status.

### Authentication

#### `POST /v1/auth/challenge`

```json
{ "address": "0x…", "purpose": "sign-in" }
```

Returns `{ nonce, message, expiresAt }`. Sign `message` as a Sui **personal message** with the wallet. `purpose: "add-pay-to"` is used to prove ownership of an address you are adding. Challenges expire after 5 minutes and are single use.

#### `POST /v1/auth/verify`

```json
{ "address": "0x…", "nonce": "…", "signature": "<base64 Sui signature>" }
```

Returns `{ token, expiresAt, merchant }`. Sessions last 7 days.

#### `POST /v1/auth/logout`

### Merchant

| Method | Path | |
| --- | --- | --- |
| `GET` | `/v1/me` | Merchant, receiving addresses, webhook settings. |
| `PATCH` | `/v1/me` | `{ name?, webhookUrl? }` (https only; `null` removes). |
| `GET` | `/v1/pay-to` | Receiving addresses. |
| `POST` | `/v1/pay-to` | `{ address, nonce, signature, label? }` — signature over an `add-pay-to` challenge **by that address**. |
| `DELETE` | `/v1/pay-to/:address` | At least one address must remain. |

### API keys

| Method | Path | |
| --- | --- | --- |
| `GET` | `/v1/api-keys` | `id, name, prefix, createdAt, lastUsedAt, revokedAt`. |
| `POST` | `/v1/api-keys` | `{ name?, mode?: "live" \| "test" }` → `{ id, secret, prefix }`. The secret is returned once. |
| `DELETE` | `/v1/api-keys/:id` | Revoke. |

### Payments

`GET /v1/payments?limit=50&before=<ms>&scheme=&status=&network=&payer=&from=<ISO date>`

```json
{
  "data": [{
    "id": "pay_…", "scheme": "exact", "network": "sui:mainnet",
    "asset": "0xdba3…::usdc::USDC", "amount": "10000", "fee": "100",
    "payer": "0x…", "payTo": "0x…", "resource": "https://api.example.com/v1/credit/acme-trading-co",
    "description": "Business credit score", "transaction": "7f3a…", "channelId": null,
    "status": "settled", "feeUsd": "0.0001", "createdAt": "2026-10-03T09:12:44.120Z"
  }],
  "nextBefore": 1759482764120
}
```

`GET /v1/payments/export.csv` takes the same filters.

### Analytics

`GET /v1/stats?days=30` → `{ days, payments, uniquePayers, schemes, feesUsd, assets[], daily[], topResources[] }`. Amounts are atomic strings; `assets[].display` is human-readable.

Payment `fee` is the platform fee in micro-USD (6 decimals); `feeUsd` is the same in dollars.

### Billing

| Method | Path | |
| --- | --- | --- |
| `GET` | `/v1/billing` | `{ balanceUsd, feeUsd, paymentsRemaining, lowBalanceUsd, treasury: { network, address }, topUp: { minUsd, maxUsd }, senders[] }` |
| `GET` | `/v1/billing/ledger?limit=100` | Credit history: `kind` (`deposit`, `fee`, `adjustment`), `amountUsd`, `balanceAfterUsd`, `reference` (transaction digest for deposits, payment ID for fees). |
| `POST` | `/v1/billing/deposits` | `{ digest }` → `201 { creditedUsd, balanceUsd }`. The transaction must have succeeded, been sent from one of your addresses, and paid a USD stablecoin to the treasury. `409` if already credited. |
| `POST` | `/v1/billing/topups/prepare` | `{ sender, amountUsd }` → `{ transaction, amountUsd, network, asset, treasury }`. Builds an unsigned, gasless USDC transfer to the treasury from `sender`, which must be one of your addresses. Amount between `$1` and `$10000`. |
| `POST` | `/v1/billing/topups` | `{ transaction, signature, amountUsd }` → `201 { creditedUsd, balanceUsd, digest }`. Verifies the wallet-signed transaction pays exactly `amountUsd` to the treasury, broadcasts it and credits it. |

### Channels

| Method | Path | |
| --- | --- | --- |
| `GET` | `/v1/channels` | Channels whose payee is one of your addresses, with `deposited, accepted, redeemed, unredeemed, status` and `latestVoucher` (enough to redeem it yourself with `channel::claim`). |
| `POST` | `/v1/channels/redeem` | `{ network, channelIds? }` — redeem now. |

### Webhooks

| Method | Path | |
| --- | --- | --- |
| `GET` | `/v1/webhooks/deliveries` | Last 100 deliveries. |
| `POST` | `/v1/webhooks/test` | Queue a `webhook.test` event. |
| `POST` | `/v1/webhooks/rotate-secret` | New signing secret. |

See [Webhooks](webhooks.md).
