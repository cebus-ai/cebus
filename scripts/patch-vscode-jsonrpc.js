/**
 * Patch vscode-jsonrpc to add ESM-compatible exports.
 *
 * vscode-jsonrpc@8.x ships without an `exports` field, which breaks
 * ESM subpath imports like `import "vscode-jsonrpc/node"` used by
 * @github/copilot-sdk. This postinstall script adds the missing exports.
 *
 * Remove this patch when vscode-jsonrpc ships with proper exports.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const pkgPath = resolve('node_modules/vscode-jsonrpc/package.json');

try {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  if (pkg.exports) {
    // Already patched or upstream fixed — skip
    process.exit(0);
  }

  pkg.exports = {
    '.': { import: './lib/node/main.js', require: './lib/node/main.js', types: './lib/common/api.d.ts' },
    './node': { import: './node.js', require: './node.js', types: './node.d.ts' },
    './node.js': { import: './node.js', require: './node.js', types: './node.d.ts' },
    './browser': { import: './browser.js', require: './browser.js', types: './browser.d.ts' },
    './browser.js': { import: './browser.js', require: './browser.js', types: './browser.d.ts' },
    './*': './*',
    './lib/*': './lib/*',
  };

  writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t') + '\n');
  console.log('Patched vscode-jsonrpc: added ESM exports');
} catch {
  // vscode-jsonrpc not installed — nothing to patch
}
