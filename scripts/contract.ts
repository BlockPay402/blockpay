/**
 * Publish or freeze the blockpay::channel package.
 *
 *   DEPLOYER_KEY=suiprivkey1… pnpm contract:publish testnet --dry-run
 *   DEPLOYER_KEY=suiprivkey1… pnpm contract:publish testnet [--upgrade-cap-to 0xMULTISIG]
 *   DEPLOYER_KEY=suiprivkey1… pnpm contract:publish mainnet --freeze            # immutable from the start
 *   DEPLOYER_KEY=suiprivkey1… pnpm contract:publish mainnet --upgrade-cap-to 0xMULTISIG
 *   DEPLOYER_KEY=suiprivkey1… pnpm contract:freeze testnet     # irreversible: make the package immutable
 *
 * The package has no version gating: after an upgrade, the old functions stay callable on existing
 * objects, so an upgrade cannot patch a vulnerability. The UpgradeCap is therefore either destroyed
 * (`--freeze`) or handed to a multisig (`--upgrade-cap-to`); on mainnet one of the two is required.
 *
 * Writes deployments/<network>.json with the package, registry shard and UpgradeCap IDs.
 * Needs the Sui CLI (>= 1.72) on PATH, or SUI_BIN.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { type Network, client, die, formatSui, keypair, parseNetwork } from './lib.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [command, networkArg, ...flags] = process.argv.slice(2);
const network = parseNetwork(networkArg);
const dryRun = flags.includes('--dry-run');
const freezeOnPublish = flags.includes('--freeze');
const capFlag = flags.indexOf('--upgrade-cap-to');
const upgradeCapTo = capFlag >= 0 ? flags[capFlag + 1] : undefined;
const deploymentFile = resolve(root, 'deployments', `${network}.json`);

interface Deployment {
  network: string;
  packageId: string;
  registryId: string;
  /** All registry shards, in shard order (`registryIds[0]` is `registryId`). */
  registryIds: string[];
  upgradeCapId: string | null;
  /** Who holds the UpgradeCap (null once immutable). */
  upgradeCapOwner: string | null;
  publisher: string;
  digest: string;
  publishedAt: string;
  immutable: boolean;
}

const RegistryCreatedBcs = bcs.struct('RegistryCreated', { registry_id: bcs.Address, shard: bcs.u64() });

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
  if (freezeOnPublish && upgradeCapTo) die('--freeze and --upgrade-cap-to are mutually exclusive');
  if (capFlag >= 0 && !/^0x[0-9a-fA-F]{1,64}$/.test(upgradeCapTo ?? '')) die('--upgrade-cap-to needs an address');
  if (network === 'mainnet' && !freezeOnPublish && !upgradeCapTo) {
    die('mainnet: pass --freeze (immutable) or --upgrade-cap-to <multisig address>; a single hot key must not hold the UpgradeCap');
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
  const capOwner = freezeOnPublish ? null : (upgradeCapTo ?? sender);
  if (freezeOnPublish) tx.moveCall({ target: '0x2::package::make_immutable', arguments: [upgradeCap!] });
  else tx.transferObjects([upgradeCap!], capOwner!);
  if (capOwner === sender) console.warn('warning: the UpgradeCap stays with the deployer key; move it to a multisig or freeze before real funds flow');

  const simulation = await sui.core.simulateTransaction({ transaction: tx, include: { effects: true } });
  if (simulation.$kind === 'FailedTransaction') die(`simulation failed: ${JSON.stringify(simulation.FailedTransaction.status)}`);
  const gas = simulation.Transaction.effects.gasUsed;
  const cost = BigInt(gas.computationCost) + BigInt(gas.storageCost) - BigInt(gas.storageRebate);
  console.log(`simulated ok, estimated cost ${formatSui(cost)}`);
  if (dryRun) return console.log('dry run: nothing published');

  const result = await sui.core.signAndExecuteTransaction({
    transaction: tx,
    signer,
    include: { effects: true, objectTypes: true, events: true },
  });
  if (result.$kind === 'FailedTransaction') die(`publish failed: ${result.FailedTransaction.digest}`);
  await sui.core.waitForTransaction({ result });
  const { effects, objectTypes, digest, events } = result.Transaction;
  const packageId = effects.changedObjects.find((o) => o.outputState === 'PackageWrite')?.objectId;
  // Registry shards, ordered by the `shard` in each RegistryCreated event.
  const registryIds = (events ?? [])
    .filter((e) => e.eventType.endsWith('::channel::RegistryCreated'))
    .map((e) => RegistryCreatedBcs.parse(e.bcs))
    .sort((a, b) => Number(BigInt(a.shard) - BigInt(b.shard)))
    .map((e) => normalizeSuiAddress(e.registry_id));
  const registryId = registryIds[0];
  const upgradeCapId = Object.entries(objectTypes).find(([, t]) => t === '0x0000000000000000000000000000000000000000000000000000000000000002::package::UpgradeCap')?.[0];
  if (!packageId || !registryId) die(`published (${digest}) but package/registry not found in effects`);

  const deployment: Deployment = {
    network: `sui:${network}`,
    packageId,
    registryId,
    registryIds,
    upgradeCapId: freezeOnPublish ? null : (upgradeCapId ?? null),
    upgradeCapOwner: capOwner,
    publisher: sender,
    digest,
    publishedAt: new Date().toISOString(),
    immutable: freezeOnPublish,
  };
  writeFileSync(deploymentFile, `${JSON.stringify(deployment, null, 2)}\n`);
  const suffix = network.toUpperCase();
  console.log(`\n✓ published in ${digest}\n  wrote ${deploymentFile}\n`);
  console.log(`Platform env:\n  BLOCKPAY_CHANNEL_PACKAGE_${suffix}=${packageId}\n  BLOCKPAY_CHANNEL_REGISTRY_${suffix}=${registryId}\n`);
  console.log(`SDK (packages/core/src/deployments.ts):\n  'sui:${network}': {\n    packageId: '${packageId}',\n    registryId: '${registryId}',\n    registryIds: [\n${registryIds.map((r) => `      '${r}',`).join('\n')}\n    ],\n  },`);
}

async function freeze() {
  if (!existsSync(deploymentFile)) die(`${deploymentFile} not found`);
  const deployment = JSON.parse(readFileSync(deploymentFile, 'utf8')) as Deployment;
  if (deployment.immutable || !deployment.upgradeCapId) die('package is already immutable');
  if (deployment.upgradeCapOwner && deployment.upgradeCapOwner !== keypair('DEPLOYER_KEY').toSuiAddress()) {
    die(`the UpgradeCap is held by ${deployment.upgradeCapOwner}; freeze it from that account (e.g. the multisig)`);
  }
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
  writeFileSync(deploymentFile, `${JSON.stringify({ ...deployment, upgradeCapId: null, upgradeCapOwner: null, immutable: true }, null, 2)}\n`);
  console.log(`✓ ${deployment.packageId} is now immutable (tx ${result.Transaction.digest})`);
}

if (command === 'publish') await publish();
else if (command === 'freeze') await freeze();
else die('usage: contract.ts <publish|freeze> <network> [--dry-run] [--force] [--freeze | --upgrade-cap-to <address>] [--yes]');
