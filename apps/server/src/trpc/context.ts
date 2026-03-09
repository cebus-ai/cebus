import type { FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';
import { auth } from '../auth/setup';
import { getDatabase } from '../db/client';

export interface Context {
  db: Database.Database;
  user: { id: string; username: string; displayName: string } | null;
}

export async function createContext(opts: { req: FastifyRequest }): Promise<Context> {
  const db = getDatabase();
  const session = await auth.api.getSession({ headers: opts.req.headers as unknown as Headers });
  const user = session?.user
    ? { id: session.user.id, username: session.user.name, displayName: session.user.name }
    : null;
  return { db, user };
}
