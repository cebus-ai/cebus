/**
 * Engine bridge — wraps @cebus/engine for VS Code extension host.
 *
 * Mirrors the pattern from apps/server/src/services/orchestration.ts
 * but without Fastify/tRPC/auth/SQLite. The engine runs directly in
 * the extension host process.
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildTeamConfig,
  compile,
  registerBuiltInProviders,
  getProviderRegistry,
  findProjectRoot,
} from '@cebus/engine';
import type {
  OrchestrationGraph,
  OrchestrationStreamEvent,
  BuildTeamConfigParams,
  ParticipantInput,
  ConversationHistoryEntry,
  ChatMode,
  ContextLevel,
} from '@cebus/engine';
import { VscodeLmAdapter } from './vscode-lm-adapter.js';
import type { CopilotCliManager } from '../copilot/cli-manager.js';
import type { SecretStore } from './secret-store.js';
import type { ModelSelection } from './model-picker.js';

export interface ProviderModels {
  providerId: string;
  providerName: string;
  models: Array<{ modelId: string; displayName: string }>;
}

interface CreateSessionParams {
  models: ModelSelection[];
  chatMode: ChatMode;
  contextLevel?: ContextLevel | undefined;
  orchestratorConfig?: BuildTeamConfigParams['orchestratorConfig'] | undefined;
  additionalInstructions?: string | undefined;
}

interface SessionState {
  graph: OrchestrationGraph;
  agentToParticipant: Map<string, string>;
  participantToAgent: Map<string, string>;
  participants: ParticipantInput[];
  conversationHistory: ConversationHistoryEntry[];
  chatMode: ChatMode;
}

type ModelBackend = 'hybrid' | 'vscode_lm' | 'copilot_cli_sdk';

export class EngineBridge implements vscode.Disposable {
  private copilotManager: CopilotCliManager;
  private secretStore: SecretStore;
  private sessions = new Map<string, SessionState>();
  private initialized = false;

  constructor(copilotManager: CopilotCliManager, secretStore: SecretStore) {
    this.copilotManager = copilotManager;
    this.secretStore = secretStore;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load .env from workspace root (don't override existing env vars)
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      const envPath = path.join(workspaceRoot, '.env');
      try {
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx <= 0) continue;
          const key = trimmed.slice(0, eqIdx).trim();
          // Don't override existing env vars (secret store takes precedence)
          if (!(key in process.env)) {
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            process.env[key] = val;
          }
        }
      } catch {
        // .env file doesn't exist or isn't readable — that's fine
      }
    }

    // Sync API keys from secret store to env vars (overrides .env values)
    await this.secretStore.syncToEnv();

    // Start Copilot CLI server in the background — don't block model discovery.
    this.copilotManager.start().catch(() => {
      // Errors are shown by CopilotCliManager itself
    });

    const backend = this.getModelBackend();

    // Register VS Code Language Model provider (Copilot models via vscode.lm API)
    const registry = getProviderRegistry();
    if (backend !== 'copilot_cli_sdk' && !registry.get('vscode-lm')) {
      const vscodeLmAdapter = new VscodeLmAdapter();
      if (await vscodeLmAdapter.isAvailable()) {
        await vscodeLmAdapter.initialize();
        registry.register(vscodeLmAdapter);
      }
    }

    // Register all built-in providers (reads env vars for API keys)
    if (backend !== 'vscode_lm') {
      registerBuiltInProviders();
    }

    this.initialized = true;
  }

  async getAvailableModels(): Promise<ProviderModels[]> {
    if (!this.initialized) await this.initialize();

    const backend = this.getModelBackend();
    const registry = getProviderRegistry();
    const result: ProviderModels[] = [];

    const timeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
      ]);

    const providers = registry.getAll();
    const settled = await Promise.allSettled(
      providers.map(async provider => {
        if (!(await timeout(provider.isAvailable(), 5_000))) return null;
        const models = await timeout(provider.listModels(), 5_000);
        return {
          providerId: provider.id,
          providerName: provider.displayName,
          models: models.map(m => ({
            modelId: m.id,
            displayName: m.displayName ?? m.id,
          })),
        };
      })
    );

    for (const entry of settled) {
      if (entry.status === 'fulfilled' && entry.value) {
        result.push(entry.value);
      }
    }

    return result.filter(p => this.isProviderAllowed(p.providerId, backend));
  }

  async createSession(params: CreateSessionParams): Promise<string> {
    if (!this.initialized) await this.initialize();

    const backend = this.getModelBackend();
    const disallowedModels = params.models.filter(m => !this.isProviderAllowed(m.providerId, backend));
    if (disallowedModels.length > 0) {
      throw new Error(
        `Selected models are not available for backend "${backend}". Use "Cebus: Select Models" to choose valid models.`
      );
    }

    const sessionId = `vscode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const participants: ParticipantInput[] = [
      { id: 'user', type: 'user', displayName: 'User', nickname: 'User' },
      ...params.models.map(
        (m, i): ParticipantInput => ({
          id: `agent-${i}`,
          type: 'model',
          displayName: m.displayName,
          nickname: m.displayName,
          providerId: m.providerId,
          modelId: m.modelId,
        })
      ),
    ];

    const contextLevel = params.contextLevel ?? 'minimal';
    const workingDir =
      contextLevel !== 'none'
        ? (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? findProjectRoot())
        : undefined;

    const { teamConfig, agentToParticipant } = buildTeamConfig({
      sessionId,
      chatMode: params.chatMode,
      participants,
      contextLevel,
      orchestratorConfig: params.orchestratorConfig,
      additionalInstructions: params.additionalInstructions,
      workingDir,
    });

    const graph = await compile(teamConfig, {
      agentToParticipant,
    });

    // Build reverse map: participantId → agentId
    const participantToAgent = new Map<string, string>();
    for (const [agentId, participantId] of agentToParticipant) {
      participantToAgent.set(participantId, agentId);
    }

    this.sessions.set(sessionId, {
      graph,
      agentToParticipant,
      participantToAgent,
      participants,
      conversationHistory: [],
      chatMode: params.chatMode,
    });

    return sessionId;
  }

  async *sendMessage(sessionId: string, content: string): AsyncIterable<OrchestrationStreamEvent> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Parse @mentions to determine directed agents (same pattern as server)
    let directedTo: string[] | undefined;
    // eslint-disable-next-line security/detect-unsafe-regex -- bounded repetition, same pattern as server
    const mentionPattern = /@([\w.+-]+(?:\s[\w.+-]+)*)/g;
    const rawMentions: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = mentionPattern.exec(content)) !== null) {
      rawMentions.push(match[1]!.toLowerCase());
    }

    if (rawMentions.length > 0) {
      const modelParticipants = session.participants.filter(p => p.type === 'model');
      const mentionedParticipantIds = modelParticipants
        .filter(p => {
          const name = p.displayName.toLowerCase();
          return rawMentions.some(m => name.includes(m) || m.includes(name));
        })
        .map(p => p.id);

      // Translate participant IDs to agent IDs for the graph
      const mentionedAgentIds = mentionedParticipantIds
        .map(pid => session.participantToAgent.get(pid))
        .filter((id): id is string => id != null);

      if (mentionedAgentIds.length > 0) {
        directedTo = mentionedAgentIds;
      }
    }

    // Stream through the engine graph
    for await (const event of session.graph.stream({
      message: content,
      sessionId,
      directedTo,
      conversationHistory: session.conversationHistory,
    })) {
      // Translate LangGraph agentId → participantId for the webview
      if ('agentId' in event && event.agentId) {
        const participantId = session.agentToParticipant.get(event.agentId);
        if (participantId) {
          const translated = { ...event, agentId: participantId };
          yield translated as OrchestrationStreamEvent;

          if (event.type === 'complete' && event.content) {
            session.conversationHistory.push({
              role: 'assistant',
              content: event.content,
              name: event.agentId,
            });
          }
          continue;
        }
      }

      yield event;

      // Track conversation history for next turn
      if (event.type === 'complete' && event.content) {
        session.conversationHistory.push({
          role: 'assistant',
          content: event.content,
          name: event.agentId,
        });
      }
    }

    // Add user message to history after streaming
    session.conversationHistory.push({
      role: 'user',
      content,
    });
  }

  cancelAll(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.graph.cancelAll();
    }
  }

  async respondToApproval(sessionId: string, approvalId: string, approved: boolean, budget?: number | undefined): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.graph.respondToApproval(approvalId, approved, budget);
    }
  }

  async respondToApprovalGlobal(approvalId: string, approved: boolean, budget?: number | undefined): Promise<void> {
    for (const session of this.sessions.values()) {
      try {
        await session.graph.respondToApproval(approvalId, approved, budget);
        return;
      } catch {
        // Not in this session, try next
      }
    }
  }

  getSessionParticipants(
    sessionId: string
  ): Array<{ id: string; displayName: string; providerId?: string | undefined; modelId?: string | undefined }> {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.participants
      .filter(p => p.type === 'model')
      .map(p => ({
        id: p.id,
        displayName: p.displayName,
        providerId: p.providerId,
        modelId: p.modelId,
      }));
  }

  restoreHistory(sessionId: string, history: ConversationHistoryEntry[]): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.conversationHistory = [...history];
    }
  }

  getSessionParticipantMap(sessionId: string): Map<string, { providerId?: string | undefined; modelId?: string | undefined }> {
    const session = this.sessions.get(sessionId);
    const result = new Map<string, { providerId?: string | undefined; modelId?: string | undefined }>();
    if (!session) return result;
    for (const p of session.participants) {
      if (p.type === 'model') {
        result.set(p.id, {
          ...(p.providerId != null ? { providerId: p.providerId } : {}),
          ...(p.modelId != null ? { modelId: p.modelId } : {}),
        });
      }
    }
    return result;
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  dispose(): void {
    this.sessions.clear();
  }

  private getModelBackend(): ModelBackend {
    const configured = vscode.workspace.getConfiguration('cebus').get<string>('modelBackend', 'hybrid');
    if (configured === 'vscode_lm' || configured === 'copilot_cli_sdk') {
      return configured;
    }
    return 'hybrid';
  }

  private isProviderAllowed(providerId: string, backend: ModelBackend): boolean {
    if (backend === 'vscode_lm') return providerId === 'vscode-lm';
    if (backend === 'copilot_cli_sdk') return providerId === 'copilot';
    return true;
  }
}
