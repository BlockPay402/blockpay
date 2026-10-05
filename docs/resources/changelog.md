# Changelog

### 0.1.0 — 2026-10

* Rebuilt on **x402 v2**: `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` headers, CAIP-2 networks (`sui:mainnet`), scheme `exact`. The v1 names used in earlier drafts (`sui-exact`, `sui-mainnet`, `X-PAYMENT`, `maxAmountRequired`) are replaced; servers still read an `X-PAYMENT` header.
* `exact` payload is a complete signed Sui transaction (`{ transaction, signature }`), per the x402 Sui spec.
* Gasless USDC payments via Sui Address Balances; non-interactive gas sponsorship via `extra.feePayer`.
* New `batch-settlement` scheme and `blockpay::channel` Move contract for sub-cent pricing.
* Facilitator: replay protection store, bounded execution, `settlement_pending`, voucher redeemer.
* Agent wallet: per-request, per-day, per-host and total budgets, approvals, audit, LLM tool.
* Platform: wallet sign-in, API keys, ledger, analytics, channels, signed webhooks, dashboard.
* Prepaid-credit billing: on-chain verified USDC top-ups, flat fee per payment, `insufficient_platform_credit`, `billing.low_balance` webhook.
* Corrected native USDC coin types; gRPC instead of JSON-RPC.
