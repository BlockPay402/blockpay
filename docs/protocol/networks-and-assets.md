# Networks & assets

### Networks

Networks use [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) identifiers.

| Network | ID | Notes |
| --- | --- | --- |
| Sui mainnet | `sui:mainnet` | Real funds. |
| Sui testnet | `sui:testnet` | Test USDC from the [Circle faucet](https://faucet.circle.com/); SUI from the Sui faucet. |
| Sui devnet | `sui:devnet` | Resets periodically. |
| Local network | `sui:localnet` | `sui start --with-faucet --force-regenesis`. |

The SDK accepts `testnet`, `sui-testnet` and `sui:testnet` and normalizes them to CAIP-2.

{% hint style="info" %}
Public Sui fullnodes no longer serve JSON-RPC. BlockPay uses gRPC (`https://fullnode.<network>.sui.io:443`). Use a dedicated provider for production traffic.
{% endhint %}

### Assets

`asset` is always a fully-qualified coin type. The SDK resolves symbols for you.

| Asset | Network | Coin type | Decimals | Gasless |
| --- | --- | --- | --- | --- |
| USDC | mainnet | `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` | 6 | yes (≥ 0.01) |
| USDC | testnet | `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC` | 6 | yes (≥ 0.01) |
| SUI | all | `0x2::sui::SUI` | 9 | no |
| Any `Coin<T>` | — | `<package>::<module>::<NAME>` | from metadata | if allow-listed by Sui |

Register other coins with `registerAsset(network, { symbol, coinType, decimals })`.

### Amounts

Amounts on the wire are **strings of atomic units** (USDC: 1 = 0.000001 USDC). In code you can write prices as:

```ts
price: '$0.001'                                   // USD → USDC on the configured network
price: 0.001                                      // same
price: { amount: '1000', asset: 'USDC' }          // atomic units of a known asset
price: { amount: '5', asset: '0x…::coin::COIN', decimals: 2 }
```

Prices with more precision than the asset supports are rejected rather than rounded.

### Gasless transfers

Sui transfers allow-listed stablecoins without gas when the transaction only moves balances (`0x2::balance::send_funds` and related calls) and the amount is at least **0.01** units. BlockPay sets `extra.gasless: true` on `exact` requirements that qualify. Below that, `exact` needs a sponsor; `batch-settlement` is usually the better fit.
