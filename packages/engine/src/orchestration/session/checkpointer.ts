/**
 * SQLite Checkpointer Factory
 *
 * Singleton checkpointer backed by .cebus/checkpoints.sqlite.
 * All sessions share a single SQLite file, keyed by thread_id.
 * Also exposes the raw database for Cebus session metadata storage.
 */

import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { findProjectRoot } from '../../core/project-root.js';

let checkpointerInstance: SqliteSaver | undefined;
let dbInstance: Database.Database | undefined;
let exitHandlerRegistered = false;
let dbDirReady = false;

function getDbPath(): string {
  const dir = join(findProjectRoot(), '.cebus');
  if (!dbDirReady) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- dir from project root
    mkdirSync(dir, { recursive: true });
    dbDirReady = true;
  }
  return join(dir, 'checkpoints.sqlite');
}

export function getCheckpointer(): SqliteSaver {
  if (!checkpointerInstance) {
    // Suppress noisy stdout/stderr from better-sqlite3 native module init
    // eslint-disable-next-line no-console -- capturing console.log to suppress noisy native module init
    const origLog = console.log;
    const origWarn = console.warn;
    // eslint-disable-next-line no-console -- suppressing noisy native module init
    console.log = (): void => {};
    console.warn = (): void => {};
    try {
      checkpointerInstance = SqliteSaver.fromConnString(getDbPath());
    } finally {
      // eslint-disable-next-line no-console -- restoring original console.log
      console.log = origLog;
      console.warn = origWarn;
    }
  }
  return checkpointerInstance;
}

/**
 * Get the raw better-sqlite3 database for Cebus metadata tables.
 * Uses the same .cebus/checkpoints.sqlite file as the LangGraph checkpointer.
 */
export function getDatabase(): Database.Database {
  if (!dbInstance) {
    // eslint-disable-next-line no-console -- capturing console.log to suppress noisy native module init
    const origLog = console.log;
    const origWarn = console.warn;
    // eslint-disable-next-line no-console -- suppressing noisy native module init
    console.log = (): void => {};
    console.warn = (): void => {};
    try {
      dbInstance = new Database(getDbPath());
      dbInstance.pragma('journal_mode = WAL');
      initMetadataTables(dbInstance);
    } finally {
      // eslint-disable-next-line no-console -- restoring original console.log
      console.log = origLog;
      console.warn = origWarn;
    }

    if (!exitHandlerRegistered) {
      exitHandlerRegistered = true;
      process.on('exit', closeDatabase);
    }
  }
  return dbInstance;
}

/**
 * Delete all checkpointer data for a specific thread (session).
 * This removes LangGraph's stored conversation state so the next
 * invocation starts with a blank slate.
 */
export async function clearThread(threadId: string): Promise<void> {
  const checkpointer = getCheckpointer();
  await checkpointer.deleteThread(threadId);
}

/**
 * Gracefully close the database connection.
 * Safe to call even if no database has been opened.
 */
export function closeDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // Best-effort: database may already be closed
    }
    dbInstance = undefined;
  }
  checkpointerInstance = undefined;
}

/**
 * Create Cebus metadata tables if they don't exist.
 */
function initMetadataTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cebus_sessions (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS cebus_participants (
      session_id TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (session_id, id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS cebus_messages (
      session_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (session_id, idx)
    )
  `);
}
