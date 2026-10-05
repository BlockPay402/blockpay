import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string, entry = 'index') =>
  fileURLToPath(new URL(`./packages/${name}/src/${entry}.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Test against sources, not builds.
    alias: [
      { find: '@blockpay402/facilitator/mock', replacement: pkg('facilitator', 'mock') },
      { find: '@blockpay402/facilitator/sqlite', replacement: pkg('facilitator', 'sqlite') },
      ...['core', 'sui', 'server', 'express', 'next', 'client', 'agent', 'facilitator'].map((name) => ({
        find: `@blockpay402/${name}`,
        replacement: pkg(name),
      })),
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
