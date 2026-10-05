/**
 * Publish or freeze the blockpay::channel package.
 *
 *   DEPLOYER_KEY=suiprivkey1… pnpm contract:publish testnet --dry-run
 *   DEPLOYER_KEY=suiprivkey1… pnpm contract:publish testnet
 *   DEPLOYER_KEY=suiprivkey1… pnpm contract:freeze testnet     # irreversible: make the package immutable
 *
 * Writes deployments/<network>.json with the package, registry and UpgradeCap IDs.
 * Needs the Sui CLI (>= 1.72) on PATH, or SUI_BIN.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transaction } from '@mysten/sui/transactions';
import { type Network, client, die, formatSui, keypair, parseNetwork } from './lib.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [command, networkArg, ...flags] = process.argv.slice(2);
const network = parseNetwork(networkArg);
const dryRun = flags.includes('--dry-run');
const deploymentFile = resolve(root, 'deployments', `${network}.json`);

interface Deployment {
  network: string;
  packageId: string;
  registryId: string;
  upgradeCapId: string | null;
  publisher: string;
  digest: string;
  publishedAt: string;
  immutable: boolean;
}

function buildBytecode(net: Network) {
  // Localnet and devnet run the CLI's own framework; build against testnet's pinned framework.
  const env = net === 'mainnet' ? 'mainnet' : 'testnet';
  const output = execFileSync(
    process.env.SUI_BIN ?? 'sui',
    ['move', 'build', '--dump-bytecode-as-base64', '-e', env, '--path', resolve(root, 'contracts/blockpay')],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return JSON.parse(output.slice(output.indexOf('{'))) as { modules: string[]; dependencies: string[]; digest: number[] };
}

async function publish() {
  if (existsSync(deploymentFile) && !dryRun && !flags.includes('--force')) {
    die(`${deploymentFile} exists. Pass --force to publish a second, separate package.`);
  }
  const signer = keypair('DEPLOYER_KEY');
  const sui = client(network);
  const sender = signer.toSuiAddress();
  const { balance } = await sui.core.getBalance({ owner: sender });
  console.log(`network   ${network}\npublisher ${sender}\nbalance   ${formatSui(balance.balance)}`);

  const { modules, dependencies } = buildBytecode(network);
  const tx = new Transaction();
  tx.setSender(sender);
  const [upgradeCap] = tx.publish({ modules, dependencies });
  tx.transferObjects([upgradeCap!], sender);

  const simulation = await sui.core.simulateTransaction({ transaction: tx, include: { effects: true } });
  if (simulation.$kind === 'FailedTransaction') die(`simulation failed: ${JSON.stringify(simulation.FailedTransaction.status)}`);
  const gas = simulation.Transaction.effects.gasUsed;
  const cost = BigInt(gas.computationCost) + BigInt(gas.storageCost) - BigInt(gas.storageRebate);
  console.log(`simulated ok, estimated cost ${formatSui(cost)}`);
  if (dryRun) return console.log('dry run: nothing published');

  const result = await sui.core.signAndExecuteTransaction({
    transaction: tx,
    signer,
    include: { effects: true, objectTypes: true },
  });
  if (result.$kind === 'FailedTransaction') die(`publish failed: ${result.FailedTransaction.digest}`);
  await sui.core.waitForTransaction({ result });
  const { effects, objectTypes, digest } = result.Transaction;
  const packageId = effects.changedObjects.find((o) => o.outputState === 'PackageWrite')?.objectId;
  const registryId = Object.entries(objectTypes).find(([, t]) => t.endsWith('::channel::Registry'))?.[0];
  const upgradeCapId = Object.entries(objectTypes).find(([, t]) => t === '0x0000000000000000000000000000000000000000000000000000000000000002::package::UpgradeCap')?.[0];
  if (!packageId || !registryId) die(`published (${digest}) but package/registry not found in effects`);

  const deployment: Deployment = {
    network: `sui:${network}`,
    packageId,
    registryId,
    upgradeCapId: upgradeCapId ?? null,
    publisher: sender,
    digest,
    publishedAt: new Date().toISOString(),
    immutable: false,
  };
  writeFileSync(deploymentFile, `${JSON.stringify(deployment, null, 2)}\n`);
  const suffix = network.toUpperCase();
  console.log(`\n✓ published in ${digest}\n  wrote ${deploymentFile}\n`);
  console.log(`Platform env:\n  BLOCKPAY_CHANNEL_PACKAGE_${suffix}=${packageId}\n  BLOCKPAY_CHANNEL_REGISTRY_${suffix}=${registryId}\n`);
  console.log(`SDK (packages/core/src/deployments.ts):\n  'sui:${network}': { packageId: '${packageId}', registryId: '${registryId}' },`);
}

async function freeze() {
  if (!existsSync(deploymentFile)) die(`${deploymentFile} not found`);
  const deployment = JSON.parse(readFileSync(deploymentFile, 'utf8')) as Deployment;
  if (deployment.immutable || !deployment.upgradeCapId) die('package is already immutable');
  if (!flags.includes('--yes')) {
    die(`This makes ${deployment.packageId} immutable forever (no upgrades, no bug fixes). Re-run with --yes to confirm.`);
  }
  const signer = keypair('DEPLOYER_KEY');
  const sui = client(network);
  const tx = new Transaction();
  tx.moveCall({ target: '0x2::package::make_immutable', arguments: [tx.object(deployment.upgradeCapId)] });
  const result = await sui.core.signAndExecuteTransaction({ transaction: tx, signer });
  if (result.$kind === 'FailedTransaction') die(`freeze failed: ${result.FailedTransaction.digest}`);
  await sui.core.waitForTransaction({ result });
  writeFileSync(deploymentFile, `${JSON.stringify({ ...deployment, upgradeCapId: null, immutable: true }, null, 2)}\n`);
  console.log(`✓ ${deployment.packageId} is now immutable (tx ${result.Transaction.digest})`);
}

if (command === 'publish') await publish();
else if (command === 'freeze') await freeze();
else die('usage: contract.ts <publish|freeze> <network> [--dry-run] [--force] [--yes]');
