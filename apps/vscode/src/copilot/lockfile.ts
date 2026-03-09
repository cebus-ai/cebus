/**
 * Cross-window lockfile for the shared Copilot CLI server.
 *
 * Path: ~/.cebus/copilot-server.lock
 *
 * Allows multiple VS Code windows to discover and share a single
 * Copilot CLI server process.
 */

/* eslint-disable security/detect-non-literal-fs-filename -- paths derived from os.homedir(), not user input */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface LockfileData {
  cliUrl: string;
  port: number;
  pid: number;
  startedAt: string;
}

const CEBUS_DIR = path.join(os.homedir(), '.cebus');
const LOCKFILE_PATH = path.join(CEBUS_DIR, 'copilot-server.lock');

function ensureCebusDir(): void {
  mkdirSync(CEBUS_DIR, { recursive: true });
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readLockfile(): LockfileData | null {
  if (!existsSync(LOCKFILE_PATH)) return null;

  try {
    const raw = readFileSync(LOCKFILE_PATH, 'utf-8');
    const data = JSON.parse(raw) as LockfileData;

    if (data.pid === 0 || data.port === 0 || data.cliUrl.length === 0) return null;

    if (!isPidAlive(data.pid)) {
      unlinkSync(LOCKFILE_PATH);
      return null;
    }

    return data;
  } catch {
    try {
      unlinkSync(LOCKFILE_PATH);
    } catch {
      // ignore cleanup errors
    }
    return null;
  }
}

export function acquireLockfile(data: LockfileData): void {
  ensureCebusDir();
  writeFileSync(LOCKFILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export function releaseLockfile(): void {
  try {
    if (existsSync(LOCKFILE_PATH)) {
      unlinkSync(LOCKFILE_PATH);
    }
  } catch {
    // ignore cleanup errors
  }
}
