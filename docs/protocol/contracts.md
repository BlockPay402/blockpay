# Move contracts

### `blockpay::channel`

Payment channels for [`batch-settlement`](schemes/batch-settlement.md). Source: `contracts/blockpay/sources/channel.move`. 19 unit tests, including shared test vectors with the TypeScript SDK.

The package has **no admin capability and no upgrade-dependent logic**. Plan: publish to testnet now; after an audit, publish to mainnet and make the package immutable.

#### Objects

```move
public struct Registry has key { id: UID }      // shared; parent of all channel IDs

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

Funds are paid with `balance::send_funds`, into the recipient's address balance.

#### Events

`ChannelOpened<T>`, `ChannelToppedUp<T>`, `ChannelClaimed<T>`, `ChannelCloseRequested<T>`, `ChannelClosed<T>`. The coin type is the event's type parameter.

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
| `sui:testnet` | [`0x84443af24c3b4fdfc5dc3df15d1cb11c6c0f00434890d58cf0188c6a5eb8083e`](https://suiscan.xyz/testnet/object/0x84443af24c3b4fdfc5dc3df15d1cb11c6c0f00434890d58cf0188c6a5eb8083e) | `0x96dbbded5ab4bf48bfc3643b57ef1d18c156b28475506e8a182564f25ddab228` |
| `sui:mainnet` | _after audit_ | _after audit_ |

The SDK trusts the deployments listed here without extra configuration. For a network not listed yet, configure the deployment explicitly in clients (`networks[network].channel`) and in the facilitator.

### Build and test

```bash
cd contracts/blockpay
sui move build
sui move test
```
