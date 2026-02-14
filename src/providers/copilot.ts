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
  error?: string;
}

export async function checkCopilotStatus(): Promise<CopilotStatus> {
  const status: CopilotStatus = {
    installed: false,
    authenticated: false,
  };

  const pwshError = await checkPwshAvailable();
  if (pwshError) {
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
    const client = new CopilotClient();
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
      status.error = 'GitHub Copilot not authenticated. Run: github-copilot-cli auth';
    } else {
      status.error = `Copilot initialization failed: ${errorMsg}`;
    }
  }

  return status;
}

const COPILOT_MODELS: ModelInfo[] = [
  {
    id: 'GPT-5.2-Codex',
    displayName: 'GPT-5.2 Codex (Copilot)',
    defaultNickname: 'Copilot GPT-5.2',
    capabilities: {
      streaming: true,
      maxContextTokens: 256000,
      maxOutputTokens: 16384,
      functionCalling: true,
    },
  },
  {
    id: 'gpt-5.1-codex',
    displayName: 'GPT-5.1 Codex (Copilot)',
    defaultNickname: 'Copilot51',
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
    defaultNickname: 'CopilotGPT',
    capabilities: {
      streaming: true,
      maxContextTokens: 256000,
      maxOutputTokens: 16384,
      functionCalling: true,
    },
  },
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
    defaultNickname: 'CopilotSonnet',
    capabilities: {
      streaming: true,
      maxContextTokens: 200000,
      maxOutputTokens: 64000,
      functionCalling: true,
    },
  },
  {
    id: 'claude-opus-4.5',
    displayName: 'Claude Opus 4.5 (Copilot)',
    defaultNickname: 'CopilotOpus',
    capabilities: {
      streaming: true,
      maxContextTokens: 200000,
      maxOutputTokens: 64000,
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

export class CopilotAdapter implements ProviderAdapter {
  readonly id = 'copilot';
  readonly displayName = 'GitHub Copilot';

  /**
   * Copilot SDK (`@github/copilot-sdk`) does not ship TypeScript type declarations.
   * The CopilotClient and Session objects are untyped, requiring `any` here.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;
  private isStarted = false;
  /**
   * Copilot SDK session instance — untyped because the SDK has no TypeScript declarations.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private session: any = null;
  private sessionModelId: string | null = null;
  private sessionId: string | null = null;
  private sessionTitle: string | null = null;
  private lastProcessedMessageIndex: number = -1;
  private contextInitialized: boolean = false;

  constructor(
    _config: {
      apiKey?: string;
      timeout?: number;
    } = {}
  ) {
    void _config;
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
    if (pwshError) {
      throw new ProviderErrorImpl({
        code: 'AUTH_FAILED',
        message: pwshError,
        retryable: false,
      });
    }

    try {
      const { CopilotClient } = await import('@github/copilot-sdk');

      this.client = new CopilotClient();
      await this.client.start();
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

  async dispose(): Promise<void> {
    this.session = null;
    this.sessionModelId = null;
    this.sessionId = null;
    this.sessionTitle = null;
    this.lastProcessedMessageIndex = -1;
    this.contextInitialized = false;

    if (this.client && this.isStarted) {
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
    if (this.client?.getModels) {
      try {
        const models = await this.client.getModels();
        return models.map((id: string) => ({
          id,
          displayName: `${id} (Copilot)`,
          defaultNickname: `Copilot-${id}`,
          capabilities: {
            streaming: true,
            maxContextTokens: 128000,
            maxOutputTokens: 4096,
            functionCalling: true,
          },
        }));
      } catch {
      }
    }
    return COPILOT_MODELS;
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
    const result = await this.complete(modelId, messages, _options);
    onToken(result.content);
    return result;
  }

  async complete(
    modelId: string,
    messages: ContextMessage[],
    _options?: CompletionOptions
  ): Promise<CompletionResult> {
    if (!this.client || !this.isStarted) {
      throw new ProviderErrorImpl({
        code: 'PROVIDER_ERROR',
        message: 'Copilot client not initialized',
        retryable: false,
      });
    }

    const requestId = crypto.randomUUID();
    const startTime = new Date();

    try {
      if (!this.session || this.sessionModelId !== modelId) {
        await this.createNewSession(modelId, messages);
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

      const response = await this.sendWithRetry(prompt, modelId, messages);

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
          ...(m.name ? { name: m.name } : {}),
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

      return {
        content,
        finishReason: 'stop',
        model: modelId,
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

  private async createNewSession(modelId: string, messages: ContextMessage[]): Promise<void> {
    const sessionId = `cebus-${modelId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    const modelName = modelId.split('-').slice(-1)[0];
    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const sessionTitle = `Cebus Chat (${modelName}) - ${timestamp}`;

    const systemMessage = messages.find(m => m.role === 'system');
    const systemContent = systemMessage ? systemMessage.content : undefined;

    this.session = await this.client.createSession({
      ...(modelId !== 'copilot' && { model: modelId }),
      session_id: sessionId,
      ...(systemContent && {
        system_message: {
          mode: 'append',
          content: systemContent,
        },
      }),
    });
    this.sessionModelId = modelId;
    this.sessionId = sessionId;
    this.sessionTitle = sessionTitle;
    this.lastProcessedMessageIndex = -1;
    this.contextInitialized = !!systemContent;

    logProvider('copilot', 'session-created', {
      sessionId,
      modelId,
      title: sessionTitle,
      hasSystemContext: !!systemContent,
    });
    debug('copilot', 'New session created', {
      sessionId,
      modelId,
      title: sessionTitle,
      hasSystemContext: !!systemContent,
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

  cancelRequest(_requestId: string): void {
  }

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
