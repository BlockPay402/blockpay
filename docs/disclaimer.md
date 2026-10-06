# Disclaimer

{% hint style="warning" %}
**Experimental software. Use it with caution.** This page summarizes the risks of using BlockPay. The full [Risk Disclaimer](https://blockpay.gg/disclaimer) and the [Terms of Use](https://blockpay.gg/terms) on blockpay.gg govern your use of BlockPay; where they differ from this page, they prevail.
{% endhint %}

BlockPay is experimental, open-source payment software built on the x402 open standard and the Sui blockchain. It moves real money on a public blockchain: only use amounts you can afford to lose. Each item below links to the matching section of the full Risk Disclaimer.

### Funds and finality

* **Loss of funds.** Bugs, mistakes, leaked or lost keys, attacks, network failures and issuer actions can all cause permanent loss. BlockPay does not guarantee that a payment completes, settles, is redeemed or refunded. [Loss of funds](https://blockpay.gg/disclaimer#loss-of-funds)
* **Irreversible transactions.** A transaction finalized on Sui cannot be undone. A wrong address, network, asset, price or decimals value loses the funds; BlockPay does not refund mistaken payments. [Irreversible transactions](https://blockpay.gg/disclaimer#irreversible)
* **Private keys.** Whoever holds a key controls its funds. BlockPay never holds your keys and cannot restore them. Each channel has its own voucher key, which can pay the channel's recipient up to the full deposit. [Private keys and wallets](https://blockpay.gg/disclaimer#keys)

### The software

* **Smart contract.** The `blockpay::channel` contract holds payer deposits and has **not been audited**. The mainnet package can still be upgraded: its `UpgradeCap` is held in a BlockPay cold wallet, and an upgrade can add code that acts on existing channels and their deposits, so until the package is made immutable (planned after the audit) you are also trusting that wallet. [Smart contract risk](https://blockpay.gg/disclaimer#smart-contracts)
* **Payment channels.** A payer's deposit is locked until the channel closes; a unilateral exit waits for the withdraw delay. For a recipient, an accepted voucher is a promise of payment until it is redeemed on-chain. [Payment channels](https://blockpay.gg/disclaimer#channels)
* **AI agents.** Agents can pay without a human approving each payment, and can be manipulated or loop. Budgets, caps and approvals protect you only if you configure them correctly; you are responsible for every payment your agents make. [Autonomous AI agents](https://blockpay.gg/disclaimer#agents)
* **Hosted facilitator and dashboard.** The service can be unavailable, slow or discontinued. Dashboard figures, exports and webhooks may be delayed or wrong; the Sui blockchain is the only source of truth. [Hosted facilitator and dashboard](https://blockpay.gg/disclaimer#facilitator)
* **Prepaid credit.** Credit pays platform fees only. It is not a deposit, earns no interest, may not be refundable, and is applied only to top-ups sent correctly from a registered address. [Prepaid credit and fees](https://blockpay.gg/disclaimer#credit)
* **Testnet and pre-release.** Testnet tokens have no value and testnet state can be reset. BlockPay is pre-1.0: interfaces, fees and features may change. Never send mainnet funds to a testnet-only address or contract. [Testnet and pre-release software](https://blockpay.gg/disclaimer#testnet)

### Assets, network and third parties

* **Stablecoins.** Stablecoins can lose their peg. Issuers such as Circle enforce on-chain deny lists that can freeze funds, including funds in a channel; BlockPay does not bypass them. [Stablecoins and digital assets](https://blockpay.gg/disclaimer#stablecoins)
* **Sui network.** Outages, congestion, protocol upgrades and RPC providers can delay, fail or change transactions. [Sui network risk](https://blockpay.gg/disclaimer#network)
* **Third parties.** Wallets, RPC providers, open-source packages, hosting and the evolving x402 standard are outside BlockPay's control. [Third-party software and services](https://blockpay.gg/disclaimer#third-parties)

### Not a financial institution

* BlockPay is **not a bank, payment processor, money transmitter or licensed financial institution**, and is not affiliated with or endorsed by any card network or regulated payment system. Funds are not insured. [Not a bank or financial institution](https://blockpay.gg/disclaimer#not-finance)
* BlockPay is **non-custodial**: funds move on-chain from payers to recipients, and the facilitator cannot move funds a payer did not authorize. For the same reason, BlockPay cannot recover, freeze, reverse or refund funds for you.
* You are responsible for the laws, taxes, KYC/AML controls and sanctions screening that apply to you. BlockPay performs no KYC/AML checks by default; the facilitator exposes hooks for your own. [Regulatory, legal and tax risk](https://blockpay.gg/disclaimer#regulatory)
* Nothing in these docs is financial, legal or tax advice. BlockPay is provided "as is", without warranties. [No advice, no warranty](https://blockpay.gg/disclaimer#no-advice)

### Acceptance of risk

By installing, integrating or otherwise using BlockPay you confirm that you have read the full [Risk Disclaimer](https://blockpay.gg/disclaimer) and [Terms of Use](https://blockpay.gg/terms), accept these risks, including the total loss of your funds, and will not hold BlockPay, its operators or contributors liable for any loss. [Acceptance of risk](https://blockpay.gg/disclaimer#acceptance)

{% hint style="danger" %}
If you do not accept these terms, **do not use BlockPay**. Questions: [hello@blockpay.gg](mailto:hello@blockpay.gg).
{% endhint %}
