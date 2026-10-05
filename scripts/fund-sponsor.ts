/**
 * Move the facilitator's SUI into its address balance. The facilitator sponsors gas from its
 * address balance (not from coin objects), so top it up here whenever /health shows it low.
 *
 *   BLOCKPAY_FACILITATOR_KEY=suiprivkey1… pnpm ops:fund-sponsor testnet          # all but one coin
 *   BLOCKPAY_FACILITATOR_KEY=suiprivkey1… pnpm ops:fund-sponsor testnet 25       # exactly 25 SUI
 */
import { Transaction } from '@mysten/sui/transactions';
import { client, die, formatSui, keypair, parseNetwork } from './lib.js';

const [networkArg, amountArg] = process.argv.slice(2);
const network = parseNetwork(networkArg);
const signer = keypair('BLOCKPAY_FACILITATOR_KEY');
const sui = client(network);
const owner = signer.toSuiAddress();
const SUI = '0x2::sui::SUI';

const show = async (label: string) => {
  const { balance } = await sui.core.getBalance({ owner, coinType: SUI });
  console.log(`${label}: coins ${formatSui(balance.coinBalance)} · address balance ${formatSui(balance.addressBalance)}`);
  return balance;
};

console.log(`facilitator ${owner} on ${network}`);
const before = await show('before');
// Keep 0.1 SUI in coins to pay for this and later maintenance transactions.
const reserve = 100_000_000n;
const available = BigInt(before.coinBalance) - reserve;
const amount = amountArg ? BigInt(Math.round(Number(amountArg) * 1e9)) : available;
if (amount <= 0n || amount > available) die(`not enough SUI in coin objects (available ${formatSui(available > 0n ? available : 0n)})`);

const tx = new Transaction();
const [coin] = tx.splitCoins(tx.gas, [amount]);
tx.moveCall({ target: '0x2::coin::send_funds', typeArguments: [SUI], arguments: [coin!, tx.pure.address(owner)] });
const result = await sui.core.signAndExecuteTransaction({ transaction: tx, signer });
if (result.$kind === 'FailedTransaction') die(`deposit failed: ${result.FailedTransaction.digest}`);
await sui.core.waitForTransaction({ result });
console.log(`✓ moved ${formatSui(amount)} (tx ${result.Transaction.digest})`);
await show('after');
