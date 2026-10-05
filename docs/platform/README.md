# Hosted facilitator & dashboard

The BlockPay platform is a hosted facilitator plus a merchant dashboard. Payers never need an account; **merchants** sign in to manage what they receive.

### Sign in with your wallet

Open the dashboard, connect the Sui wallet that receives your payments, and sign a message. No email or password: the signature proves you control the address. The first sign-in creates your merchant account and registers that address as a receiving address.

### Dashboard

| Page | |
| --- | --- |
| **Overview** | Volume per asset, paid calls, unique payers, value awaiting redemption, daily chart, top endpoints. |
| **Payments** | Every payment: endpoint, payer, scheme, status, amount, transaction. Filter and export CSV. `settled` = final on Sui; `committed` = channel voucher accepted, not yet redeemed. |
| **Channels** | Channels paying you: deposit, accepted, redeemed, unredeemed, status. "Redeem now" claims immediately. |
| **Developers** | API keys (shown once, stored hashed), facilitator URL, integration snippet. |
| **Billing** | Prepaid credit balance, top-up instructions, credit history. |
| **Webhooks** | Endpoint, signing secret, test events, delivery log. |
| **Settings** | Name and receiving addresses. Adding an address requires a signature from it. |

### API keys

Servers authenticate to the hosted facilitator with `Authorization: Bearer bp_live_…` (the SDK sends it when you set `facilitator.apiKey`). A key can only verify and settle payments **to your registered receiving addresses**, which stops others from spending your sponsorship on unrelated payments and keeps your ledger clean. Revoke keys from the dashboard at any time.

### Fees: prepaid credit

The hosted facilitator charges a **flat fee per payment** settled with your API key, drawn from **prepaid credit**. Your callers pay exactly the quoted price; the fee never touches the payment itself.

* **Top up**: send USDC to the BlockPay treasury address shown on the Billing page, **from one of your registered addresses**, then paste the transaction digest. The platform reads the transaction on-chain, checks the sender and the amount received, and credits it 1:1 in USD. Each transaction credits once.
* **Usage**: every settled payment (an `exact` transfer or an accepted channel voucher) deducts the fee and appears in the credit history with the payment ID.
* **Running out**: when credit cannot cover the fee, the facilitator refuses new payments to your addresses with `insufficient_platform_credit` (callers get a `402`). Payments already in flight still complete, so the balance can dip slightly below zero.
* **Alerts**: a `billing.low_balance` webhook fires once when the balance crosses below the threshold (default $1), and the dashboard shows a banner.

Calls without an API key (anonymous mode, if the operator enables it) are not charged.

### Running your own instead

The hosted platform is BlockPay's managed service. To verify and settle payments yourself, run the open-source facilitator from `@blockpay402/facilitator` (see [Facilitator SDK](../integration/facilitator-sdk.md)); servers then point `facilitator.url` at your instance. You get the same payment flows, without the dashboard, ledger, billing and webhooks.
