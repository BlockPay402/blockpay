# Introduction

### What BlockPay is

BlockPay lets software charge and pay per request over HTTP. When a client calls a paid endpoint without paying, the server answers `402 Payment Required` with a machine-readable price. The client — a backend, a browser or an AI agent — pays, retries, and gets the resource. The whole exchange happens inside ordinary HTTP and settles on Sui.

Concretely, BlockPay is:

1. **SDKs** (`@blockpay402/*`) — middleware that puts a price on any route, and clients that pay automatically within caps you set.
2. **A facilitator** — an HTTP service that verifies payments and broadcasts them to Sui on behalf of servers. Use the hosted one or run your own.
3. **A Move contract** (`blockpay::channel`) — payment channels for prices too small to settle one transaction at a time.
4. **A platform** — a merchant dashboard and API: API keys, payment ledger, analytics, channel redemption and webhooks.

### Why now

The web never had a native payment step. Cards, checkouts and monthly API plans work for people filling in forms; they do not work for software that needs to buy one thing, right now, and move on. Agents call APIs, agents call other agents, and they pay for inference, data and compute in amounts too small for a checkout and too frequent for an invoice.

### Why Sui

x402 defines how a payment travels over HTTP; it leaves settlement to the network. Sui fits per-request payments well:

* **Gasless stablecoin transfers.** Since May 2026, transfers of native USDC and other major stablecoins on Sui cost no gas when the transaction only moves balances. A payer does not need SUI to pay in USDC.
* **Address balances.** Funds can sit in an account-style balance instead of coin objects, so payments do not depend on coin versions and can run in parallel.
* **Sub-second finality** for transactions that gate an HTTP response.
* **Native USDC** issued by Circle, rather than a bridged token.
* **Move and programmable transaction blocks** for escrow and voucher logic that is verified on-chain (`blockpay::channel` checks Ed25519 voucher signatures itself).

### Who it is for

* **API and data providers** who want to charge per call instead of selling plans and API keys.
* **AI agent developers** whose agents buy tools, data and compute under hard budgets.
* **MCP server and tool authors** who want tools to charge when invoked.
* **Agent marketplaces** that need settlement between agents.
* **Publishers** who want crawlers and readers to pay per page.
* **Facilitator operators** running verification and settlement for others.

### Who it is not for (yet)

* Consumer checkout where the buyer has no wallet or stablecoins.
* Products that need a licensed payment processor in the loop.
* Anyone who cannot accept the risks in the [Disclaimer](disclaimer.md).

### Reading on

* [Protocol overview](protocol/overview.md) — how a payment works, step by step.
* [Quickstart](integration/quickstart.md) — a paid API and a paying client in ten minutes on testnet.
