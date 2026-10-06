# Overview

BlockPay ships as TypeScript packages under `@blockpay402`. Install only the side you need.

| Package | For | Runs in |
| --- | --- | --- |
| [`@blockpay402/express`](https://www.npmjs.com/package/@blockpay402/express) | Charging from an Express app | Node |
| [`@blockpay402/next`](https://www.npmjs.com/package/@blockpay402/next) | Charging from Next.js route handlers (any Fetch-API runtime: Hono, Bun, Deno, Workers) | Node, edge |
| [`@blockpay402/server`](https://www.npmjs.com/package/@blockpay402/server) | Framework-agnostic handler, for custom adapters | Node, edge |
| [`@blockpay402/client`](https://www.npmjs.com/package/@blockpay402/client) | Paying: `fetch` wrapper, Axios interceptor, channel management | Node, browser |
| [`@blockpay402/agent`](https://www.npmjs.com/package/@blockpay402/agent) | Paying from AI agents: budgets, approvals, audit, LLM tool | Node, browser |
| [`@blockpay402/facilitator`](https://www.npmjs.com/package/@blockpay402/facilitator) | Running a facilitator (and a mock for tests) | Node |
| [`@blockpay402/sui`](https://www.npmjs.com/package/@blockpay402/sui) | Sui primitives: transaction builders, vouchers, channel reads | Node, browser |
| [`@blockpay402/core`](https://www.npmjs.com/package/@blockpay402/core) | x402 v2 types, schemas, codecs, networks, assets | anywhere |

All packages are published on [npm](https://www.npmjs.com/org/blockpay402), released together under one version, and ship ESM and CJS builds with TypeScript types. They need Node 20+ (24 recommended).

```bash
npm i @blockpay402/express   # or: pnpm add / yarn add / bun add
```

### Picking a starting point

* Charge for an API or MCP tool → [Server SDK](server-sdk.md)
* Pay for APIs from code → [Client SDK](client-sdk.md)
* Give an AI agent a wallet → [AI agents](agents.md)
* Operate verification and settlement → [Facilitator SDK](facilitator-sdk.md)

### Prerequisites

* A **receiving address** (servers) or a **funded key** (clients). On testnet, get USDC from the [Circle faucet](https://faucet.circle.com/).
* A **facilitator**: the hosted one (API key from the dashboard) or your own.
* Clients need a Sui **gRPC** endpoint; the public fullnodes are the default.

### Environment variables used in examples

```bash
BLOCKPAY_FACILITATOR_URL=https://facilitator.blockpay.gg   # servers (testnet: https://facilitator.testnet.blockpay.gg)
BLOCKPAY_API_KEY=bp_live_…                                 # servers using the hosted facilitator
BLOCKPAY_PAY_TO=0x…                                        # servers: where payments go
BLOCKPAY_PRIVATE_KEY=suiprivkey1…                          # clients and agents
```

Never commit private keys. In production, pass a KMS- or hardware-backed `signer` instead of `privateKey`.
