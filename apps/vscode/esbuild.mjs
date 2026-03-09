import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const nodeBuiltins = [
  'node:fs', 'node:path', 'node:os', 'node:http', 'node:https',
  'node:child_process', 'node:net', 'node:url', 'node:util',
  'node:crypto', 'node:stream', 'node:events', 'node:buffer',
  'node:assert', 'node:process', 'node:worker_threads',
  'fs', 'path', 'os', 'http', 'https', 'child_process', 'net',
  'url', 'util', 'crypto', 'stream', 'events', 'buffer', 'assert',
  'process', 'worker_threads',
];

// Packages that must NOT be bundled:
// - vscode: VS Code API, provided by the extension host
// - @github/copilot-sdk: our ACP shim, built separately into dist/node_modules/
// - @github/copilot: CLI JS entry (minimal, no native binary). Shim spawns
//   `node index.js --acp --stdio` from dist/node_modules/@github/copilot/.
// - vscode-jsonrpc: runtime dep of our ACP shim, shipped in dist/node_modules/.
const externalPackages = [
  'vscode',
  '@github/copilot-sdk',
  '@github/copilot',
  'vscode-jsonrpc',
  'vscode-jsonrpc/*',
];

/** @type {esbuild.BuildOptions} */
const extensionOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: [
    ...externalPackages,
    ...nodeBuiltins,
  ],
  sourcemap: !production,
  minify: production,
  keepNames: true,
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
  logLevel: 'info',
};

/** @type {esbuild.BuildOptions} */
const mcpServerOptions = {
  entryPoints: ['src/mcp/mcp-server-entry.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/mcp-server.js',
  external: [...nodeBuiltins],
  sourcemap: !production,
  minify: production,
  keepNames: true,
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
  logLevel: 'info',
};

/** @type {esbuild.BuildOptions} */
const acpShimOptions = {
  entryPoints: ['src/copilot/acp-shim/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/node_modules/@github/copilot-sdk/index.js',
  external: [
    'vscode-jsonrpc',
    'vscode-jsonrpc/*',
    ...nodeBuiltins,
  ],
  sourcemap: !production,
  minify: production,
  keepNames: true,
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
  logLevel: 'info',
};

if (watch) {
  const [extCtx, mcpCtx, shimCtx] = await Promise.all([
    esbuild.context(extensionOptions),
    esbuild.context(mcpServerOptions),
    esbuild.context(acpShimOptions),
  ]);
  await Promise.all([extCtx.watch(), mcpCtx.watch(), shimCtx.watch()]);
  // eslint-disable-next-line no-console
  console.log('[esbuild] watching for changes...');
} else {
  await Promise.all([
    esbuild.build(extensionOptions),
    esbuild.build(mcpServerOptions),
    esbuild.build(acpShimOptions),
  ]);
}
