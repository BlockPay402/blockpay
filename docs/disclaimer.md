# Disclaimer

BlockPay is experimental, open-source payment software built on the x402 open standard and the Sui blockchain. Read this before using it.

### This is not traditional finance

* BlockPay is **not a bank, payment processor or licensed financial institution**.
* BlockPay is **not affiliated with or endorsed by** Visa, Mastercard, SWIFT or any regulated payment network.
* BlockPay does **not** provide fiat services, currency exchange or regulated money transmission.
* BlockPay is non-custodial: funds move from payers to recipients on-chain. The facilitator verifies and broadcasts transactions; it cannot move funds a payer did not authorize.

### Regulatory responsibility

* You are responsible for complying with the laws and regulations that apply to you.
* Stablecoin payments and AI-agent commerce may be restricted or licensed in some jurisdictions.
* BlockPay performs no KYC/AML checks by default. Operators must add the compliance controls their jurisdiction requires (the facilitator exposes hooks for this).
* Regulated stablecoins such as USDC enforce issuer deny lists on-chain. BlockPay does not bypass them.

### Technology risk

* Blockchain transactions are irreversible. Funds sent by mistake cannot be recovered.
* x402 is an evolving standard; BlockPay will follow its changes.
* The `blockpay::channel` Move contract has **not been audited**. Use testnet or small amounts until an audit is published.
* AI agents can initiate payments without a human present. You are responsible for configuring budgets, caps and approvals.
* Experimental software can have bugs, downtime and losses.

### Acceptance of risk

By installing, integrating or otherwise using BlockPay you acknowledge that you have read this disclaimer, understand that the software is experimental, accept the risks of blockchain-based payments, and will not hold the authors or contributors liable for any loss arising from your use of it.

{% hint style="danger" %}
If you do not accept these terms, **do not use BlockPay**.
{% endhint %}
