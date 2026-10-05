# Overview

BlockPay implements **x402 protocol version 2** with Sui as the settlement network. A client and a server agree on a price, the client authorizes exactly that payment, and a facilitator verifies and settles it — inside one HTTP request.

### Actors

| Actor | Role |
| --- | --- |
| **Client** | Wants a resource: an app, a backend or an AI agent. Holds a Sui key and signs payments. |
| **Resource server** | Sells the resource. Answers unpaid requests with `402` and the price. |
| **Facilitator** | Verifies payments and broadcasts them to Sui for the server. Sponsors gas where needed. Never holds funds. |
| **Sui** | Settlement. Every payment ends as an on-chain balance change to the server's address. |

### What the protocol defines

1. **`PaymentRequired`** — what the server accepts: one or more `PaymentRequirements` (scheme, network, amount, asset, recipient), sent in the `PAYMENT-REQUIRED` header of a `402`.
2. **`PaymentPayload`** — what the client signs, sent in the `PAYMENT-SIGNATURE` header of the retried request.
3. **`SettlementResponse`** — the outcome, sent in the `PAYMENT-RESPONSE` header.
4. **The facilitator API** — `POST /verify`, `POST /settle`, `GET /supported`.
5. **Schemes** — how value moves on Sui:

| Scheme | Value moves | Best for | On-chain cost per request |
| --- | --- | --- | --- |
| [`exact`](schemes/exact.md) | per request, immediately | prices ≥ $0.01, one-off calls | none if gasless USDC; otherwise sponsored gas |
| [`batch-settlement`](schemes/batch-settlement.md) | at redemption, in batches | sub-cent prices, high call rates, agents | none (one transaction per batch) |

### Design principles

* **HTTP-native.** No redirects, pop-ups or hosted checkout.
* **Standard first.** Wire formats follow x402 v2 exactly, so BlockPay clients can pay any x402 server that supports Sui, and any such client can pay a BlockPay server. Where Sui needs something the standard does not define yet (gas sponsorship from an address balance, Sui payment channels), BlockPay documents its own binding, to be proposed upstream later.
* **Trust-minimizing.** In `exact` the payer signs the full transaction, so the facilitator cannot change the amount or recipient. In `batch-settlement` the contract only ever pays the channel's payee or refunds the payer.
* **Chain-extensible.** Networks are CAIP-2 identifiers and schemes are pluggable; Sui is the first network, not the only possible one.

### Next

* [Architecture & trust model](architecture.md)
* [Payment flow](payment-flow.md)
