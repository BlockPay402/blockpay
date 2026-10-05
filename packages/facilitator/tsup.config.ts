import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/mock.ts', 'src/sqlite.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  // Keep `node:sqlite`: without the prefix Node looks for an npm package called "sqlite".
  removeNodeProtocol: false,
});
