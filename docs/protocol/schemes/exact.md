# exact

Transfer **exactly** `amount` of `asset` from the payer to `payTo`, once per request. BlockPay implements the x402 [`exact` scheme for Sui](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_sui.md), using Sui Address Balances.

### Payload

The payer signs a **complete Sui transaction**. The facilitator can only broadcast it as signed, so it cannot change the amount or recipient.

```json
{
  "transaction": "<base64 BCS TransactionData>",
  "signature": "<base64 Sui signature over the transaction>"
}
```

### The transaction

```ts
tx.moveCall({
  target: '0x2::balance::send_funds',
  typeArguments: [asset],
  arguments: [tx.balance({ type: asset, balance: amount }), tx.pure.address(payTo)],
});
```

`tx.balance()` draws from the payer's address balance first, then from coin objects. `send_funds` credits `payTo`'s address balance, so no new coin object is created.

### Gas

The client chooses, guided by `extra`:

| Mode | When | Transaction |
| --- | --- | --- |
| **gasless** | `extra.gasless: true` — USDC (or another allow-listed stablecoin) and `amount` ≥ 0.01 units | `gasPrice = 0`, `gasPayment = []`. Nobody pays gas. |
| **sponsored** | `extra.feePayer` is set | `gasOwner = feePayer`, `gasPayment = []`: the sponsor pays from its address balance. No interactive gas-station round trip. The payment must not draw from the gas coin. |
| **self** | neither | The payer pays gas in SUI. |

{% hint style="info" %}
`extra.feePayer` with an empty gas payment is BlockPay's non-interactive alternative to the spec's interactive `extra.gasStation` flow, made possible by Address Balances. It will be proposed upstream once it has run in production.
{% endhint %}

### Verification (facilitator)

1. `accepted` equals the requirements; `network` and `asset` are accepted by this facilitator.
2. The transaction decodes; the signature is valid for its sender (Ed25519, Secp256k1, Secp256r1, zkLogin and multisig are supported via `@mysten/sui/verify`).
3. If the gas owner is not the sender: it must be this facilitator, gas must come from its address balance, the budget must be under the cap, and the commands must be framework coin/balance operations only, without the gas coin.
4. The digest has not been settled before.
5. Simulation succeeds, and the balance changes credit `payTo` with exactly `amount` of `asset`.

### Settlement

1. Re-run checks 1–3.
2. Reserve the digest (atomic). A second request carrying the same transaction is rejected with `invalid_exact_sui_payload_already_settled` — necessary because re-submitting an executed Sui transaction returns its original successful effects.
3. Co-sign as sponsor if needed, execute, and confirm the balance change again.
4. If the broadcast cannot be confirmed in time, return `settlement_pending` with the digest and keep the reservation.

### Replay and expiry

* A signed transaction executes at most once.
* Address-balance transactions carry a `ValidDuring` expiration of one or two epochs, so stale payloads become invalid.
* The digest store prevents one payment from paying for two requests.

### Receipts

The receipt is the transaction digest plus the on-chain balance change. No extra Move call is added: that would make the transaction ineligible for gasless execution.
