# Schemes

A **scheme** is how value moves; a **network** is where. Together with an **asset** they tell a facilitator how to verify and settle.

| Scheme | Status | Summary |
| --- | --- | --- |
| [`exact`](exact.md) | Supported | The payer signs a full Sui transaction paying exactly `amount` to `payTo`. |
| [`batch-settlement`](batch-settlement.md) | Supported (BlockPay Sui binding) | Escrowed channel + off-chain cumulative vouchers, redeemed in batches. |
| `upto` | Planned | Pay up to a ceiling, charged on actual usage (e.g. LLM tokens). Can be built on channels with server-signed vouchers. |

### Choosing

* Price **≥ $0.01** in USDC and calls are occasional → `exact`. Gasless, final immediately.
* Price **< $0.01**, or many calls from the same payer → `batch-settlement`.
* Offer both: clients take the first option they support. BlockPay servers do this by default.

### Adding a scheme

A scheme is defined by three things: the payload the client signs, the checks the facilitator runs, and the on-chain effect of settlement. Propose one by opening a spec PR with those three parts, a reference implementation and test vectors. Breaking changes follow x402 versioning.
