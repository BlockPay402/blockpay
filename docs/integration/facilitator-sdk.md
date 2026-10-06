# Facilitator SDK

`@blockpay402/facilitator` is the reference facilitator: `exact` and `batch-settlement` on Sui, gas sponsorship, replay protection and voucher redemption.

```bash
npm i @blockpay402/facilitator
```

### Minimal service

```ts
import { createFacilitator, listen } from '@blockpay402/facilitator';

const facilitator = createFacilitator({
  privateKey: process.env.BLOCKPAY_SPONSOR_KEY!, // or `signer`
  networks: [
    {
      network: 'sui:testnet',
      assets: ['USDC'],                                    // default: all registered assets
      channel: { packageId: '0x…', registryId: '0x…' },     // enables batch-settlement
    },
  ],
  logger: console,
});

listen(facilitator, 8080);
// GET /supported · POST /verify · POST /settle · GET /health · GET /metrics
```

The sponsor key pays gas **from its address balance**. Fund it with SUI and move the SUI into the address balance (`0x2::coin::send_funds` to itself), then watch `/health`.

### Configuration

```ts
createFacilitator({
  networks: [{
    network: 'sui:mainnet',
    grpcUrl?: string,                // default: public fullnode
    client?: SuiClient,              // bring your own client
    assets?: string[],               // symbols or coin types
    channel?: ChannelDeployment,
    withdrawDelayMs?: number,        // required of new channels; default 1h
    channelStateTtlMs?: number,      // re-read channel state at least this often; default 30s
  }],
  signer?: Signer, privateKey?: string,
  sponsor?: {                                // see Facilitator → Gas sponsorship
    exact?: boolean, channels?: boolean,       // defaults: true, true
    maxGasBudget?: bigint,                     // 0.01 SUI
    maxCommands?: number,                      // 16
    maxExactStorage?: bigint,                  // 2_000_000 MIST net storage fee
    maxChannelStorage?: bigint,                // 10_000_000 MIST
  },
  store?: FacilitatorStore,          // default: in-memory
  redeem?: {
    intervalMs?: number,             // default 60s
    minAmount?: bigint,              // redeem once unredeemed value reaches this (default 0: every interval)
    maxAgeMs?: number,               // always redeem vouchers older than this (default 5 min)
    closeIdleAfterMs?: number,       // close idle channels and refund payers (default off)
    batchSize?: number,              // claims per transaction (default 50)
    autoStart?: boolean,             // default true
  },
  hooks?: { beforeVerify?, onSettled?, onRedeemed? },
  logger?: Logger,
});
```

### Storage

The default `MemoryStore` loses state on restart: settled digests (replay protection) and channel watermarks, including the latest voucher of every channel. **Losing them means losing unredeemed voucher value.** In production use a durable store.

SQLite (built into Node 22.5+):

```ts
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '@blockpay402/facilitator/sqlite';

createFacilitator({ /* … */ store: new SqliteStore(new DatabaseSync('/data/facilitator.db')) });
```

Back it up with `backup()` from `node:sqlite`, which is safe while the facilitator runs. For another database, implement `FacilitatorStore` (7 methods; `acceptVoucher` and `reserveTransaction` must be atomic).

Run **one facilitator instance per sponsor key**: two redeemers with the same key send conflicting claim transactions.

### Authentication and policy

```ts
listen(facilitator, 8080, {
  requireAuth: true,
  authenticate: async (c) => {
    const merchant = await lookupApiKey(c.req.header('authorization'));
    return merchant ? { id: merchant.id, allowedPayTo: merchant.addresses } : null;
  },
});

createFacilitator({
  // …
  hooks: {
    beforeVerify: async ({ payload, requirements, caller }) =>
      (await isSanctioned(requirements.payTo)) ? { accept: false, reason: 'rejected_by_policy' } : { accept: true },
    onSettled: (event) => ledger.insert(event),
    onRedeemed: (event) => notify(event),
  },
});
```

`createFacilitatorApp(facilitator, options)` returns the Hono app if you want to mount it in a larger server.

### Redemption

The redeemer starts automatically. Trigger it manually with `await facilitator.redeemNow('sui:mainnet', channelIds?)`.

### Deployment

* Fund the sponsor's **address balance**: from this repository, `BLOCKPAY_FACILITATOR_KEY=… pnpm ops:fund-sponsor <network> [SUI]`.
* Put TLS, request size limits and rate limiting in a reverse proxy in front.
* Use a dedicated gRPC provider; public fullnodes rate-limit.
* Run a single redeemer per sponsor key (or shard channels) to avoid conflicting claim transactions.

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
CMD ["node", "dist/index.js"]
```
