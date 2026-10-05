# Welcome

**BlockPay** is open-source payment infrastructure for software that pays. It implements the [x402](https://www.x402.org/) open standard (protocol v2) on [Sui](https://sui.io/), so any API, service or autonomous agent can charge and pay per request over plain HTTP, in stablecoins, with no accounts, checkout or subscriptions for the payer.

| | |
| --- | --- |
| Protocol | x402 v2 — `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` headers |
| Networks | `sui:mainnet`, `sui:testnet` (CAIP-2 identifiers) |
| Schemes | `exact` (one on-chain transfer per request) and `batch-settlement` (payment channels for sub-cent pricing) |
| Assets | Native USDC on Sui (default), SUI, any `Coin<T>` the facilitator accepts |
| Packages | `@blockpay402/*` (TypeScript, ESM + CJS) |
| Contracts | `blockpay::channel` (Move) |

### Two ways to get paid

* **`exact`** — the payer signs a complete Sui transaction that moves the price into your address. The facilitator verifies and broadcasts it. USDC payments of $0.01 or more are **gasless** on Sui: nobody pays gas.
* **`batch-settlement`** — the payer escrows funds once in a channel and pays each request with a signed voucher. Paid calls take milliseconds and cost nothing on-chain; the facilitator redeems vouchers in batches. This is how prices like **$0.0001 per call** work.

### Where to start

* Want to charge for an endpoint? → [Quickstart](integration/quickstart.md)
* Building an agent that pays? → [AI agents](integration/agents.md)
* Want to understand the protocol? → [Payment flow](protocol/payment-flow.md)
* Running your own facilitator? → [Facilitator SDK](integration/facilitator-sdk.md)

{% hint style="warning" %}
**Status: beta.** The SDK and contracts are tested on Sui localnet and testnet. The `blockpay::channel` contract has not been audited yet. Read the [Disclaimer](disclaimer.md) before using real funds.
{% endhint %}

For AI agents reading these docs: an index is at [/llms.txt](https://docs.blockpay.gg/llms.txt), and every page is available as Markdown by appending `.md`.
