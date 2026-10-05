# Webhooks

Set an HTTPS endpoint in the dashboard (or `PATCH /v1/me`). BlockPay sends a `POST` with a JSON body for each event.

### Events

| Type | When | `data` |
| --- | --- | --- |
| `payment.settled` | A payment to one of your addresses settled (`exact`) or was committed (`batch-settlement`). | The payment object from the [Management API](management-api.md#payments). |
| `channel.redeemed` | Vouchers on one of your channels were claimed on-chain. | `{ network, channelId, cumulativeAmount, closed, transaction }` |
| `billing.low_balance` | Your prepaid credit dropped below the alert threshold. | `{ balanceUsd, thresholdUsd, feeUsd }` |
| `webhook.test` | You sent a test event. | `{ hello }` |

```json
{ "id": "evt_…", "type": "payment.settled", "createdAt": "2026-10-03T09:12:44.120Z", "data": { "…": "…" } }
```

### Verifying signatures

Each request carries `BlockPay-Signature: t=<unix seconds>,v1=<hex>`, where `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody: string, header: string, secret: string) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // reject replays
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return expected.length === v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}
```

Verify against the **raw** body, before JSON parsing.

### Delivery

* A 2xx response marks the delivery as delivered. Anything else, or no response within 10 seconds, is retried with exponential backoff (30 s, 1 min, 2 min, …) up to 8 attempts.
* Deliveries can arrive more than once and out of order: deduplicate on `id`, and treat the payment `status` as the source of truth.
* The delivery log in the dashboard shows status, attempts and the last error.
