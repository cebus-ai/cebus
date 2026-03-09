import type {
  CopilotClient,
  CopilotClientOptions,
  CopilotSession,
  SessionConfig,
  ResumeSessionConfig,
  ModelInfo as SdkModelInfo,
  GetAuthStatusResponse,
  Tool,
} from '@github/copilot-sdk';
import { defineTool } from '@github/copilot-sdk';
import { debug } from '../../core/debug-logger.js';

export { defineTool };
export type { Tool };

export class CopilotClientManager {
  private client: CopilotClient | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly options?: Partial<CopilotClientOptions>) {}

  async ensureClient(): Promise<CopilotClient> {
    if (this.client) return this.client;
    if (!this.initPromise) this.initPromise = this.init();
    await this.initPromise;
    return this.client!;
  }

  private async init(): Promise<void> {
    const { CopilotClient: CopilotClientClass } = await import('@github/copilot-sdk');
    const clientOptions: CopilotClientOptions = {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_PAGER: '',
        GIT_CONFIG_NOSYSTEM: '1',
        ...(process.platform === 'win32' ? { SHELL: 'pwsh.exe' } : {}),
      },
      ...this.options,
    };
    this.client = new CopilotClientClass(clientOptions);
    await this.client.start();
    debug('copilot-client-manager', 'client-started');
  }

  async createSession(config: SessionConfig): Promise<CopilotSession> {
    const client = await this.ensureClient();
    return client.createSession(config);
  }

  async resumeSession(sessionId: string, config: ResumeSessionConfig): Promise<CopilotSession> {
    const client = await this.ensureClient();
    return client.resumeSession(sessionId, config);
  }

  async listModels(): Promise<SdkModelInfo[]> {
    const client = await this.ensureClient();
    return client.listModels();
  }

  async getAuthStatus(): Promise<GetAuthStatusResponse> {
    const client = await this.ensureClient();
    return client.getAuthStatus();
  }

  async dispose(): Promise<void> {
    if (this.client) {
      try {
        await this.client.stop();
      } catch {
        // Ignore stop errors during cleanup
      }
      this.client = null;
      this.initPromise = null;
      debug('copilot-client-manager', 'client-disposed');
    }
  }
}

let sharedManager: CopilotClientManager | null = null;

export function getCopilotClientManager(
  options?: Partial<CopilotClientOptions>
): CopilotClientManager {
  if (!sharedManager) sharedManager = new CopilotClientManager(options);
  return sharedManager;
}

export async function disposeCopilotClientManager(): Promise<void> {
  if (sharedManager) {
    await sharedManager.dispose();
    sharedManager = null;
  }
}
