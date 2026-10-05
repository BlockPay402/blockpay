# FAQ

**Do payers need an account or API key?**
No. A Sui key and funds are enough. Only merchants using the hosted facilitator use API keys.

**Do payers need SUI for gas?**
Not for USDC payments of $0.01 or more (gasless on Sui). Below that, the facilitator can sponsor gas, or the payment goes through a channel. Opening a channel can also be sponsored.

**Can the facilitator steal funds?**
No. In `exact` the payer signs the complete transaction. In channels, the contract only pays the payee or refunds the payer. The facilitator can refuse service or go offline; payers can exit channels without it.

**What does BlockPay charge?**
Merchants on the hosted facilitator pay a flat fee per settled payment from prepaid credit (top up in USDC from the dashboard). Callers pay only the quoted price. Sui gas for sponsored transactions is paid by the facilitator. Self-hosting is free.

**Is it compatible with other x402 implementations?**
Yes for `exact` on Sui: wire formats follow x402 v2. `batch-settlement` on Sui is BlockPay's own binding for now; it will be proposed upstream after it has run in production.

**Why do my channel payments show as "committed"?**
A voucher was accepted but not yet redeemed on-chain. Redemption runs every minute by default; "Redeem now" on the Channels page forces it.

**What happens if settlement fails after my handler ran?**
The client gets `402`; your response is discarded, not sent. Use `before-handler` on routes where doing the work unpaid is costly.

**Can I accept other tokens?**
Any `Coin<T>` the facilitator allows. Register its decimals with `registerAsset`.

**Other chains?**
Networks are CAIP-2 identifiers and schemes are pluggable. Sui comes first; see the [Roadmap](roadmap.md).
