import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  ProviderAdapter,
  ContextMessage,
  CompletionOptions,
  CompletionResult,
  ModelInfo,
  ProviderError,
} from './types';
import { ProviderErrorImpl } from './types';
import { debug, logProvider, logProviderRequest } from '../core/debug-logger';
import { mapErrorByMessage } from './shared/error-mapper';
import { resolveCopilotClientConnectionOptions } from './shared/copilot-client-options';
import { COPILOT_PROGRESS_EVENTS } from './shared/copilot-events';
import { approveAll } from '@github/copilot-sdk';

const execFileAsync = promisify(execFile);

async function checkPwshAvailable(): Promise<string | null> {
  if (process.platform !== 'win32') return null;

  try {
    await execFileAsync('pwsh.exe', ['--version'], { timeout: 5000 });
    return null;
  } catch {
    return (
      'GitHub Copilot SDK requires PowerShell 6+ (pwsh) on Windows, but it was not found.\n' +
      'Install it with: winget install Microsoft.PowerShell\n' +
      'Then restart your terminal.'
    );
  }
}

export interface CopilotStatus {
  installed: boolean;
  authenticated: boolean;
  byokAvailable?: boolean | undefined;
  error?: string;
}

export async function checkCopilotStatus(): Promise<CopilotStatus> {
  const status: CopilotStatus = {
    installed: false,
    authenticated: false,
  };

  const pwshError = await checkPwshAvailable();
  if (pwshError !== null) {
    status.error = pwshError;
    return status;
  }

  try {
    await import('@github/copilot-sdk');
    status.installed = true;
  } catch {
    status.error = 'GitHub Copilot SDK not installed. Run: npm install @github/copilot-sdk';
    return status;
  }

  try {
    const { CopilotClient } = await import('@github/copilot-sdk');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new CopilotClient({ clientName: 'cebus' } as any);
    await client.start();
    status.authenticated = true;
    await client.stop();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('not found') || errorMsg.includes('ENOENT')) {
      status.error = 'GitHub Copilot CLI not found. Install it and run: github-copilot-cli auth';
    } else if (
      errorMsg.includes('auth') ||
      errorMsg.includes('401') ||
      errorMsg.includes('Authentication')
    ) {
      status.installed = true;
      status.byokAvailable = true;
      status.error = 'GitHub Copilot not authenticated. Run: github-copilot-cli auth';
    } else {
      status.error = `Copilot initialization failed: ${errorMsg}`;
    }
  }

  return status;
}

/** Friendly nickname map for known Copilot SDK model IDs. */
const COPILOT_NICKNAME_MAP: Record<string, { displayName: string; defaultNickname: string }> = {
  'gpt-5.4': { displayName: 'GPT-5.4 (Copilot)', defaultNickname: 'CopilotGPT54' },
  'claude-opus-4.6': { displayName: 'Claude Opus 4.6 (Copilot)', defaultNickname: 'CopilotOpus46' },
  'claude-opus-4.6-fast': {
    displayName: 'Claude Opus 4.6 Fast (Copilot)',
    defaultNickname: 'CopilotOpus46F',
  },
  'claude-opus-4.5': { displayName: 'Claude Opus 4.5 (Copilot)', defaultNickname: 'CopilotOpus45' },
  'claude-sonnet-4.6': {
    displayName: 'Claude Sonnet 4.6 (Copilot)',
    defaultNickname: 'CopilotSonnet46',
  },
  'claude-sonnet-4.5': {
    displayName: 'Claude Sonnet 4.5 (Copilot)',
    defaultNickname: 'CopilotSonnet45',
  },
  'claude-sonnet-4': {
    displayName: 'Claude Sonnet 4 (Copilot)',
    defaultNickname: 'CopilotSonnet4',
  },
  'claude-haiku-4.5': {
    displayName: 'Claude Haiku 4.5 (Copilot)',
    defaultNickname: 'CopilotHaiku',
  },
  'gpt-5.3-codex': { displayName: 'GPT-5.3 Codex (Copilot)', defaultNickname: 'Copilot53Codex' },
  'gpt-5.2-codex': { displayName: 'GPT-5.2 Codex (Copilot)', defaultNickname: 'Copilot52Codex' },
  'gpt-5.2': { displayName: 'GPT-5.2 (Copilot)', defaultNickname: 'CopilotGPT52' },
  'gpt-5.1-codex': { displayName: 'GPT-5.1 Codex (Copilot)', defaultNickname: 'Copilot51Codex' },
  'gpt-5.1-codex-max': {
    displayName: 'GPT-5.1 Codex Max (Copilot)',
    defaultNickname: 'Copilot51Max',
  },
  'gpt-5.1-codex-mini': {
    displayName: 'GPT-5.1 Codex Mini (Copilot)',
    defaultNickname: 'Copilot51Mini',
  },
  'gpt-5.1': { displayName: 'GPT-5.1 (Copilot)', defaultNickname: 'CopilotGPT51' },
  'gpt-5': { displayName: 'GPT-5 (Copilot)', defaultNickname: 'CopilotGPT5' },
  'gpt-5-mini': { displayName: 'GPT-5 Mini (Copilot)', defaultNickname: 'CopilotGPT5Mini' },
  'gpt-4.1': { displayName: 'GPT-4.1 (Copilot)', defaultNickname: 'CopilotGPT41' },
  'gemini-3-pro-preview': {
    displayName: 'Gemini 3 Pro Preview (Copilot)',
    defaultNickname: 'CopilotGeminiPro',
  },
  'gemini-3-flash': { displayName: 'Gemini 3 Flash (Copilot)', defaultNickname: 'CopilotGemini' },
};

