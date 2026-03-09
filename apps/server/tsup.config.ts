import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: false,
  splitting: false,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  target: 'node24',
  external: ['@cebus/engine', 'better-sqlite3'],
});
