import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import type {
  TeamConfig,
  SessionRecord,
  SessionStartResult,
  SessionStatus,
} from '../types.js';
import { OrchestrationError } from '../types.js';
import { debug } from '../../core/debug-logger.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly persistenceDir: string;
  private readonly persistenceEnabled: boolean;

  constructor(private readonly config: TeamConfig) {
    const persistence = config.sessionPersistence ?? {
      enabled: true,
      directory: '~/.cebus/sessions',
    };
    this.persistenceEnabled = persistence.enabled;
    this.persistenceDir = this.resolveDirectory(persistence.directory);
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
      throw new OrchestrationError(
        'SESSION_NOT_FOUND',
        `Session not found: ${sessionId}`,
      );
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

    throw new OrchestrationError(
      'SESSION_NOT_FOUND',
      `Session not found: ${sessionId}`,
    );
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
      agents: this.config.agents.map((a) => ({
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
      if (!UUID_RE.test(sessionId)) return;
      if (!existsSync(this.persistenceDir)) {
        mkdirSync(this.persistenceDir, { recursive: true });
      }
      const filePath = resolve(this.persistenceDir, `${sessionId}.json`);
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
      if (!existsSync(filePath)) return null;
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as SessionRecord;
    } catch {
      return null;
    }
  }

  private resolveDirectory(dir: string): string {
    if (dir.startsWith('~')) {
      return resolve(homedir(), dir.slice(2));
    }
    return resolve(dir);
  }
}