const COPILOT_FALLBACK_MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-4.6',
    displayName: 'Claude Opus 4.6 (Copilot)',
    defaultNickname: 'CopilotOpus46',
    capabilities: {
      streaming: true,
      maxContextTokens: 200000,
      maxOutputTokens: 64000,
      functionCalling: true,
    },
  },
  {
    id: 'claude-sonnet-4.5',
    displayName: 'Claude Sonnet 4.5 (Copilot)',
    defaultNickname: 'CopilotSonnet45',
    capabilities: {
      streaming: true,
      maxContextTokens: 200000,
      maxOutputTokens: 64000,
      functionCalling: true,
    },
  },
  {
    id: 'gpt-5.4',
    displayName: 'GPT-5.4 (Copilot)',
    defaultNickname: 'CopilotGPT54',
    capabilities: {
      streaming: true,
      maxContextTokens: 256000,
      maxOutputTokens: 16384,
      functionCalling: true,
    },
  },
  {
    id: 'gpt-5.3-codex',
    displayName: 'GPT-5.3 Codex (Copilot)',
    defaultNickname: 'Copilot53Codex',
    capabilities: {
      streaming: true,
      maxContextTokens: 256000,
      maxOutputTokens: 16384,
      functionCalling: true,
    },
  },
  {
    id: 'gpt-5.2',
    displayName: 'GPT-5.2 (Copilot)',
    defaultNickname: 'CopilotGPT52',
    capabilities: {
      streaming: true,
      maxContextTokens: 256000,
      maxOutputTokens: 16384,
      functionCalling: true,
    },
  },
  {
    id: 'gpt-5.1',
    displayName: 'GPT-5.1 (Copilot)',
    defaultNickname: 'CopilotGPT51',
    capabilities: {
      streaming: true,
      maxContextTokens: 256000,
      maxOutputTokens: 16384,
      functionCalling: true,
    },
  },
  {
    id: 'gemini-3-flash',
    displayName: 'Gemini 3 Flash (Copilot)',
    defaultNickname: 'CopilotGemini',
    capabilities: {
      streaming: true,
      maxContextTokens: 1000000,
      maxOutputTokens: 8192,
      functionCalling: true,
    },
  },
];

interface SdkModelInfo {
  id: string;
  name: string;
  capabilities: {
    supports: { vision: boolean; reasoningEffort: boolean };
    limits: {
      max_prompt_tokens?: number;
      max_context_window_tokens: number;
      max_output_tokens?: number;
    };
  };
  billing?: { multiplier?: number };
  policy?: { state: string };
}

