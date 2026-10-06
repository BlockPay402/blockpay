# Changelog

### 0.1.1 — 2026-10-06

* Same code as 0.1.0, published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements): each package links to the GitHub Actions build and commit it came from. Prefer 0.1.1 over 0.1.0.

### 0.1.0 — 2026-10-06

First release on npm: `@blockpay402/core`, `sui`, `server`, `express`, `next`, `client`, `agent`, `facilitator`.

* `blockpay::channel` on Sui testnet (`0x2ea95b4e…99e4`) with 16 registry shards; the SDK picks a shard from the payer address (`registryFor`) and trusts the testnet deployment by default.
* Security hardening from an internal review:
  * Channel objects are only read from the trusted package (`getChannel(client, channelId, packageId)`); look-alike `Channel` structs are rejected.
  * Vouchers are accepted only if they raise the watermark by the price, atomically in the store.
  * The redeemer isolates channels whose claim fails instead of failing the whole batch.
  * Sponsor policy: 0.01 SUI budget, at most 16 commands, simulated storage limits on verify and settle, `minDeposit` for sponsored opens.
  * Resource servers forward their own `resource`, not the one the payer sent.
* Publish script: `--freeze` / `--upgrade-cap-to`, one of them required on mainnet.

* Rebuilt on **x402 v2**: `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` headers, CAIP-2 networks (`sui:mainnet`), scheme `exact`. The v1 names used in earlier drafts (`sui-exact`, `sui-mainnet`, `X-PAYMENT`, `maxAmountRequired`) are replaced; servers still read an `X-PAYMENT` header.
* `exact` payload is a complete signed Sui transaction (`{ transaction, signature }`), per the x402 Sui spec.
* Gasless USDC payments via Sui Address Balances; non-interactive gas sponsorship via `extra.feePayer`.
* New `batch-settlement` scheme and `blockpay::channel` Move contract for sub-cent pricing.
* Facilitator: replay protection store, bounded execution, `settlement_pending`, voucher redeemer.
* Agent wallet: per-request, per-day, per-host and total budgets, approvals, audit, LLM tool.
* Platform: wallet sign-in, API keys, ledger, analytics, channels, signed webhooks, dashboard.
* Prepaid-credit billing: on-chain verified USDC top-ups, flat fee per payment, `insufficient_platform_credit`, `billing.low_balance` webhook.
* Corrected native USDC coin types; gRPC instead of JSON-RPC.
