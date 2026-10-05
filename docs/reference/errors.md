# Error codes

Returned as `invalidReason` (verify), `errorReason` (settle) and as `error` in a fresh `PAYMENT-REQUIRED`.

### x402 v2 codes

| Code | Meaning | Client action |
| --- | --- | --- |
| `insufficient_funds` | The payer cannot cover the payment. | Fund the wallet, retry. |
| `invalid_network` | Network not supported by this facilitator. | Pick another option. |
| `invalid_payload` | Payload is malformed. | Fix the client. |
| `invalid_payment_requirements` | Requirements are malformed or not accepted (asset, channel deployment). | — |
| `unsupported_scheme` | Scheme not supported on this network. | Pick another option. |
| `invalid_x402_version` | Not x402 v2. | Upgrade the client. |
| `invalid_transaction_state` | The transaction failed on-chain. | Inspect the digest. |
| `unexpected_verify_error` / `unexpected_settle_error` | Facilitator error (or unreachable). | Retry later. |
| `settlement_pending` | Broadcast sent, confirmation not established. `transaction` holds the digest. | Check the digest on-chain before paying again. |

### BlockPay codes

| Code | Meaning |
| --- | --- |
| `payment_requirements_mismatch` | `accepted` differs from what the server offers. Request a fresh 402. |
| `invalid_exact_sui_payload_signature` | Signature invalid for the transaction sender. |
| `invalid_exact_sui_payload_transaction` | Transaction bytes cannot be decoded. |
| `invalid_exact_sui_payload_amount_mismatch` | `payTo` would receive a different amount. |
| `invalid_exact_sui_payload_recipient_mismatch` | `payTo` would receive nothing of `asset`. |
| `invalid_exact_sui_payload_sponsor_policy` | Sponsored transaction rejected: wrong sponsor, non-coin commands, gas coin use or gas budget over the cap. |
| `invalid_exact_sui_payload_already_settled` | This transaction already paid for a request. |
| `invalid_batch_settlement_sui_channel_not_found` | Channel does not exist (never opened or closed). |
| `invalid_batch_settlement_sui_channel_mismatch` | Channel payee, asset, operator or network differ from the requirements. |
| `invalid_batch_settlement_sui_channel_closing` | Payer requested a close; open a new channel. |
| `invalid_batch_settlement_sui_voucher_signature` | Voucher not signed by the channel authorizer. |
| `invalid_batch_settlement_sui_voucher_stale` | Cumulative amount does not exceed the watermark by the price (replay or out of order). |
| `invalid_batch_settlement_sui_voucher_exceeds_deposit` | Voucher above the deposit; top up. |
| `invalid_batch_settlement_sui_open_transaction` | Open/top-up transaction does not create the declared channel with the required terms. |
| `pay_to_not_allowed` | API key may not settle to this `payTo` (hosted facilitator). |
| `insufficient_platform_credit` | The merchant's prepaid credit cannot cover the platform fee (hosted facilitator). The merchant must top up; the caller cannot fix it. |
| `rejected_by_policy` | Rejected by an operator hook (e.g. screening). |
| `unauthorized` | Missing or invalid API key. |

### Client exceptions

| Exception | When |
| --- | --- |
| `PaymentCapExceededError` | A cap would be exceeded (`details.scope`: `request`, `day`, `deposit`, `asset`, `host:<host>`, `total`). Nothing was signed. |
| `PaymentDeclinedError` | The approval hook declined. |
| `NoSupportedRequirementError` | No payable option. |
