# BlockPay

x402 payment infrastructure on Sui: put a price on any HTTP endpoint and let agents, machines and people pay per call in USDC.

- **x402 v2** wire format (`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`, CAIP-2 `sui:mainnet`)
- **`exact`** — one signed Sui transaction per request; gasless for USDC ≥ $0.01, sponsored otherwise
- **`batch-settlement`** — payment channels (`blockpay::channel`) for sub-cent prices: ~10 ms per paid call, redeemed in batches
- **Agent wallet** — per-request / per-day / per-host / total budgets, approvals, audit, LLM tool
- **Facilitator** — reference `/verify`, `/settle`, `/supported` service you can run yourself

Documentation: https://docs.blockpay.gg (source in [`docs/`](docs/README.md)).

## Packages

| Package | |
| --- | --- |
| [`@blockpay402/express`](https://www.npmjs.com/package/@blockpay402/express) | Charge from an Express app |
| [`@blockpay402/next`](https://www.npmjs.com/package/@blockpay402/next) | Charge from Next.js / any Fetch-API runtime |
| [`@blockpay402/server`](https://www.npmjs.com/package/@blockpay402/server) | Framework-agnostic resource-server handler |
| [`@blockpay402/client`](https://www.npmjs.com/package/@blockpay402/client) | Paying `fetch`, Axios interceptor, channels |
| [`@blockpay402/agent`](https://www.npmjs.com/package/@blockpay402/agent) | Agent wallet with budgets and approvals |
| [`@blockpay402/facilitator`](https://www.npmjs.com/package/@blockpay402/facilitator) | Reference facilitator, SQLite store, test mock |
| [`@blockpay402/sui`](https://www.npmjs.com/package/@blockpay402/sui) | Sui transaction builders, vouchers, channel reads |
| [`@blockpay402/core`](https://www.npmjs.com/package/@blockpay402/core) | x402 v2 types, schemas, codecs, networks |

```bash
npm i @blockpay402/express    # charge
npm i @blockpay402/client     # pay
```

## Repository

| Path | |
| --- | --- |
| `contracts/blockpay` | Move package: `blockpay::channel` |
| `packages/core` | x402 v2 types, schemas, codecs, networks, assets, canonical deployments |
| `packages/sui` | Sui builders and checks: exact payments, channels, vouchers |
| `packages/server` | Framework-agnostic resource-server handler, `withPayment` for Fetch-API runtimes |
| `packages/express`, `packages/next` | Framework adapters |
| `packages/client` | Paying `fetch`, Axios interceptor, channel management |
| `packages/agent` | Agent wallet |
| `packages/facilitator` | Reference facilitator, SQLite store, mock for tests |
| `examples/e2e-localnet` | End-to-end checks against a local Sui network |
| `scripts` | Contract publish/freeze, sponsor funding, release versioning |
| `deployments` | Published contract IDs per network |
| `docs` | GitBook source (`.gitbook.yaml`) |

## Development

Requirements: Node 20+ (24 recommended), pnpm, and the Sui CLI ≥ 1.72 (Address Balances) for contract work and end-to-end tests.

```bash
pnpm install
pnpm build                 # all packages
pnpm test                  # unit tests (no chain needed)
pnpm test:move             # Move unit tests

# end to end, against a local network
sui start --with-faucet --force-regenesis          # separate terminal
SUI_BIN=$(which sui) pnpm e2e
```

## Operations

```bash
# Contract: writes deployments/<network>.json
DEPLOYER_KEY=suiprivkey1… pnpm contract:publish <testnet|mainnet> [--dry-run]
DEPLOYER_KEY=suiprivkey1… pnpm contract:freeze <testnet|mainnet> --yes      # irreversible

# Facilitator gas: sponsors pay from their address balance
BLOCKPAY_FACILITATOR_KEY=suiprivkey1… pnpm ops:fund-sponsor <network> [SUI]

# npm release (all packages in lockstep; CI publishes on tag vX.Y.Z)
pnpm release:version X.Y.Z && pnpm release:check
```

After publishing the contract, add its IDs to `packages/core/src/deployments.ts` and release the SDK.

## Status

Beta. Tested on Sui localnet (v1.80). `blockpay::channel` is not audited yet. See [`docs/disclaimer.md`](docs/disclaimer.md).

## License

Apache-2.0
