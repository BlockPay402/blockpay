/**
 * Set one version on every publishable package (they are released in lockstep).
 *   pnpm release:version 0.2.0
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error('usage: set-version.ts <semver>');
  process.exit(1);
}
const packages = resolve(import.meta.dirname, '../packages');
for (const dir of readdirSync(packages)) {
  const file = resolve(packages, dir, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  pkg.version = version;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`${pkg.name} → ${version}`);
}