function mapSdkModel(sdkModel: SdkModelInfo): ModelInfo {
  const known = COPILOT_NICKNAME_MAP[sdkModel.id];
  const displayName = known?.displayName ?? `${sdkModel.name} (Copilot)`;
  const defaultNickname = known?.defaultNickname ?? generateCopilotNickname(sdkModel.id);
  return {
    id: sdkModel.id,
    displayName,
    defaultNickname,
    capabilities: {
      streaming: true,
      maxContextTokens: sdkModel.capabilities.limits.max_context_window_tokens,
      maxOutputTokens: sdkModel.capabilities.limits.max_output_tokens ?? 16384,
      functionCalling: true,
      supports: {
        vision: sdkModel.capabilities.supports.vision,
        reasoningEffort: sdkModel.capabilities.supports.reasoningEffort,
      },
      billing:
        sdkModel.billing?.multiplier !== undefined
          ? { multiplier: sdkModel.billing.multiplier }
          : undefined,
    },
  };
}

function generateCopilotNickname(modelId: string): string {
  const cleaned = modelId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
  return `Copilot${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
}

export class CopilotAdapter implements ProviderAdapter {
  readonly id = 'copilot';
  readonly displayName = 'GitHub Copilot';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;
  private isStarted = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private session: any = null;
  private sessionModelId: string | null = null;
  private sessionId: string | null = null;
  private sessionTitle: string | null = null;
  private lastProcessedMessageIndex: number = -1;
  private contextInitialized: boolean = false;
  private reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | undefined;
  private customAgents:
    | Array<{ name: string; displayName: string; description: string; prompt: string }>
    | undefined;

  constructor(
    _config: {
      apiKey?: string;
      timeout?: number;
    } = {}
  ) {
    void _config;
  }

  setReasoningEffort(effort: 'low' | 'medium' | 'high' | 'xhigh' | undefined): void {
    this.reasoningEffort = effort;
  }

  setCustomAgents(
    agents: Array<{ name: string; displayName: string; description: string; prompt: string }>
  ): void {
    this.customAgents = agents;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if GitHub CLI is installed
      await execFileAsync('gh', ['--version'], { timeout: 5000 });

      // Check if gh copilot extension is installed
      await execFileAsync('gh', ['copilot', '--version'], { timeout: 5000 });

      return true;
    } catch {
      return false;
    }
  }

  async initialize(): Promise<void> {
    const pwshError = await checkPwshAvailable();
    if (pwshError !== null) {
      throw new ProviderErrorImpl({
        code: 'AUTH_FAILED',
        message: pwshError,
        retryable: false,
      });
    }

    try {
      const { CopilotClient } = await import('@github/copilot-sdk');

      const clientOpts: Record<string, unknown> = {
        clientName: 'cebus',
        ...resolveCopilotClientConnectionOptions(process.env),
      };
      this.client = new CopilotClient(clientOpts);
      {
        let timer: ReturnType<typeof setTimeout>;
        await Promise.race([
          this.client.start(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Copilot client.start() timed out after 30s')), 30_000);
          }),
        ]).finally(() => clearTimeout(timer));
      }
      this.isStarted = true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      let helpMessage: string;
      if (errorMsg.includes('--server') || errorMsg.includes('unknown option')) {
        helpMessage =
          'Your GitHub Copilot CLI is outdated. Update with: npm install -g @githubnext/github-copilot-cli@latest';
      } else if (errorMsg.includes('ENOENT') || errorMsg.includes('not found')) {
        helpMessage =
          'GitHub Copilot CLI not found. Install with: npm install -g @githubnext/github-copilot-cli';
      } else if (errorMsg.includes('auth') || errorMsg.includes('401')) {
        helpMessage = 'GitHub Copilot not authenticated. Run: github-copilot-cli auth';
      } else {
        helpMessage = 'Make sure Copilot CLI is installed and authenticated.';
      }

      throw new ProviderErrorImpl({
        code: 'AUTH_FAILED',
        message: `Failed to initialize Copilot: ${errorMsg}. ${helpMessage}`,
        retryable: false,
      });
    }
  }

  async getQuota(): Promise<{ used: number; total: number; remaining: number } | null> {
    if (this.client === null || this.client === undefined || !this.isStarted) return null;
    try {
      const rpc = this.client.rpc;
      if (rpc?.account?.getQuota) {
        const quota = (await rpc.account.getQuota()) as Record<string, unknown>;
        return {
          used: (quota['used'] as number) ?? 0,
          total: (quota['total'] as number) ?? 0,
          remaining: (quota['remaining'] as number) ?? 0,
        };
      }
    } catch {
      // RPC not available or quota endpoint unavailable
    }
    return null;
  }

  async dispose(): Promise<void> {
    this.session = null;
    this.sessionModelId = null;
    this.sessionId = null;
    this.sessionTitle = null;
    this.lastProcessedMessageIndex = -1;
    this.contextInitialized = false;
    this.reasoningEffort = undefined;
    this.customAgents = undefined;

    if (this.client !== null && this.client !== undefined && this.isStarted) {
      try {
        await this.client.stop();
      } catch {
        // Ignore stop errors
      }
    }
    this.client = null;
    this.isStarted = false;
  }

  async listModels(): Promise<ModelInfo[]> {
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions -- runtime duck-typing for optional SDK method
    if (this.client !== null && this.client !== undefined && this.client.listModels) {
      try {
        const sdkModels = (await this.client.listModels()) as Array<{
          id: string;
          name: string;
          capabilities: {
            supports: { vision: boolean; reasoningEffort: boolean };
            limits: {
              max_prompt_tokens?: number;
              max_context_window_tokens: number;
              max_output_tokens?: number;
            };
          };
          billing?: { multiplier?: number };
          policy?: { state: string };
        }>;

        const enabledModels = sdkModels.filter(
          (m): boolean => m.policy === undefined || m.policy.state !== 'disabled'
        );

        if (enabledModels.length > 0) {
          return enabledModels.map(m => mapSdkModel(m));
        }
      } catch {
        // Fall through to fallback list
      }
    }
    return COPILOT_FALLBACK_MODELS;
  }

  async isModelAvailable(modelId: string): Promise<boolean> {
    const models = await this.listModels();
    return models.some(m => m.id === modelId);
  }

  async streamCompletion(
    modelId: string,
    messages: ContextMessage[],
    onToken: (token: string) => void,
    _options?: CompletionOptions
  ): Promise<CompletionResult> {
    if (this.client === null || this.client === undefined || !this.isStarted) {
      throw new ProviderErrorImpl({
        code: 'PROVIDER_ERROR',
        message: 'Copilot client not initialized',
        retryable: false,
      });
    }

    if (this.session === null || this.session === undefined) {
      await this.createNewSession(modelId, messages);
    } else if (this.sessionModelId !== modelId) {
      await this.switchModel(modelId);
    }

    const conversationMessages = messages.filter(m => m.role !== 'system');
    const newMessages = conversationMessages.slice(this.lastProcessedMessageIndex + 1);

    if (newMessages.length === 0) {
      return { content: '', finishReason: 'stop', model: modelId };
    }

    const latestUserMessage = newMessages.filter(m => m.role === 'user').pop();
    const prompt = latestUserMessage
      ? latestUserMessage.content
      : this.formatNewMessages(newMessages);

    // Use event-based streaming instead of sendAndWait
    let fullContent = '';
    let totalCost = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;

        // Idle timeout — resets only on content-producing events
        const IDLE_TIMEOUT = 60_000;
        const HARD_CAP_TIMEOUT = 2 * 60_000;
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        const resetIdleTimer = (): void => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            if (!settled) {
              settled = true;
              cleanup();
              // Resolve with whatever content we have rather than rejecting
              if (fullContent.length > 0) {
                resolve();
              } else {
                reject(new Error('Copilot session idle timeout — no response received'));
              }
            }
          }, IDLE_TIMEOUT);
        };
        resetIdleTimer();

        // Absolute hard cap — never resets
        const hardCapTimer = setTimeout(() => {
          if (!settled) {
            clearTimeout(idleTimer);
            settled = true;
            cleanup();
            if (fullContent.length > 0) {
              resolve();
            } else {
              reject(new Error('Copilot session hard timeout — no response received'));
            }
          }
        }, HARD_CAP_TIMEOUT);

        const settle = (fn: () => void): void => {
          clearTimeout(idleTimer);
          clearTimeout(hardCapTimer);
          fn();
        };

        // Cleanup helper — unsubscribes the streaming handler to prevent
        // stale handlers from accumulating across calls on the same session.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let unsubscribeFn: (() => void) | undefined;
        const cleanup = (): void => {
          unsubscribeFn?.();
          unsubscribeFn = undefined;
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        unsubscribeFn = this.session.on((event: any) => {
          if (settled) return;
          try {
            const type = event?.type as string | undefined;
            const data = event?.data as Record<string, unknown> | undefined;

            // Reset idle timer only on meaningful progress events
            if (type !== undefined && COPILOT_PROGRESS_EVENTS.has(type)) {
              resetIdleTimer();
            }

            if (
              type === 'assistant.message_delta' &&
              data?.['deltaContent'] !== undefined &&
              data?.['deltaContent'] !== null
            ) {
              const token = data['deltaContent'] as string;
              fullContent += token;
              onToken(token);
            } else if (
              type === 'tool.execution_start' &&
              data?.toolName !== undefined &&
              data?.toolName !== null
            ) {
              const toolName = data.toolName as string;
              const args = data.arguments as Record<string, unknown> | undefined;
              const detail = this.formatToolActivity(toolName, args);
              onToken(`\n\n> 🔧 ${detail}\n\n`);
            } else if (type === 'assistant.usage') {
              inputTokens += (data?.['inputTokens'] as number) ?? 0;
              outputTokens += (data?.['outputTokens'] as number) ?? 0;
              totalCost += (data?.['cost'] as number) ?? 0;
            } else if (type === 'session.compaction_complete') {
              const pre = (data?.['preCompactionTokens'] as number) ?? 0;
              const post = (data?.['postCompactionTokens'] as number) ?? 0;
              if (pre > 0) {
                onToken(
                  `\n\n> Context compacted: ${Math.round(pre / 1000)}k → ${Math.round(post / 1000)}k tokens\n\n`
                );
              }
            } else if (type === 'subagent.started') {
              const name = (data?.['name'] ?? data?.['agentName'] ?? 'subagent') as string;
              onToken(`\n\n> Subagent started: ${name}\n\n`);
            } else if (type === 'subagent.completed') {
              const name = (data?.['name'] ?? data?.['agentName'] ?? 'subagent') as string;
              onToken(`\n\n> Subagent completed: ${name}\n\n`);
            } else if (type === 'subagent.failed') {
              const name = (data?.['name'] ?? data?.['agentName'] ?? 'subagent') as string;
              const err = (data?.['error'] as string) ?? 'unknown error';
              onToken(`\n\n> Subagent failed: ${name} — ${err}\n\n`);
            } else if (type === 'session.idle') {
              if (!settled) {
                settled = true;
                cleanup();
                settle(() => resolve());
              }
            } else if (type === 'session.error') {
              if (!settled) {
                settled = true;
                cleanup();
                // If we have content, treat as success (SDK fires spurious errors sometimes)
                if (fullContent.length > 0) {
                  settle(() => resolve());
                } else {
                  settle(() => reject(new Error(String(data?.message ?? 'Copilot session error'))));
                }
              }
            }
          } catch {
            // Ignore individual event processing errors
          }
        });

        // Send the prompt (non-blocking), with optional attachments
        const sendPayload: Record<string, unknown> = { prompt };
        if (_options?.attachments !== undefined && _options.attachments.length > 0) {
          sendPayload['attachments'] = _options.attachments;
        }
        // send() returns immediately with a message ID — the actual response
        // arrives via events (message_delta, message, session.idle). We must NOT
        // race a grace period against the response; rely on session.idle + idle
        // timeout + hard cap for completion.
        this.session
          .send(sendPayload)
          .then(() => {
            // send() acknowledged — the SDK is now processing the prompt.
            // Completion is signaled by session.idle (event handler above),
            // idle timeout, or hard cap timeout.
          })
          .catch((err: unknown) => {
            if (!settled) {
              settled = true;
              cleanup();
              settle(() => reject(err instanceof Error ? err : new Error(String(err))));
            }
          });
      });

      this.lastProcessedMessageIndex = conversationMessages.length - 1;

      const hasUsage = inputTokens > 0 || outputTokens > 0;
      return {
        content: fullContent,
        finishReason: 'stop',
        model: modelId,
        ...(hasUsage
          ? {
              usage: {
                promptTokens: inputTokens,
                completionTokens: outputTokens,
                totalTokens: inputTokens + outputTokens,
              },
            }
          : {}),
        // Copilot is subscription-based — no per-request USD cost.
        // The SDK's 'cost' field is premium request count, not dollars.
      };
    } catch (error) {
      // Reset session so next call gets a fresh one (prevents state corruption)
      this.session = null;
      this.sessionModelId = null;
      this.lastProcessedMessageIndex = -1;

      // On session expiry, fall back to sendAndWait with a fresh session
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isSessionExpired =
        errorMsg.includes('session') &&
        (errorMsg.includes('expired') ||
          errorMsg.includes('invalid') ||
          errorMsg.includes('not found'));
      const isIdleTimeout = errorMsg.includes('Timeout') && errorMsg.includes('session.idle');

      if (isSessionExpired || isIdleTimeout) {
        debug('copilot', 'Stream session stale, recreating', { sessionId: this.sessionId });
        await this.createNewSession(modelId, messages);
        const response = await this.session.sendAndWait({ prompt });
        const respObj = response as Record<string, unknown> | undefined;
        const dataObj = respObj?.data as Record<string, unknown> | undefined;
        const content = (dataObj?.content as string) ?? '';
        onToken(content);
        this.lastProcessedMessageIndex = conversationMessages.length - 1;
        return { content, finishReason: 'stop', model: modelId };
      }

      throw this.mapError(error);
    }
  }

  async complete(
    modelId: string,
    messages: ContextMessage[],
    _options?: CompletionOptions
  ): Promise<CompletionResult> {
    if (this.client === null || this.client === undefined || !this.isStarted) {
      throw new ProviderErrorImpl({
        code: 'PROVIDER_ERROR',
        message: 'Copilot client not initialized',
        retryable: false,
      });
    }

    const requestId = crypto.randomUUID();
    const startTime = new Date();

    try {
      if (this.session === null || this.session === undefined) {
        await this.createNewSession(modelId, messages);
      } else if (this.sessionModelId !== modelId) {
        await this.switchModel(modelId);
      }

      const conversationMessages = messages.filter(m => m.role !== 'system');

      const newMessages = conversationMessages.slice(this.lastProcessedMessageIndex + 1);
      debug('copilot', 'Session reuse', {
        sessionId: this.sessionId,
        totalMessages: conversationMessages.length,
        newMessages: newMessages.length,
        lastProcessedIndex: this.lastProcessedMessageIndex,
      });

      if (newMessages.length === 0) {
        return {
          content: '',
          finishReason: 'stop',
          model: modelId,
        };
      }

      const latestUserMessage = newMessages.filter(m => m.role === 'user').pop();
      const prompt = latestUserMessage
        ? latestUserMessage.content
        : this.formatNewMessages(newMessages);

      // Track cost via event listener during sendAndWait
      let completeCost = 0;
      let completeInputTokens = 0;
      let completeOutputTokens = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const usageUnsub = this.session.on((event: any) => {
        if (event?.type === 'assistant.usage') {
          completeInputTokens += (event.data?.['inputTokens'] as number) ?? 0;
          completeOutputTokens += (event.data?.['outputTokens'] as number) ?? 0;
          completeCost += (event.data?.['cost'] as number) ?? 0;
        }
      });

      const response = await this.sendWithRetry(prompt, modelId, messages);
      if (usageUnsub !== undefined && usageUnsub !== null) usageUnsub();

      this.lastProcessedMessageIndex = conversationMessages.length - 1;

      const respObj = response as Record<string, unknown> | undefined;
      const dataObj = respObj?.data as Record<string, unknown> | undefined;
      const content = (dataObj?.content as string) ?? '';

      logProviderRequest('copilot', {
        requestId,
        model: modelId,
        messages: messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : '[multimodal content]',
          ...(m.name !== undefined && m.name.length > 0 ? { name: m.name } : {}),
        })),
        response: content,
        startTime,
        endTime: new Date(),
        metadata: {
          sessionId: this.sessionId,
          sessionTitle: this.sessionTitle,
          contextInitialized: this.contextInitialized,
          newMessagesCount: newMessages.length,
        },
      });

      const hasUsage = completeInputTokens > 0 || completeOutputTokens > 0;
      return {
        content,
        finishReason: 'stop',
        model: modelId,
        ...(hasUsage
          ? {
              usage: {
                promptTokens: completeInputTokens,
                completionTokens: completeOutputTokens,
                totalTokens: completeInputTokens + completeOutputTokens,
              },
            }
          : {}),
        // Copilot is subscription-based — cost from SDK is premium request count, not dollars.
      };
    } catch (error) {
      logProvider('copilot', 'request-error', {
        sessionId: this.sessionId,
        modelId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw this.mapError(error);
    }
  }

  /**
   * Switch the model on an existing session without destroying it.
   * Preserves conversation history and avoids the createSession() cost.
   */
  private async switchModel(modelId: string): Promise<void> {
    try {
      await this.session.setModel(modelId);
      this.sessionModelId = modelId;
      debug('copilot', 'Model switched in-place', { sessionId: this.sessionId, modelId });
    } catch {
      // Fallback: if setModel() is unavailable (older CLI), recreate the session
      debug('copilot', 'setModel failed, falling back to session recreation', {
        sessionId: this.sessionId,
        modelId,
      });
      this.session = null;
      this.sessionModelId = null;
      this.lastProcessedMessageIndex = -1;
    }
  }

  private async createNewSession(modelId: string, messages: ContextMessage[]): Promise<void> {
    // Sanitize modelId for sessionId — SDK rejects dots and special chars
    const safeModel = modelId.replace(/[^a-zA-Z0-9-]/g, '-');
    const sessionId = `cebus-${safeModel}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    // Generate a cheap default title — the SDK will emit title_changed with a better one
    const modelName = modelId.split('-').slice(-1)[0];
    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const sessionTitle = `Cebus Chat (${modelName}) - ${timestamp}`;

    const systemMessage = messages.find(m => m.role === 'system');
    const systemContent = systemMessage ? systemMessage.content : undefined;

    const createPromise = this.client.createSession({
      ...(modelId !== 'copilot' && { model: modelId }),
      sessionId,
      ...(systemContent !== undefined && systemContent.length > 0
        ? {
            systemMessage: {
              mode: 'append',
              content: systemContent,
            },
          }
        : {}),
      streaming: true,
      infiniteSessions: { enabled: true },
      ...(this.reasoningEffort !== undefined ? { reasoningEffort: this.reasoningEffort } : {}),
      ...(this.customAgents !== undefined && this.customAgents.length > 0
        ? { customAgents: this.customAgents }
        : {}),
      onPermissionRequest: approveAll,
    });
    // Guard against createSession() hanging (e.g., CLI subprocess unresponsive)
    {
      let timer: ReturnType<typeof setTimeout>;
      this.session = await Promise.race([
        createPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Copilot createSession() timed out after 30s')), 30_000);
        }),
      ]).finally(() => clearTimeout(timer));
    }
    this.sessionModelId = modelId;
    this.sessionId = sessionId;
    this.sessionTitle = sessionTitle;
    this.lastProcessedMessageIndex = -1;
    this.contextInitialized = systemContent !== undefined && systemContent.length > 0;

    // Listen for SDK-generated title (free, no extra LLM call)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (this.session?.on) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.session.on((event: any) => {
        if (event?.type === 'session.title_changed') {
          const newTitle = event?.data?.['title'] as string | undefined;
          if (newTitle !== undefined && newTitle.length > 0) {
            this.sessionTitle = newTitle;
          }
        }
      });
    }

    logProvider('copilot', 'session-created', {
      sessionId,
      modelId,
      title: sessionTitle,
      hasSystemContext: systemContent !== undefined && systemContent.length > 0,
    });
    debug('copilot', 'New session created', {
      sessionId,
      modelId,
      title: sessionTitle,
      hasSystemContext: systemContent !== undefined && systemContent.length > 0,
    });
  }

  private async sendWithRetry(
    prompt: string,
    modelId: string,
    messages: ContextMessage[]
  ): Promise<unknown> {
    try {
      return await this.session.sendAndWait({ prompt });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      const isSessionExpired =
        errorMsg.includes('session') &&
        (errorMsg.includes('expired') ||
          errorMsg.includes('invalid') ||
          errorMsg.includes('not found'));
      const isIdleTimeout = errorMsg.includes('Timeout') && errorMsg.includes('session.idle');

      if (isSessionExpired || isIdleTimeout) {
        debug('copilot', 'Session stale, recreating', {
          sessionId: this.sessionId,
          reason: isIdleTimeout ? 'idle-timeout' : 'expired',
          error: errorMsg,
        });
        await this.createNewSession(modelId, messages);
        return await this.session.sendAndWait({ prompt });
      }

      throw error;
    }
  }

  private formatNewMessages(messages: ContextMessage[]): string {
    const parts: string[] = [];
    for (const msg of messages) {
      const textContent = msg.content;
      if (msg.role === 'user') {
        parts.push(textContent);
      } else if (msg.role === 'assistant') {
        parts.push(`[Previous response]: ${textContent}`);
      }
    }
    return parts.join('\n\n');
  }

  async listSessions(filter?: {
    cwd?: string;
    gitRoot?: string;
    branch?: string;
  }): Promise<
    Array<{ sessionId: string; model: string; createdAt: string; lastActivityAt: string }>
  > {
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions -- runtime duck-typing for optional SDK method
    if (this.client === null || this.client === undefined || !this.client.listSessions) return [];
    try {
      const sessions = (await this.client.listSessions(filter)) as Array<{
        session_id: string;
        model: string;
        created_at: string;
        last_activity_at: string;
      }>;
      return sessions.map(s => ({
        sessionId: s.session_id,
        model: s.model,
        createdAt: s.created_at,
        lastActivityAt: s.last_activity_at,
      }));
    } catch {
      return [];
    }
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions -- runtime duck-typing for optional SDK method
    if (this.client === null || this.client === undefined || !this.client.deleteSession)
      return false;
    try {
      await this.client.deleteSession(sessionId);
      return true;
    } catch {
      return false;
    }
  }

  cancelRequest(_requestId: string): void {}

  getSessionTitle(): string | null {
    return this.sessionTitle;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  isContextInitialized(): boolean {
    return this.contextInitialized;
  }

  getLastProcessedMessageIndex(): number {
    return this.lastProcessedMessageIndex;
  }

  private formatToolActivity(toolName: string, args?: Record<string, unknown>): string {
    const name = toolName.toLowerCase();
    if (name.includes('read_file') || name === 'read') {
      const path = (args?.path ?? args?.file_path ?? '') as string;
      return `Reading ${path || 'file'}`;
    }
    if (
      name.includes('edit_file') ||
      name.includes('write_file') ||
      name === 'write' ||
      name === 'edit'
    ) {
      const path = (args?.path ?? args?.file_path ?? '') as string;
      return `Editing ${path || 'file'}`;
    }
    if (name === 'shell' || name.includes('run_command') || name.includes('execute')) {
      const cmd = (args?.command ?? args?.cmd ?? '') as string;
      return `Running: ${cmd ? cmd.slice(0, 80) : 'command'}`;
    }
    if (name.includes('grep') || name.includes('search')) {
      const query = (args?.query ?? args?.pattern ?? '') as string;
      return `Searching: ${query || 'files'}`;
    }
    if (name.includes('web_fetch') || name.includes('fetch_url')) {
      const url = (args?.url ?? '') as string;
      return `Fetching ${url ? url.slice(0, 60) : 'URL'}`;
    }
    return `Using tool: ${toolName}`;
  }

  private mapError(error: unknown): ProviderError {
    // Copilot-specific error enrichment before delegating to shared mapper
    if (error instanceof Error) {
      if (
        error.message.includes('401') ||
        error.message.includes('auth') ||
        error.message.includes('Authentication')
      ) {
        return new ProviderErrorImpl({
          code: 'AUTH_FAILED',
          message: `Copilot authentication failed: ${error.message}. Run 'github-copilot-cli auth' to authenticate.`,
          retryable: false,
        });
      }
      if (error.message.includes('not found') || error.message.includes('ENOENT')) {
        return new ProviderErrorImpl({
          code: 'PROVIDER_ERROR',
          message:
            'Copilot CLI not found. Install it with: npm install -g @githubnext/github-copilot-cli',
          retryable: false,
        });
      }
    }

    return mapErrorByMessage(error);
  }
}

/**
 * Create a Copilot adapter instance.
 */
export function createCopilotAdapter(config?: {
  apiKey?: string;
  timeout?: number;
}): CopilotAdapter {
  return new CopilotAdapter(config);
}

/** Copilot quota information. */
export interface CopilotQuota {
  used: number;
  total: number;
  remaining: number;
}

/**
 * Fetch the current Copilot premium request quota from the registered adapter.
 * Returns null if Copilot is not available or quota info is unavailable.
 */
export async function fetchCopilotQuota(): Promise<CopilotQuota | null> {
  try {
    const { getProviderRegistry } = await import('./registry.js');
    const registry = getProviderRegistry();
    const adapter = registry.get('copilot');
    if (adapter === undefined) return null;
    const copilot = adapter as CopilotAdapter;
    return await copilot.getQuota();
  } catch {
    return null;
  }
}
