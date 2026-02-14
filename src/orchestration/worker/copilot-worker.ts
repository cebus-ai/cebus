import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  AgentProfile,
  AgentResponse,
  ApprovalResponse,
  ExecutionContext,
  MCPInitResult,
  OrchestrationLogger,
  OrchestrationStreamEvent,
  PermissionKind,
  WorkerExecutor,
} from '../types.js';
import { OrchestrationError } from '../types.js';
import { debug } from '../../core/debug-logger.js';
import { fileLink } from '../../cli/ui/terminal-link.js';

const execFileAsync = promisify(execFile);

let pwshChecked = false;
let cachedSdk: Record<string, unknown> | null = null;

async function ensurePwsh(): Promise<void> {
  if (pwshChecked || process.platform !== 'win32') return;
  try {
    await execFileAsync('pwsh.exe', ['--version'], { timeout: 5000 });
    pwshChecked = true;
  } catch {
    throw new OrchestrationError(
      'WORKER_EXECUTION',
      'GitHub Copilot SDK requires PowerShell 6+ (pwsh) on Windows, but it was not found. ' +
        'Install it with: winget install Microsoft.PowerShell — then restart your terminal.'
    );
  }
}

async function getCopilotSdk(): Promise<Record<string, unknown>> {
  if (cachedSdk) return cachedSdk;
  cachedSdk = (await import('@github/copilot-sdk')) as Record<string, unknown>;
  return cachedSdk;
}

interface CopilotShutdownStats {
  totalPremiumRequests: number;
  totalApiDurationMs: number;
}

export class CopilotWorker implements WorkerExecutor {
  private client: unknown = null;
  private session: unknown = null;
  private sessionId: string | null = null;
  private otherAgentMessagesSeen = 0;

  private autoApproveBudget = 0;
  private readonly pendingApprovals = new Map<string, (r: ApprovalResponse) => void>();
  private approvalCounter = 0;
  private currentOnStream: ((event: OrchestrationStreamEvent) => void) | undefined;
  private currentTraceId: string | undefined;
  private resetIdleTimeout: (() => void) | undefined;

  private shutdownStats: CopilotShutdownStats | null = null;
  private readonly toolCallArgs = new Map<
    string,
    { toolName: string; args: Record<string, unknown> }
  >();

  constructor(
    _profile: AgentProfile,
    private readonly logger?: OrchestrationLogger
  ) {}

