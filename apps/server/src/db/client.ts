import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { mkdirSync } from 'fs';

let database: Database.Database | undefined;

export function getDatabase(): Database.Database {
  if (!database) {
    const dbPath = process.env['DATABASE_URL'] ?? resolve(process.cwd(), 'data', 'cebus.db');
    const resolvedPath = resolve(dbPath);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path derived from config
    mkdirSync(dirname(resolvedPath), { recursive: true });
    database = new Database(resolvedPath);
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
  }
  return database;
}

export function closeDatabase(): void {
  if (database) {
    database.close();
    database = undefined;
  }
}
