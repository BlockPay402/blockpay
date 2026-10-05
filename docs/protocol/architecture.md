# Architecture & trust model

```
                 ┌───────────────────────────────┐
                 │              Sui              │
                 │  • USDC / Coin<T> balances    │
                 │  • blockpay::channel          │
                 └──────────────▲────────────────┘
                                │ simulate · execute · claim
                       ┌────────┴─────────┐
                       │   Facilitator    │  /supported /verify /settle
                       │  (hosted or own) │  sponsor key · replay store · redeemer
                       └────────▲─────────┘
                                │ verify / settle (+ API key)
┌──────────────┐   HTTP + PAYMENT-SIGNATURE   ┌──────────────────┐
│    Client    │─────────────────────────────▶│ Resource server  │
│ agent · app  │◀─────────────────────────────│ middleware + API │
└──────────────┘   402 PAYMENT-REQUIRED /     └──────────────────┘
                   200 PAYMENT-RESPONSE
```

### Client

* Makes normal requests. On `402`, reads `PAYMENT-REQUIRED` and picks an option it supports and can afford within its caps.
* For `exact`: builds and signs a Sui transaction that pays the price into the server's address.
* For `batch-settlement`: opens a channel once (signed transaction), then signs a voucher per request with a channel-specific Ed25519 key.
* Never shares its private key. Spending caps are checked **before** anything is signed.

### Resource server

* Declares prices per route. Unpaid requests get `402`.
* Paid requests: asks the facilitator to verify, runs the handler, then settles (default), or settles first for `before-handler` routes.
* Buffers the response until settlement succeeds, so a failed payment never leaks the resource.
* Returns `PAYMENT-RESPONSE` with the transaction digest (or channel commitment).

### Facilitator

* `verify`: checks the payment without changing state — signature, terms, sponsor policy, and a simulation of the transaction.
* `settle`: broadcasts (co-signing as gas sponsor when the client asked for it) or records a channel voucher.
* Keeps a small **store**: digests already settled (so one signed transaction can never pay for two requests) and channel watermarks.
* Runs the **redeemer**: claims accepted vouchers on-chain in batches.

### Trust model

| The facilitator… | |
| --- | --- |
| can **not** move funds anywhere but the agreed recipient | `exact`: the payer signed the whole transaction. Channels: the contract pays only `payee` or refunds `payer`. |
| can **not** forge payments | It holds no payer keys. |
| **can** refuse service or go offline | Choose a facilitator you trust, or run your own. Payers can always exit channels without it. |
| **can** see payment metadata | Do not put secrets in resource URLs or descriptions. |
| **can** delay redeeming vouchers | For channels it operates, the merchant carries that risk until redemption; the dashboard shows unredeemed value and the latest voucher, which anyone can redeem. |
| pays gas it chose to sponsor | Sponsorship is limited to coin transfers and channel funding, with a gas budget cap. |

### State

The facilitator is *not* stateless. It stores:

* **Settled digests** — re-submitting an executed Sui transaction returns its original effects, so without this record one payment could be counted twice.
* **Channel records** — payee, authorizer key, deposit, highest accepted voucher, amount redeemed.

The reference facilitator ships with an in-memory store; the platform uses SQLite. Both implement one small interface, so any database works.
