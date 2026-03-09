/**
 * Multi-strategy Copilot CLI binary discovery.
 *
 * Searches in priority order:
 * 1. Explicit path from cebus.copilot.cliPath setting
 * 2. `copilot` in PATH
 * 3. `gh copilot` (GitHub CLI extension)
 * 4. npm global installation
 */

import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export interface CliDiscoveryResult {
  cliPath: string;
  version: string;
  source: 'setting' | 'path' | 'gh-extension' | 'npm-global';
}

function execAsync(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

function fileExists(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function tryExplicitPath(): Promise<CliDiscoveryResult | null> {
  const config = vscode.workspace.getConfiguration('cebus.copilot');
  const cliPath = config.get<string>('cliPath', '');
  if (!cliPath) return null;

  try {
    if (!fileExists(cliPath)) return null;
    const { stdout } = await execAsync(cliPath, ['--version']);
    return { cliPath, version: stdout.trim(), source: 'setting' };
  } catch {
    return null;
  }
}

async function resolveAbsolutePath(command: string): Promise<string | null> {
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execAsync(whichCmd, [command]);
    // 'where' on Windows may return multiple lines; take the first .exe match
    const lines = stdout.trim().split(/\r?\n/);
    const exeLine = lines.find(l => l.endsWith('.exe')) ?? lines[0];
    return exeLine?.trim() ?? null;
  } catch {
    return null;
  }
}

async function tryPathLookup(): Promise<CliDiscoveryResult | null> {
  try {
    const { stdout } = await execAsync('copilot', ['--version']);
    const absolutePath = await resolveAbsolutePath('copilot');
    return {
      cliPath: absolutePath ?? 'copilot',
      version: stdout.trim(),
      source: 'path',
    };
  } catch {
    return null;
  }
}

async function tryGhExtension(): Promise<CliDiscoveryResult | null> {
  try {
    const { stdout } = await execAsync('gh', ['copilot', '--version']);
    return { cliPath: 'gh', version: stdout.trim(), source: 'gh-extension' };
  } catch {
    return null;
  }
}

async function tryNpmGlobal(): Promise<CliDiscoveryResult | null> {
  try {
    const { stdout } = await execAsync('npm', ['root', '-g']);
    const globalRoot = stdout.trim();
    const cliPath = path.join(globalRoot, '@github', 'copilot-cli', 'bin', 'copilot');
    if (!fileExists(cliPath)) return null;
    const { stdout: version } = await execAsync(cliPath, ['--version']);
    return { cliPath, version: version.trim(), source: 'npm-global' };
  } catch {
    return null;
  }
}

const strategies: Array<() => Promise<CliDiscoveryResult | null>> = [
  tryExplicitPath,
  tryPathLookup,
  tryGhExtension,
  tryNpmGlobal,
];

export async function discoverCopilotCli(): Promise<CliDiscoveryResult | null> {
  for (const strategy of strategies) {
    const result = await strategy();
    if (result) return result;
  }
  return null;
}
