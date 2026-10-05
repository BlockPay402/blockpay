# Client SDK

Call x402 endpoints and pay automatically, within caps you set.

```bash
npm i @blockpay402/client
```

### `createPayingFetch`

```ts
import { createPayingFetch, getPaymentResponse } from '@blockpay402/client';

const pay = createPayingFetch({
  privateKey: process.env.BLOCKPAY_PRIVATE_KEY!, // or `signer` (KMS, hardware, wallet)
  network: 'sui:mainnet',
  maxPerRequest: '$0.05',  // default $0.10; payments in other assets are refused
  dailyCap: '$5',          // rolling 24h
});

const res = await pay('https://api.example.com/weather?city=Hanoi');
const receipt = getPaymentResponse(res); // { success, transaction, network, payer, amount }
```

It has the signature of `fetch`, so it plugs into anything that accepts a custom fetch.

What it does:

1. Sends the request. Anything but `402` is returned unchanged.
2. On `402`, reads `PAYMENT-REQUIRED` and keeps the options it can pay (network, scheme, trusted channel deployment).
3. Checks the price against `maxPerRequest` and `dailyCap`. Over the cap → throws `PaymentCapExceededError` **without signing**.
4. Calls `onPaymentRequired` if set (return `false` to decline).
5. Signs and retries once with `PAYMENT-SIGNATURE`. Returns that response, paid or not.

### Options

| Option | Default | |
| --- | --- | --- |
| `signer` / `privateKey` | — | `suiprivkey1…`, 32-byte hex, or a Sui keystore entry. |
| `network` | all configured | Only pay on this network. |
| `networks` | public fullnodes | Per network: `{ grpcUrl?, client?, channel? }`. `channel` is the trusted `blockpay::channel` deployment. |
| `maxPerRequest` | `$0.10` | Hard cap per payment. |
| `dailyCap` | — | Hard cap per rolling 24 hours. |
| `schemes` | server order | e.g. `['batch-settlement', 'exact']`. |
| `gas` | `'auto'` | `exact` gas: `auto` = gasless, else server sponsor, else self. `'self'` never uses a sponsor. |
| `channels` | — | `{ deposit?, maxDeposit? = $5, store? }` |
| `onPaymentRequired` | — | Approval hook. |
| `onPayment` | — | Called with a `PaymentRecord` after every attempt. |

### Channels

When a server offers `batch-settlement` and the client trusts the channel deployment for that network, the first payment opens a channel and later ones are vouchers:

```ts
const pay = createPayingFetch({
  privateKey,
  network: 'sui:mainnet',
  networks: { 'sui:mainnet': { channel: { packageId: '0x…', registryId: '0x…' } } },
  maxPerRequest: '$0.01',
  channels: { deposit: '$1', maxDeposit: '$5', store: new FileChannelStore('./channels.json') },
});
```

* The deposit is locked, not spent; caps apply to each request's price.
* A fresh Ed25519 voucher key is generated per channel and kept in the store. It can only pay that channel's payee, up to the deposit. **Protect the store like a key file.**
* One voucher is in flight per channel; concurrent calls to the same server are queued.
* When the deposit runs out, the next payment includes a top-up.
* If the facilitator rejects the channel (closed, out of sync), the client parks it, opens a new one and retries once.

Recover unspent deposits without the facilitator:

```ts
import { exitChannel } from '@blockpay402/client';

await exitChannel(pay.paymentClient, { network: 'sui:mainnet', channelId });
// → { state: 'requested', withdrawableAtMs }; call again after that time → { state: 'withdrawn' }
```

### Address balances

Payments drawn from an **address balance** do not depend on coin object versions, so many can be prepared at once. Move coins into your address balance once:

```ts
import { depositCoinsToAddressBalance } from '@blockpay402/client';
await depositCoinsToAddressBalance(pay.paymentClient, { network: 'sui:mainnet', coinType: USDC });
```

With coin objects, the client waits for its previous payment to be indexed before building the next transaction.

### Axios

```ts
import axios from 'axios';
import { attachPaymentInterceptor } from '@blockpay402/client';

const api = attachPaymentInterceptor(axios.create({ baseURL: 'https://api.example.com' }), {
  privateKey,
  network: 'sui:mainnet',
  maxPerRequest: '$0.05',
});
const { data } = await api.get('/weather', { params: { city: 'Hanoi' } });
```

### Lower level

`PaymentClient.prepare(url, paymentRequired)` returns `{ header, requirements, complete(settlement, ok) }` for custom transports (WebSockets, MCP, queues). Call `complete` once the outcome is known; it releases the channel lock and records the payment.

### Errors

| Error | Meaning |
| --- | --- |
| `PaymentCapExceededError` | A cap would be exceeded. Nothing was signed. `details.scope` tells which cap. |
| `PaymentDeclinedError` | `onPaymentRequired` returned `false`. |
| `NoSupportedRequirementError` | No offered option is payable by this client (network, scheme, untrusted channel deployment). |
