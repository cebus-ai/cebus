/**
 * Copies externalized npm packages into dist/node_modules so they ship
 * alongside the bundled extension.js in the .vsix.
 *
 * The ACP shim (our replacement for @github/copilot-sdk) is built by
 * esbuild directly into dist/node_modules/@github/copilot-sdk/. This
 * script just needs to:
 *   1. Write a package.json for the shim so Node can resolve it
 *   2. Copy vscode-jsonrpc (runtime dep of the shim)
 *   3. Copy minimal @github/copilot files (CLI JS entry the shim spawns)
 */

import { writeFileSync, cpSync, copyFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vscodeRoot = resolve(__dirname, '..');
const monoRoot = resolve(vscodeRoot, '..', '..');

const distNodeModules = resolve(vscodeRoot, 'dist', 'node_modules');

// 1. Write package.json for the ACP shim (esbuild outputs index.js here)
//    Clean out any leftover files from the old @github/copilot-sdk first.
const shimDir = resolve(distNodeModules, '@github', 'copilot-sdk');
const shimDistDir = resolve(shimDir, 'dist');
if (existsSync(shimDistDir)) {
  rmSync(shimDistDir, { recursive: true, force: true });
}
mkdirSync(shimDir, { recursive: true });
writeFileSync(
  resolve(shimDir, 'package.json'),
  JSON.stringify(
    {
      name: '@github/copilot-sdk',
      version: '0.0.0-acp-shim',
      main: './index.js',
      exports: {
        '.': './index.js',
      },
    },
    null,
    2
  )
);
// eslint-disable-next-line no-console
console.log(`[copy-externals] @github/copilot-sdk package.json written`);

// 2. Copy runtime dependencies of the shim
const externals = ['vscode-jsonrpc'];

for (const pkg of externals) {
  const candidates = [
    resolve(monoRoot, 'node_modules', pkg),
    resolve(vscodeRoot, 'node_modules', pkg),
  ];

  const src = candidates.find(c => existsSync(c));
  if (!src) {
    // eslint-disable-next-line no-console
    console.warn(`[copy-externals] ${pkg} not found, skipping`);
    continue;
  }

  const dest = resolve(distNodeModules, pkg);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
  // eslint-disable-next-line no-console
  console.log(`[copy-externals] ${pkg} → ${dest}`);
}

// 3. Copy minimal @github/copilot — only the files the shim needs to spawn
// the ACP CLI server. We skip native binaries, ripgrep, sharp, prebuilds,
// tree-sitter wasm, clipboard, etc. (~90MB savings).
const copilotSrc = [
  resolve(monoRoot, 'node_modules', '@github', 'copilot'),
  resolve(vscodeRoot, 'node_modules', '@github', 'copilot'),
].find(c => existsSync(c));

if (copilotSrc) {
  const copilotDest = resolve(distNodeModules, '@github', 'copilot');
  const sdkDest = resolve(copilotDest, 'sdk');
  mkdirSync(sdkDest, { recursive: true });

  // Essential files only
  const filesToCopy = ['package.json', 'index.js', 'npm-loader.js', 'sdk/index.js'];

  for (const file of filesToCopy) {
    const src = resolve(copilotSrc, file);
    const dest = resolve(copilotDest, file);
    if (existsSync(src)) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[copy-externals] @github/copilot (minimal) → ${copilotDest}`);
} else {
  // eslint-disable-next-line no-console
  console.warn('[copy-externals] @github/copilot not found, skipping');
}
