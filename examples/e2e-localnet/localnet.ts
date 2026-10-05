/** Helpers for a local Sui network started with `sui start --with-faucet --force-regenesis`. */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

const here = dirname(fileURLToPath(import.meta.url));
export const SUI_BIN = process.env.SUI_BIN ?? 'sui';
export const GRPC_URL = process.env.SUI_GRPC_URL ?? 'http://127.0.0.1:9000';
export const FAUCET_URL = process.env.SUI_FAUCET_URL ?? 'http://127.0.0.1:9123';
export const SUI = '0x2::sui::SUI';

export const sui = new SuiGrpcClient({ network: 'localnet', baseUrl: GRPC_URL });

export async function fund(...addresses: string[]) {
  await Promise.all(addresses.map((recipient) => requestSuiFromFaucetV2({ host: FAUCET_URL, recipient })));
  await new Promise((r) => setTimeout(r, 1500));
}

export async function balance(owner: string, coinType = SUI): Promise<bigint> {
  const { balance } = await sui.core.getBalance({ owner, coinType });
  return BigInt(balance.balance);
}

/** Publish contracts/blockpay and return the channel deployment. */
export async function publishChannelPackage(publisher: Ed25519Keypair) {
  const output = execFileSync(
    SUI_BIN,
    ['move', 'build', '--dump-bytecode-as-base64', '-e', 'mainnet', '--path', resolve(here, '../../contracts/blockpay')],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const { modules, dependencies } = JSON.parse(output.slice(output.indexOf('{'))) as { modules: string[]; dependencies: string[] };
  const tx = new Transaction();
  tx.transferObjects([tx.publish({ modules, dependencies })], publisher.toSuiAddress());
  const result = await sui.core.signAndExecuteTransaction({
    transaction: tx,
    signer: publisher,
    include: { effects: true, objectTypes: true },
  });
  if (result.$kind !== 'Transaction') throw new Error('publish failed');
  const { effects, objectTypes } = result.Transaction;
  const packageId = effects.changedObjects.find((o) => o.outputState === 'PackageWrite')?.objectId;
  const registryId = Object.entries(objectTypes).find(([, type]) => type.endsWith('::channel::Registry'))?.[0];
  if (!packageId || !registryId) throw new Error('package or registry not found in publish effects');
  await sui.core.waitForTransaction({ result });
  return { packageId, registryId };
}

/** Sponsoring from an address balance needs SUI there, not in coin objects. */
export async function depositToAddressBalance(owner: Ed25519Keypair, amount: bigint) {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [amount]);
  tx.moveCall({ target: '0x2::coin::send_funds', typeArguments: [SUI], arguments: [coin!, tx.pure.address(owner.toSuiAddress())] });
  const result = await sui.core.signAndExecuteTransaction({ transaction: tx, signer: owner });
  if (result.$kind !== 'Transaction') throw new Error('address-balance deposit failed');
  await sui.core.waitForTransaction({ result });
}
