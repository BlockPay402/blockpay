# Roadmap

### Now
* x402 v2 `exact` on Sui with gasless and sponsored gas.
* `batch-settlement` channels (`blockpay::channel`).
* SDKs: server (Express, Fetch API), client (fetch, Axios), agent wallet, facilitator.
* Hosted platform: wallet sign-in, API keys, ledger, analytics, channel redemption, webhooks.
* Prepaid-credit billing: USDC top-ups verified on-chain, flat fee per payment, low-balance alerts.

### Done
* `blockpay::channel` on testnet (16 registry shards); internal security review and fixes.
* `@blockpay402/*` 0.1.0 on npm.

### Next
* Independent audit; immutable mainnet deployment.
* x402 MCP transport helpers; `upto` scheme for usage-metered pricing.
* Postgres store for the platform; multi-region facilitator.

### Later
* Propose `batch-settlement` (Sui) and `extra.feePayer` sponsorship upstream to x402, once both have run in production.
* Agent reputation and discovery (x402 bazaar extension).
* Marketplace splits (several `send_funds` in one transaction).
* Additional networks via CAIP-2.