  async execute(
    agentProfile: AgentProfile,
    message: string,
    conversationHistory: ReadonlyArray<{
      role: string;
      content: string;
      name?: string | undefined;
    }>,
    context: ExecutionContext,
    onStream: (event: OrchestrationStreamEvent) => void,
    traceId: string
  ): Promise<AgentResponse> {
    const startTime = Date.now();
    this.logger?.workerStart(traceId, agentProfile.id);

    this.autoApproveBudget = 0;
    this.currentOnStream = onStream;
    this.currentTraceId = traceId;

    try {
      const t0 = Date.now();
      const session = await this.getOrCreateSession(agentProfile);
      const t1 = Date.now();
      debug('copilot-worker', 'timing-session', { ms: t1 - t0, cached: t1 - t0 < 5 });

      onStream({
        type: 'start',
        agentId: agentProfile.id,
        traceId,
        ...(context.orchestratorGuidance ? { guidance: context.orchestratorGuidance } : {}),
      });

      const prompt = this.buildPromptWithHistory(
        message,
        conversationHistory,
        agentProfile.name,
        context.orchestratorGuidance
      );

      let fullContent = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      let premiumRequests = 0;
      let resolved = false;
      let firstTokenTime = 0;

      const result = await new Promise<string>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const resetTimeout = (): void => {
          clearTimeout(timer);
          this.resetIdleTimeout = resetTimeout;
          timer = setTimeout(() => {
            if (!resolved) {
              if (this.pendingApprovals.size > 0) {
                resetTimeout();
                return;
              }
              resolved = true;
              reject(
                new OrchestrationError(
                  'TIMEOUT',
                  `Copilot worker ${agentProfile.id} idle for ${context.timeoutBudget}ms with no activity`,
                  traceId
                )
              );
            }
          }, context.timeoutBudget);
        };
        resetTimeout();

        const token = context.cancellationToken;
        if (token && typeof token.addEventListener === 'function') {
          token.addEventListener('abort', () => {
            clearTimeout(timer);
            if (!resolved) {
              resolved = true;
              reject(
                new OrchestrationError(
                  'CANCELLED',
                  `Copilot worker ${agentProfile.id} was cancelled`,
                  traceId
                )
              );
            }
          });
        }

        const typedSession = session as {
          on(handler: (event: { type: string; data: Record<string, unknown> }) => void): () => void;
          send(options: { prompt: string }): Promise<string>;
        };

        const sendTime = Date.now();
        debug('copilot-worker', 'timing-send-start', { ms: sendTime - t1 });

        const unsubscribe = typedSession.on(event => {
          if (resolved) return;
          resetTimeout();

          if (event.type === 'assistant.message_delta') {
            if (!firstTokenTime) {
              firstTokenTime = Date.now();
              debug('copilot-worker', 'timing-first-token', { ms: firstTokenTime - sendTime });
            }
            const delta = event.data['deltaContent'] as string | undefined;
            if (delta) {
              fullContent += delta;
              onStream({
                type: 'token',
                agentId: agentProfile.id,
                traceId,
                token: delta,
              });
            }
          }

          if (event.type === 'assistant.message') {
            const content = event.data['content'] as string | undefined;
            if (content) {
              fullContent = content;
            }
          }

          if (event.type === 'assistant.usage') {
            inputTokens = (event.data['inputTokens'] as number) ?? inputTokens;
            outputTokens = (event.data['outputTokens'] as number) ?? outputTokens;
            cacheReadTokens = (event.data['cacheReadTokens'] as number) ?? cacheReadTokens;
            cacheWriteTokens = (event.data['cacheWriteTokens'] as number) ?? cacheWriteTokens;
            premiumRequests += (event.data['cost'] as number) ?? 0;
            this.logger?.workerComplete(traceId, agentProfile.id, 0);
            debug('copilot-worker', 'sdk-usage', event.data);
          }

          if (event.type === 'session.idle') {
            clearTimeout(timer);
            unsubscribe();
            if (!resolved) {
              resolved = true;
              debug('copilot-worker', 'timing-idle', {
                totalMs: Date.now() - sendTime,
                firstTokenMs: firstTokenTime ? firstTokenTime - sendTime : -1,
              });
              resolve(fullContent);
            }
          }

          if (event.type === 'tool.execution_start') {
            const toolName = (event.data['toolName'] as string) ?? 'unknown';
            if (!CopilotWorker.HIDDEN_TOOLS.has(toolName)) {
              const toolArgs = CopilotWorker.parseToolArgs(
                event.data['arguments'] ?? event.data['args'] ?? event.data['parameters']
              );
              debug('copilot-worker', 'tool-start', { toolName, toolArgs });
              const callId = event.data['toolCallId'] as string | undefined;
              if (callId) {
                this.toolCallArgs.set(callId, { toolName, args: toolArgs });
              }
              const activity = CopilotWorker.formatToolActivity(toolName, toolArgs);
              onStream({
                type: 'agent_activity',
                traceId,
                agentId: agentProfile.id,
                activity,
                toolName,
                kind: 'start',
              });
            }
          }

          if (event.type === 'tool.execution_progress') {
            const progressMessage = (event.data['progressMessage'] ?? event.data['message']) as
              | string
              | undefined;
            if (progressMessage) {
              onStream({
                type: 'agent_activity',
                traceId,
                agentId: agentProfile.id,
                activity: progressMessage,
                toolName: (event.data['toolName'] as string) ?? undefined,
                kind: 'progress',
              });
            }
          }

          if (event.type === 'tool.execution_partial_result') {
            const partialOutput = event.data['partialOutput'] as string | undefined;
            if (partialOutput) {
              const trimmed =
                partialOutput.length > 120 ? partialOutput.slice(0, 117) + '...' : partialOutput;
              onStream({
                type: 'agent_activity',
                traceId,
                agentId: agentProfile.id,
                activity: trimmed,
                toolName: undefined,
                kind: 'progress',
              });
            }
          }

          if (event.type === 'tool.execution_complete') {
            const callId = event.data['toolCallId'] as string | undefined;
            const stored = callId ? this.toolCallArgs.get(callId) : undefined;
            const toolName = stored?.toolName ?? (event.data['toolName'] as string) ?? 'unknown';
            if (callId) this.toolCallArgs.delete(callId);

            if (!CopilotWorker.HIDDEN_TOOLS.has(toolName)) {
              const success = event.data['success'] as boolean | undefined;
              const sdkResult = event.data['result'] as
                | { content?: string; detailedContent?: string }
                | undefined;
              const sdkError = event.data['error'] as
                | { message?: string; code?: string }
                | undefined;

              debug('copilot-worker', 'tool-complete', {
                toolName,
                success,
                result: sdkResult,
                error: sdkError,
              });

              const result = CopilotWorker.formatToolResult(
                toolName,
                success,
                sdkResult,
                sdkError,
                stored?.args
              );
              onStream({
                type: 'agent_activity',
                traceId,
                agentId: agentProfile.id,
                activity: '',
                toolName,
                kind: 'complete',
                result,
              });
            }
          }

          if (event.type === 'session.error') {
            clearTimeout(timer);
            unsubscribe();
            if (!resolved) {
              resolved = true;
              const errMsg = (event.data['message'] as string) ?? 'Unknown Copilot error';
              if (fullContent.length > 0) {
                this.logger?.workerError(
                  traceId,
                  agentProfile.id,
                  `Non-fatal session.error (content preserved): ${errMsg}`
                );
                resolve(fullContent);
              } else {
                reject(
                  new OrchestrationError('WORKER_EXECUTION', `Copilot error: ${errMsg}`, traceId)
                );
              }
            }
          }
        });

        typedSession.send({ prompt }).catch((err: unknown) => {
          clearTimeout(timer);
          unsubscribe();
          if (!resolved) {
            resolved = true;
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      });

      fullContent = result;

      const latencyMs = Date.now() - startTime;
      this.logger?.workerComplete(traceId, agentProfile.id, latencyMs);

      const hasUsage = inputTokens > 0 || outputTokens > 0;
      const tokenUsage = hasUsage
        ? {
            inputTokens,
            outputTokens,
            ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
            ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
            ...(premiumRequests > 0 ? { premiumRequests } : {}),
          }
        : undefined;

      onStream({
        type: 'complete',
        agentId: agentProfile.id,
        traceId,
        content: fullContent,
        ...(tokenUsage ? { tokenUsage } : {}),
      });

      return {
        agentId: agentProfile.id,
        agentName: agentProfile.name,
        content: fullContent,
        toolInvocations: [],
        ...(tokenUsage ? { tokenUsage } : {}),
      };
    } catch (err) {
      this.clearPendingApprovals();

      const latencyMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : 'Unknown Copilot worker error';
      this.logger?.workerError(traceId, agentProfile.id, errorMsg);

      const errorCode = err instanceof OrchestrationError ? err.code : 'WORKER_EXECUTION';

      onStream({
        type: 'error',
        agentId: agentProfile.id,
        traceId,
        error: {
          code: errorCode,
          message: errorMsg,
          agentId: agentProfile.id,
          recoverable: errorCode !== 'CANCELLED',
        },
      });

      throw new OrchestrationError(
        errorCode,
        `Copilot worker ${agentProfile.id} failed after ${latencyMs}ms: ${errorMsg}`,
        traceId,
        err instanceof Error ? err : undefined
      );
    } finally {
      this.currentOnStream = undefined;
      this.currentTraceId = undefined;
      this.resetIdleTimeout = undefined;
    }
  }

  async initializeMCP(_agentProfile: AgentProfile): Promise<MCPInitResult> {
    return {
      serverId: 'copilot-native',
      status: 'connected',
      toolCount: 0,
    };
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  setSessionId(id: string): void {
    this.sessionId = id;
  }

  getShutdownStats(): CopilotShutdownStats | null {
    return this.shutdownStats;
  }

  async dispose(): Promise<void> {
    if (this.session) {
      try {
        await (this.session as { destroy(): Promise<void> }).destroy();
      } catch (error) {
        debug('copilot-worker', 'session-destroy-failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.session = null;
    }
    if (this.client) {
      try {
        await (this.client as { close(): Promise<void> }).close();
      } catch (error) {
        debug('copilot-worker', 'client-close-failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.client = null;
    }
  }

  resolveApproval(approvalId: string, response: ApprovalResponse): void {
    const resolver = this.pendingApprovals.get(approvalId);
    if (!resolver) return;
    this.pendingApprovals.delete(approvalId);

    this.resetIdleTimeout?.();

    if (response.approved && response.budget !== 1) {
      this.autoApproveBudget = response.budget === -1 ? -1 : Math.max(0, response.budget - 1);
    }

    resolver(response);
  }

  private clearPendingApprovals(): void {
    for (const [, resolver] of this.pendingApprovals) {
      resolver({ approved: false, budget: 0 });
    }
    this.pendingApprovals.clear();
  }

  private static mapPermissionKind(kind: string): PermissionKind {
    switch (kind) {
      case 'shell':
      case 'command':
        return 'shell';
      case 'write':
      case 'file-write':
      case 'create-directory':
        return 'write';
      case 'read':
      case 'file-read':
        return 'read';
      case 'mcp':
        return 'mcp';
      case 'url':
      case 'fetch':
        return 'url';
      default:
        return 'write';
    }
  }

  private static readonly HIDDEN_TOOLS = new Set(['report_intent']);

  private static formatToolActivity(toolName: string, args: Record<string, unknown>): string {
    const pathArg = CopilotWorker.extractPathArg(args);
    const basename = pathArg ? (pathArg.split(/[/\\]/).pop() ?? pathArg) : undefined;
    const displayName = basename && pathArg ? fileLink(basename, pathArg) : basename;

    switch (toolName) {
      case 'read_file':
      case 'view':
      case 'cat':
        return displayName ? `Read ${displayName}` : 'Reading file';
      case 'edit_file':
      case 'replace':
      case 'patch':
        return displayName ? `Editing ${displayName}` : 'Editing file';
      case 'create_file':
      case 'write_file':
        return displayName ? `Creating ${displayName}` : 'Creating file';
      case 'delete_file':
      case 'remove':
        return displayName ? `Deleting ${displayName}` : 'Deleting file';
      case 'shell':
      case 'powershell':
      case 'bash':
      case 'terminal':
      case 'run_command': {
        const cmd = (args['command'] ?? args['cmd'] ?? args['script']) as string | undefined;
        if (!cmd) return 'Running command';
        const trimmed = cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
        return `Running: ${trimmed}`;
      }
      case 'stop_powershell':
      case 'stop_shell':
      case 'stop_bash':
        return 'Stopping command';
      case 'list_directory':
      case 'ls':
        return displayName ? `Listing ${displayName}` : 'Listing directory';
      case 'glob':
      case 'find_files':
      case 'find': {
        const pattern = (args['pattern'] ?? args['glob'] ?? args['include']) as string | undefined;
        return pattern ? `Searching for ${pattern}` : 'Searching for files';
      }
      case 'search':
      case 'grep':
      case 'ripgrep': {
        const query = (args['query'] ??
          args['pattern'] ??
          args['search'] ??
          args['keyword'] ??
          args['text'] ??
          args['regex']) as string | undefined;
        return query ? `Searching: ${query}` : 'Searching files';
      }
      case 'web_search':
      case 'bing_search': {
        const q = (args['query'] ?? args['q']) as string | undefined;
        return q ? `Searching web: ${q}` : 'Searching the web';
      }
      case 'web_fetch':
      case 'fetch_url': {
        const url = (args['url'] ?? args['href']) as string | undefined;
        return url ? `Fetching ${url}` : 'Fetching URL';
      }
      case 'think':
      case 'plan':
        return 'Thinking';
      default: {
        const detail = CopilotWorker.extractArgDetail(args);
        const readable = toolName.replace(/[_-]/g, ' ');
        const label = readable.charAt(0).toUpperCase() + readable.slice(1);
        return detail ? `${label}: ${detail}` : label;
      }
    }
  }

  private static extractPathArg(args: Record<string, unknown>): string | undefined {
    for (const key of [
      'path',
      'filePath',
      'file_path',
      'file',
      'filename',
      'file_name',
      'target',
      'targetPath',
      'target_path',
      'destination',
      'uri',
      'resource',
      'source',
      'sourcePath',
      'source_path',
      'directory',
      'dir',
      'folder',
    ]) {
      const val = args[key];
      if (typeof val === 'string' && val.length > 0) return val;
    }
    for (const val of Object.values(args)) {
      if (
        typeof val === 'string' &&
        val.length > 0 &&
        /[/\\]/.test(val) &&
        /\.\w{1,10}$/.test(val)
      ) {
        return val;
      }
    }
    return undefined;
  }

  private static extractArgDetail(args: Record<string, unknown>): string | undefined {
    for (const key of [
      'path',
      'filePath',
      'file',
      'filename',
      'query',
      'pattern',
      'command',
      'cmd',
      'url',
      'name',
    ]) {
      const val = args[key];
      if (typeof val === 'string' && val.length > 0) {
        return val.length > 60 ? val.slice(0, 57) + '...' : val;
      }
    }
    return undefined;
  }

  private static parseToolArgs(raw: unknown): Record<string, unknown> {
    if (raw === null || raw === undefined) return {};
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return { path: raw };
      }
    }
    if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
    return {};
  }

  private static formatToolResult(
    toolName: string,
    success: boolean | undefined,
    sdkResult: { content?: string; detailedContent?: string } | undefined,
    sdkError: { message?: string; code?: string } | undefined,
    originalArgs?: Record<string, unknown> | undefined
  ): string {
    if (success === false && sdkError?.message) {
      const msg = sdkError.message;
      return msg.length > 100 ? msg.slice(0, 97) + '...' : msg;
    }

    const content = sdkResult?.content ?? '';

    switch (toolName) {
      case 'read_file':
      case 'view':
      case 'cat': {
        if (content) {
          const lines = content.split('\n').length;
          return `${lines} lines`;
        }
        return 'done';
      }
      case 'edit_file':
      case 'replace':
      case 'patch':
        return 'changes applied';
      case 'create_file':
      case 'write_file':
        return 'file created';
      case 'delete_file':
      case 'remove':
        return 'file deleted';
      case 'shell':
      case 'powershell':
      case 'bash':
      case 'terminal':
      case 'run_command': {
        if (content) {
          const lines = content.trim().split('\n');
          const lastLine = lines[lines.length - 1] ?? '';
          const exitMatch = /exit\s*code\s*[=:]?\s*(\d+)/i.exec(content);
          if (exitMatch) return `exit code ${exitMatch[1]}`;
          if (lastLine.length <= 80) return lastLine || 'done';
          return lastLine.slice(0, 77) + '...';
        }
        return 'done';
      }
      case 'stop_powershell':
      case 'stop_shell':
      case 'stop_bash':
        return 'stopped';
      case 'list_directory':
      case 'ls': {
        if (content) {
          const entries = content.trim().split('\n').length;
          return `${entries} entries`;
        }
        return 'done';
      }
      case 'glob':
      case 'find_files':
      case 'find': {
        if (content) {
          const files = content.trim().split('\n').filter(Boolean).length;
          return `${files} files found`;
        }
        return 'done';
      }
      case 'search':
      case 'grep':
      case 'ripgrep': {
        if (content) {
          const matches = content.trim().split('\n').filter(Boolean).length;
          return `${matches} matches`;
        }
        return 'done';
      }
      case 'web_search':
      case 'bing_search': {
        const query = originalArgs
          ? ((originalArgs['query'] ?? originalArgs['q']) as string | undefined)
          : undefined;
        if (content) {
          const results = content.trim().split('\n').filter(Boolean).length;
          return query ? `${results} results for "${query}"` : `${results} results`;
        }
        return 'done';
      }
      default: {
        if (content && content.length > 0) {
          const trimmed = content.trim();
          if (trimmed.length <= 80) return trimmed;
          return trimmed.slice(0, 77) + '...';
        }
        return 'done';
      }
    }
  }

  private buildPromptWithHistory(
    message: string,
    history: ReadonlyArray<{ role: string; content: string; name?: string | undefined }>,
    myName: string,
    orchestratorGuidance?: string | undefined
  ): string {
    const otherAgentMessages = history.filter(m => m.role === 'assistant' && m.name !== myName);
    const newMessages = otherAgentMessages.slice(this.otherAgentMessagesSeen);
    this.otherAgentMessagesSeen = otherAgentMessages.length;

    const guidancePrefix = orchestratorGuidance
      ? `[Orchestrator Instructions]\n${orchestratorGuidance}\n\n`
      : '';

    if (newMessages.length === 0) return `${guidancePrefix}${message}`;

    const lines = newMessages.map(m => {
      const sender = m.name ?? 'Another model';
      return `${sender}: ${m.content}`;
    });

    return `${guidancePrefix}${message}\n\n<group_chat_context>\n${lines.join('\n\n')}\n</group_chat_context>`;
  }

  private async getOrCreateSession(agentProfile: AgentProfile): Promise<unknown> {
    if (this.session) return this.session;

    const sessionStart = Date.now();
    await ensurePwsh();
    debug('copilot-worker', 'timing-pwsh-check', { ms: Date.now() - sessionStart });

    const workingDir = agentProfile.allowedPaths?.[0];

    if (!this.client) {
      const sdkStart = Date.now();
      const copilotSdk = await getCopilotSdk();
      debug('copilot-worker', 'timing-sdk-import', { ms: Date.now() - sdkStart });
      const CopilotClient = copilotSdk['CopilotClient'] ?? copilotSdk['default'];

      if (!CopilotClient) {
        throw new OrchestrationError(
          'WORKER_EXECUTION',
          'Failed to import CopilotClient from @github/copilot-sdk'
        );
      }

      const clientOptions: Record<string, unknown> = {};
      if (workingDir) {
        clientOptions['cwd'] = workingDir;
      }

      const safeGitEnv: Record<string, string> = {
        GIT_TERMINAL_PROMPT: '0',
        GIT_PAGER: '',
        GIT_CONFIG_NOSYSTEM: '1',
      };

      if (process.platform === 'win32') {
        clientOptions['env'] = {
          ...process.env,
          ...safeGitEnv,
          SHELL: 'pwsh.exe',
        };
      } else {
        clientOptions['env'] = {
          ...process.env,
          ...safeGitEnv,
        };
      }

      this.client = new (CopilotClient as new (
        opts?: Record<string, unknown>
      ) => Record<string, unknown>)(clientOptions);
    }

    if (this.sessionId) {
      try {
        const resumeSession = (this.client as Record<string, unknown>)['resumeSession'] as
          | ((sessionId: string) => Promise<unknown>)
          | undefined;
        if (resumeSession) {
          this.session = await resumeSession.call(this.client, this.sessionId);
          debug('copilot-worker', 'session-resumed', { sessionId: this.sessionId });
          return this.session;
        }
      } catch (err) {
        debug('copilot-worker', 'session-resume-failed', {
          sessionId: this.sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
        this.sessionId = null;
      }
    }

    const systemContent = agentProfile.instructions.join('\n');

    const toolsEnabled =
      agentProfile.availableTools === undefined || agentProfile.availableTools.length > 0;

    const sessionConfig: Record<string, unknown> = {
      model: agentProfile.model ?? 'gpt-4o',
      systemMessage: { mode: 'append', content: systemContent },
      streaming: true,
    };

    if (workingDir) {
      sessionConfig['workingDirectory'] = workingDir;
    }

    sessionConfig['onPermissionRequest'] = (request: {
      kind: string;
      toolName?: string;
      [key: string]: unknown;
    }): Promise<{ kind: string }> | { kind: string } => {
      debug('copilot-worker', 'permission-request', request);

      const permKind = CopilotWorker.mapPermissionKind(request.kind);

      if (permKind === 'read') {
        return { kind: 'approved' };
      }

      if (!toolsEnabled) {
        return { kind: 'denied-by-rules' };
      }

      if (this.autoApproveBudget !== 0) {
        if (this.autoApproveBudget > 0) {
          this.autoApproveBudget--;
        }
        return { kind: 'approved' };
      }

      const approvalId = `${agentProfile.id}-perm-${++this.approvalCounter}`;
      const onStream = this.currentOnStream;
      const traceId = this.currentTraceId ?? '';

      if (!onStream) {
        return { kind: 'denied-by-rules' };
      }

      const parameters: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(request)) {
        if (key !== 'kind') {
          parameters[key] = value;
        }
      }

      onStream({
        type: 'approval_required',
        traceId,
        agentId: agentProfile.id,
        toolName: request.toolName ?? request.kind,
        parameters,
        approvalId,
        permissionKind: permKind,
      });

      return new Promise<{ kind: string }>(resolve => {
        this.pendingApprovals.set(approvalId, (response: ApprovalResponse) => {
          if (response.approved) {
            resolve({ kind: 'approved' });
          } else {
            resolve({ kind: 'denied-interactively-by-user' });
          }
        });
      });
    };

    if (agentProfile.availableTools !== undefined) {
      sessionConfig['availableTools'] = agentProfile.availableTools;
    }

    if (agentProfile.allowedPaths !== undefined) {
      sessionConfig['allowedPaths'] = agentProfile.allowedPaths;
    }

    if (agentProfile.mcpServers && agentProfile.mcpServers.length > 0) {
      sessionConfig['mcpServers'] = agentProfile.mcpServers.map(s => ({
        id: s.id,
        type: s.type === 'local' ? 'stdio' : 'http',
        command: s.command,
        args: s.args,
        url: s.url,
        headers: s.headers,
        env: s.env,
      }));
    }

    const createSession = (this.client as Record<string, unknown>)['createSession'] as
      | ((config: Record<string, unknown>) => Promise<unknown>)
      | undefined;

    if (!createSession) {
      throw new OrchestrationError(
        'WORKER_EXECUTION',
        'CopilotClient.createSession is not available'
      );
    }

    const createStart = Date.now();
    this.session = await createSession.call(this.client, sessionConfig);
    debug('copilot-worker', 'timing-create-session', { ms: Date.now() - createStart });

    const sessionObj = this.session as Record<string, unknown> | null;
    const newSessionId = sessionObj?.['sessionId'] ?? sessionObj?.['id'];
    if (typeof newSessionId === 'string') {
      this.sessionId = newSessionId;
      debug('copilot-worker', 'session-created', { sessionId: this.sessionId });
    }
    debug('copilot-worker', 'timing-session-total', { ms: Date.now() - sessionStart });

    const typedNewSession = this.session as {
      on(handler: (event: { type: string; data: Record<string, unknown> }) => void): () => void;
    };
    typedNewSession.on(event => {
      if (event.type === 'session.shutdown') {
        this.shutdownStats = {
          totalPremiumRequests: (event.data['totalPremiumRequests'] as number) ?? 0,
          totalApiDurationMs: (event.data['totalApiDurationMs'] as number) ?? 0,
        };
        debug('copilot-worker', 'session-shutdown', this.shutdownStats);
      }

      if (event.type === 'session.compaction_start') {
        debug('copilot-worker', 'sdk-compaction-start', event.data);
        this.currentOnStream?.({
          type: 'compaction_status',
          traceId: this.currentTraceId ?? '',
          agentId: agentProfile.id,
          agentName: agentProfile.name,
          source: 'sdk',
          totalMessages: 0,
          windowSize: 0,
          compactedMessages: 0,
          summarized: false,
        });
      }

      if (event.type === 'session.compaction_complete') {
        debug('copilot-worker', 'sdk-compaction-complete', event.data);
        this.currentOnStream?.({
          type: 'compaction_status',
          traceId: this.currentTraceId ?? '',
          agentId: agentProfile.id,
          agentName: agentProfile.name,
          source: 'sdk',
          totalMessages: (event.data['preCompactionTokens'] as number) ?? 0,
          windowSize: (event.data['postCompactionTokens'] as number) ?? 0,
          compactedMessages: (event.data['messagesRemoved'] as number) ?? 1,
          summarized: true,
        });
      }
    });

    return this.session;
  }
}
