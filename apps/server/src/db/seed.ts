import type Database from 'better-sqlite3';
import { ulid } from 'ulid';

export function seedDefaultWorkspace(db: Database.Database): string {
  const existing = db.prepare('SELECT id FROM workspace LIMIT 1').get() as { id: string } | undefined;
  if (existing) return existing.id;

  const workspaceId = ulid();
  db.prepare('INSERT INTO workspace (id, name, owner_id) VALUES (?, ?, ?)').run(
    workspaceId,
    'Agentic OS',
    'system',
  );
  return workspaceId;
}
