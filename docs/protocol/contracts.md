# Move contracts

### `blockpay::channel`

Payment channels for [`batch-settlement`](schemes/batch-settlement.md). Source: `contracts/blockpay/sources/channel.move`. 28 unit tests, including shared test vectors with the TypeScript SDK.

The package has **no admin capability and no version gating**. Because of that, an upgrade could not fix a vulnerability: the old functions stay callable on existing objects. The publish script therefore either makes the package immutable (`--freeze`) or hands the `UpgradeCap` to a multisig (`--upgrade-cap-to`); on mainnet one of the two is required.

#### Objects

```move
public struct Registry has key { id: UID, shard: u64 }   // shared; parent of channel IDs (16 shards)

public struct Channel<phantom T> has key {      // shared
    id: UID,
    payer: address,
    payee: address,            // receives every claim
    operator: address,         // may cooperatively close
    authorizer: vector<u8>,    // Ed25519 public key that signs vouchers
    funds: Balance<T>,
    deposited: u64,
    claimed: u64,
    withdraw_delay_ms: u64,
    close_requested_at_ms: Option<u64>,
}
```

#### Functions

| Function | Caller | Effect |
| --- | --- | --- |
| `open<T>(registry, payee, operator, authorizer, withdraw_delay_ms, nonce, deposit: Balance<T>): ID` | payer | Creates and shares the channel at the ID derived from `(payer, nonce)`. |
| `top_up<T>(channel, funds: Balance<T>)` | anyone | Adds funds while the channel is open. |
| `claim<T>(channel, cumulative, signature)` | anyone | Verifies the voucher, sends `cumulative − claimed` to `payee`. |
| `close<T>(channel)` | payee or operator | Refunds the rest to `payer` and deletes the channel. |
| `request_close<T>(channel, clock)` | payer | Starts the withdraw delay. |
| `withdraw<T>(channel, clock)` | payer | After the delay: refunds and deletes. |
| `voucher_message(channel_id, cumulative): vector<u8>` | view | The exact bytes a voucher signs. |
| `channel_id(registry, payer, nonce): ID` | view | The ID a channel will have. |
| `shard(registry): u64`, `registry_shards(): u64` | view | Which shard a registry is; how many exist. |

#### Registry shards

`open` needs `&mut Registry`, so every open is sequenced through the registry it uses. `init` creates 16 registries so channel opens do not contend on one shared object. Clients pick the shard from the payer address (`registryFor` in `@blockpay402/sui`: `payer mod 16`); any shard is valid as long as the ID is derived under the same one. Deployments list them as `registryIds` (shard order); `registryId` is shard 0 and identifies the deployment in `batch-settlement` requirements.

#### Reading channels safely

Anyone can publish a module named `channel` with a look-alike `Channel` struct. Off-chain code must only accept objects whose type is `<packageId>::channel::Channel<T>` for the trusted package: `getChannel(client, channelId, packageId)` enforces this.

Funds are paid with `balance::send_funds`, into the recipient's address balance.

#### Events

`RegistryCreated` (once per shard, at publish), `ChannelOpened<T>`, `ChannelToppedUp<T>`, `ChannelClaimed<T>`, `ChannelCloseRequested<T>`, `ChannelClosed<T>`. The coin type is the event's type parameter.

#### Errors

| Code | Constant |
| --- | --- |
| 0 | `ENotPayer` |
| 1 | `ENotPayeeOrOperator` |
| 2 | `EInvalidSignature` |
| 3 | `EAmountNotIncreasing` |
| 4 | `EAmountExceedsDeposit` |
| 5 | `EInvalidPublicKey` |
| 6 | `EInvalidWithdrawDelay` (allowed: 15 min – 30 days) |
| 7 | `ECloseNotRequested` |
| 8 | `EWithdrawDelayNotElapsed` |
| 9 | `EZeroAmount` |
| 10 | `EChannelClosing` |

### Deployments

| Network | Package | Registry |
| --- | --- | --- |
| `sui:testnet` | [`0x2ea95b4e89bd9b06de0dba42061d83233eccbdf06d88ff011cd4b9e85a8499e4`](https://suiscan.xyz/testnet/object/0x2ea95b4e89bd9b06de0dba42061d83233eccbdf06d88ff011cd4b9e85a8499e4) | `0xbe4322c2ddef5534617dc80e93360d6a7c92a0d2b8b1535bbab37ab2b2f9c997` (shard 0 of 16; all shards in `deployments/testnet.json`) |
| `sui:mainnet` | [`0x270a878bd91a97830e4e399ad9343fb45f35904e1fa58782d22b9f5f09be222a`](https://suiscan.xyz/mainnet/object/0x270a878bd91a97830e4e399ad9343fb45f35904e1fa58782d22b9f5f09be222a) | `0x163e8384a8d5e82d5f56ad00cf94ff6459780a5ab42b00d8c7dbf1947652d99d` (shard 0 of 16; all shards in `deployments/mainnet.json`). **Not audited yet**; `UpgradeCap` held by a cold wallet until it is frozen after the audit. |

The SDK trusts the deployments listed here without extra configuration. For a network not listed yet, configure the deployment explicitly in clients (`networks[network].channel`) and in the facilitator.

### Build and test

```bash
cd contracts/blockpay
sui move build
sui move test
```
