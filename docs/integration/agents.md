# AI agents

`@blockpay402/agent` gives an agent a wallet whose limits the model cannot talk its way around.

```bash
npm i @blockpay402/agent
```

```ts
import { createAgentWallet } from '@blockpay402/agent';

const wallet = createAgentWallet({
  network: 'sui:mainnet',
  privateKey: process.env.AGENT_KEY!,
  budgets: {
    perRequest: '$0.05',                          // hard cap per call
    perDay: '$5',                                 // hard cap per rolling 24h
    perHost: { 'api.example.com': '$2' },          // hard cap per host per 24h
    total: '$20',                                 // hard cap for this wallet instance (e.g. one task)
  },
  softThreshold: '$0.01',                         // above this, ask
  approve: async (req) => askHuman(`Pay ${req.amount} to ${req.host} for ${req.description}?`),
  onSettled: (record) => audit.append(record),    // every attempt, paid or not
});

const res = await wallet.fetch('https://api.example.com/v1/credit/acme-trading-co');
```

* **Hard caps** are checked in code before anything is signed. Exceeding one throws `PaymentCapExceededError`.
* **Soft threshold**: payments above it go to `approve`; without an `approve` hook they are declined.
* **Audit**: `onSettled` receives a `PaymentRecord` (URL, scheme, amount, asset, payee, transaction, success, error).
* `wallet.spent` and `wallet.records` give the running total and history.

### On-chain limits

Code-level caps protect against the model; they do not protect against a compromised process. For a ceiling enforced by Sui itself:

* Fund the agent's address with only what it may spend, or
* Prefer `batch-settlement`: each channel's voucher key can pay only one payee, at most the deposit. Configure `channels.maxDeposit` to bound what any one server can collect.

### As an LLM tool

`wallet.asTool()` returns a provider-neutral tool definition (`name`, `description`, JSON Schema `inputSchema`, `execute`). The description states the budget so the model can decide whether a call is worth it. Failed or refused payments come back as tool output, not exceptions.

With Claude, using the Anthropic TypeScript SDK's tool runner:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';

const payAndFetch = wallet.asTool();
const client = new Anthropic();

const message = await client.beta.messages.toolRunner({
  model: 'claude-opus-5-5',
  max_tokens: 16000,
  // Re-run on a fallback model if a request is declined by safety classifiers.
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
  tools: [
    betaTool({
      name: payAndFetch.name,
      description: payAndFetch.description,
      inputSchema: payAndFetch.inputSchema,
      run: async (input) => JSON.stringify(await payAndFetch.execute(input)),
    }),
  ],
  messages: [
    {
      role: 'user',
      content:
        'Should we extend 90-day payment terms to Acme Trading Co.? Check its credit score at ' +
        'https://api.example.com/v1/credit/acme-trading-co and Vietnam\'s latest CPI and policy rate at ' +
        'https://api.example.com/v1/macro/VN/cpi and https://api.example.com/v1/macro/VN/policy-rate.',
    },
  ],
});

if (message.stop_reason === 'refusal') throw new Error('Request declined');
```

The same `asTool()` object works with MCP servers and other function-calling APIs: expose `inputSchema`, call `execute`.

### Patterns

* **Per-task wallets**: create a wallet per task with `budgets.total`; discard it afterwards.
* **Human in the loop for new hosts**: approve the first payment to a host, auto-approve the rest under the threshold.
* **Persist channels** across restarts with `channels: { store: new FileChannelStore(path) }` so deposits are reused instead of reopened.
