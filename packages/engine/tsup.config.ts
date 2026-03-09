import { defineConfig } from 'tsup';
import { optionalProviderSDKs } from '../../tsup.shared.js';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    target: 'node24',
    external: optionalProviderSDKs,
  },
  {
    entry: { 'orchestration/index': 'src/orchestration/index.ts' },
    format: ['esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: false,
    outDir: 'dist',
    target: 'node24',
    external: optionalProviderSDKs,
  },
]);
