import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import type { TeamConfig, SessionRecord, SessionStartResult, SessionStatus } from '../types.js';
import { OrchestrationError } from '../types.js';
import { debug } from '../../core/debug-logger.js';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly persistenceDir: string;
  private readonly persistenceEnabled: boolean;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(private readonly config: TeamConfig) {
    const persistence = config.sessionPersistence ?? {
      enabled: true,
      directory: '~/.cebus/sessions',
    };
    this.persistenceEnabled = persistence.enabled;
    this.persistenceDir = this.resolveDirectory(persistence.directory);

    // Periodic cleanup of idle sessions
    this.cleanupTimer = setInterval(() => {
      this.evictStaleSessions();
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  startSession(): SessionStartResult {
    const sessionId = randomUUID();
    const now = Date.now();

    const record: SessionRecord = {
      sessionId,
      teamId: this.config.teamId,
      createdAt: now,
      lastActiveAt: now,
      status: 'active',
      messageCount: 0,
      compactionSummaries: [],
    };

    this.sessions.set(sessionId, record);

    return this.toStartResult(sessionId);
  }

  async endSession(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new OrchestrationError('SESSION_NOT_FOUND', `Session not found: ${sessionId}`);
    }

    const updatedRecord: SessionRecord = {
      ...record,
      status: 'ended' as SessionStatus,
      lastActiveAt: Date.now(),
    };

    this.sessions.set(sessionId, updatedRecord);

    if (this.persistenceEnabled) {
      this.persistSession(sessionId, updatedRecord);
    }
  }

  resumeSession(sessionId: string): SessionStartResult {
    // Check in-memory first
    if (this.sessions.has(sessionId)) {
      const record = this.sessions.get(sessionId)!;
      const updated: SessionRecord = {
        ...record,
        status: 'active' as SessionStatus,
        lastActiveAt: Date.now(),
      };
      this.sessions.set(sessionId, updated);
      return this.toStartResult(sessionId);
    }

    // Try loading from disk
    if (this.persistenceEnabled) {
      const loaded = this.loadSession(sessionId);
      if (loaded) {
        const updated: SessionRecord = {
          ...loaded,
          status: 'active' as SessionStatus,
          lastActiveAt: Date.now(),
        };
        this.sessions.set(sessionId, updated);
        return this.toStartResult(sessionId);
      }
    }

    throw new OrchestrationError('SESSION_NOT_FOUND', `Session not found: ${sessionId}`);
  }

  getRecord(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  updateMessageCount(sessionId: string, count: number): void {
    const record = this.sessions.get(sessionId);
    if (record) {
      this.sessions.set(sessionId, {
        ...record,
        messageCount: count,
        lastActiveAt: Date.now(),
      });
    }
  }

  private toStartResult(sessionId: string): SessionStartResult {
    return {
      sessionId,
      teamId: this.config.teamId,
      agents: this.config.agents.map(a => ({
        id: a.id,
        name: a.name,
        role: a.role,
      })),
      conversationMode: this.config.conversationMode,
      orchestrationMode: this.config.orchestrationMode,
    };
  }

  private persistSession(sessionId: string, record: SessionRecord): void {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from resolved persistence directory
      mkdirSync(this.persistenceDir, { recursive: true });
      const filePath = resolve(this.persistenceDir, `${sessionId}.json`);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from resolved persistence directory
      writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
    } catch (err) {
      // Persistence failure is non-fatal — log and continue
      debug('session', 'persist-session-failed', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private loadSession(sessionId: string): SessionRecord | null {
    try {
      if (!UUID_RE.test(sessionId)) return null;
      const filePath = resolve(this.persistenceDir, `${sessionId}.json`);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from resolved persistence directory
      if (!existsSync(filePath)) return null;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from resolved persistence directory
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as SessionRecord;
    } catch {
      return null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
  }

  private evictStaleSessions(): void {
    const now = Date.now();
    for (const [id, record] of this.sessions) {
      if (record.status !== 'active' && now - record.lastActiveAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
        debug('session', 'evicted-stale-session', { sessionId: id });
      }
    }
  }

  private resolveDirectory(dir: string): string {
    if (dir.startsWith('~')) {
      return resolve(homedir(), dir.slice(2));
    }
    return resolve(dir);
  }
}
