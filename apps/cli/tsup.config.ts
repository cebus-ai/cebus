import { defineConfig } from 'tsup';
import { optionalProviderSDKs } from '../../tsup.shared.js';

export default defineConfig({
  entry: { 'cli/index': 'src/index.ts' },
  format: ['esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  target: 'node24',
  external: [...optionalProviderSDKs, '@cebus/engine'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
