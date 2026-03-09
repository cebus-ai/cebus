/**
 * Install the packaged .vsix into VS Code using an absolute path.
 *
 * Handles two common gotchas on Windows:
 * 1. Relative .vsix paths silently fail when npm workspace scripts change cwd.
 * 2. If VS Code has a pending uninstall for the same extension (in-memory state),
 *    `code --install-extension` writes files to disk but the running instance
 *    ignores them. We clear the extensions.json "uninstall" flag so the next
 *    window reload picks it up.
 */

import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vsix = join(__dirname, '..', 'cebus-vscode-0.1.0.vsix');

if (!existsSync(vsix)) {
  console.error(`[install-vsix] .vsix not found: ${vsix}`);
  process.exit(1);
}

// Clear any pending uninstall flag for our extension so VS Code picks it up on reload
const extensionId = 'cebus-ai.cebus-vscode-0.1.0';
const obsoletePath = join(homedir(), '.vscode', 'extensions', '.obsolete');
if (existsSync(obsoletePath)) {
  try {
    const obsolete = JSON.parse(readFileSync(obsoletePath, 'utf-8'));
    if (obsolete[extensionId]) {
      delete obsolete[extensionId];
      writeFileSync(obsoletePath, JSON.stringify(obsolete));
      console.log(`[install-vsix] Cleared pending uninstall flag for ${extensionId}`);
    }
  } catch {
    // .obsolete file is malformed — ignore
  }
}

console.log(`[install-vsix] Installing ${vsix}`);
execSync(`code --install-extension "${vsix}" --force`, { stdio: 'inherit' });
console.log('[install-vsix] Installed. Reload VS Code to activate.');
