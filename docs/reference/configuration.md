# Configuration

### SDK defaults

| Setting | Default |
| --- | --- |
| Client `maxPerRequest` | `$0.10` |
| Client `channels.maxDeposit` | `$5` |
| Route `maxTimeoutSeconds` | `60` |
| Route `minDeposit` | `100 × price` |
| Sponsored gas budget (client) | 0.01 SUI |
| Sponsor policy `maxGasBudget` (facilitator) | 0.05 SUI |
| Channel `withdrawDelayMs` (facilitator) | 1 hour (contract allows 15 min – 30 days) |
| Channel state refresh | 30 s |
| Redeemer interval / max voucher age | 60 s / 5 min |
| `/supported` cache in servers | 5 min |
