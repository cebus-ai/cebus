/**
 * Session persistence — saves/loads conversations to .cebus/sessions/{id}.json.
 *
 * Uses JSON files (no SQLite) to avoid native binary issues in VSIX packaging.
 * Atomic writes via temp file + rename to prevent corruption.
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { ChatMode } from '@cebus/engine';

export interface PersistedMessage {
  id: string;
  agentId: string;
  displayName: string;
  content: string;
  senderType: 'user' | 'agent';
  timestamp: number;
  providerId?: string | undefined;
  modelId?: string | undefined;
}

export interface PersistedConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  chatMode: ChatMode;
  contextLevel: string;
  models: Array<{ providerId: string; modelId: string; displayName: string }>;
  messages: PersistedMessage[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  chatMode: ChatMode;
  modelCount: number;
  messageCount: number;
}

export class SessionManager implements vscode.Disposable {
  private sessionsDir: string;

  constructor(storageRoot: string) {
    this.sessionsDir = path.join(storageRoot, '.cebus', 'sessions');
    fs.mkdirSync(this.sessionsDir, { recursive: true });
  }

  generateId(): string {
    return `conv-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  async save(conversation: PersistedConversation): Promise<void> {
    const filePath = path.join(this.sessionsDir, `${conversation.id}.json`);
    const tmpPath = `${filePath}.tmp`;
    const data = JSON.stringify(conversation, null, 2);
    await fs.promises.writeFile(tmpPath, data, 'utf-8');
    await fs.promises.rename(tmpPath, filePath);
  }

  async load(conversationId: string): Promise<PersistedConversation | null> {
    const filePath = path.join(this.sessionsDir, `${conversationId}.json`);
    try {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(data) as PersistedConversation;
    } catch {
      return null;
    }
  }

  async list(): Promise<ConversationSummary[]> {
    let files: string[];
    try {
      files = await fs.promises.readdir(this.sessionsDir);
    } catch {
      return [];
    }

    const summaries: ConversationSummary[] = [];
    for (const file of files) {
      if (!file.endsWith('.json') || file.endsWith('.tmp')) continue;
      try {
        const filePath = path.join(this.sessionsDir, file);
        const data = await fs.promises.readFile(filePath, 'utf-8');
        const conv = JSON.parse(data) as PersistedConversation;
        summaries.push({
          id: conv.id,
          title: conv.title,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
          chatMode: conv.chatMode,
          modelCount: conv.models.length,
          messageCount: conv.messages.length,
        });
      } catch {
        // Corrupted file — skip
      }
    }

    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async delete(conversationId: string): Promise<void> {
    const filePath = path.join(this.sessionsDir, `${conversationId}.json`);
    try {
      await fs.promises.unlink(filePath);
    } catch {
      // Already deleted or never existed
    }
  }

  /** Derive a title from the first user message. */
  static titleFromMessage(content: string): string {
    const clean = content.replace(/@[\w.+-]+/g, '').trim();
    if (clean.length <= 60) return clean || 'New Conversation';
    return `${clean.slice(0, 57)}...`;
  }

  dispose(): void {
    // No persistent resources to clean up
  }
}
