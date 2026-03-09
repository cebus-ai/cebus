/**
 * ACP session — wraps an ACP session ID and maps ACP `session/update`
 * notifications to SDK-compatible events.
 *
 * Event mapping:
 *   ACP text content      → assistant.message_delta + assistant.message
 *   ACP reasoning         → assistant.reasoning_delta + assistant.reasoning
 *   ACP tool_call         → tool.execution_start
 *   ACP tool_result       → tool.execution_complete
 *   ACP turn lifecycle    → assistant.turn_start + assistant.turn_end
 *   ACP prompt complete   → session.idle
 *   ACP errors            → session.error
 *   Pass-through: session.compaction_*, subagent.*, tool.execution_progress,
 *                 tool.execution_partial_result, session.plan_changed,
 *                 session.workspace_file_changed, session.task_complete,
 *                 session.shutdown, session.context_changed, session.usage_info,
 *                 skill.invoked, hook.start, hook.end
 */

import type { MessageConnection, Disposable } from 'vscode-jsonrpc/node';

export interface AcpSessionConfig {
  model?: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  session_id?: string;
  systemMessage?: { mode: string; content: string };
  streaming?: boolean;
  infiniteSessions?: { enabled: boolean };
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  customAgents?: Array<{ name: string; displayName: string; description: string; prompt: string }>;
  onPermissionRequest?: (request: Record<string, unknown>) => { kind: string } | Promise<{ kind: string }>;
  onSessionStart?: (input: Record<string, unknown>) => void;
  onSessionEnd?: (input: Record<string, unknown>) => void;
  onPreToolUse?: (input: Record<string, unknown>) => void;
  onPostToolUse?: (input: Record<string, unknown>) => void;
  onErrorOccurred?: (input: Record<string, unknown>) => void;
  onUserInputRequest?: (request: { prompt: string }) => Promise<string>;
  workingDirectory?: string;
  availableTools?: unknown[];
  allowedPaths?: string[];
  mcpServers?: unknown[];
  provider?: { type: string; baseUrl: string; apiKey: string };
}

type EventHandler = (event: { type: string; data: Record<string, unknown> }) => void;

/** Timeout for `session/prompt` JSON-RPC request (5 minutes). */
const SEND_REQUEST_TIMEOUT = 5 * 60_000;

/** Event types that map 1:1 from ACP notifications to SDK events (no transformation). */
const PASSTHROUGH_TYPES = new Set([
  'session.compaction_start',
  'session.compaction_complete',
  'session.context_changed',
  'session.plan_changed',
  'session.workspace_file_changed',
  'session.task_complete',
  'session.usage_info',
  'session.truncation',
  'session.snapshot_rewind',
  'session.model_change',
  'session.mode_changed',
  'session.title_changed',
  'session.info',
  'session.warning',
  'session.handoff',
  'session.shutdown',
  'subagent.started',
  'subagent.completed',
  'subagent.failed',
  'subagent.selected',
  'subagent.deselected',
  'tool.execution_progress',
  'tool.execution_partial_result',
  'tool.user_requested',
  'skill.invoked',
  'hook.start',
  'hook.end',
  'abort',
  'system.message',
  'pending_messages.modified',
]);

export class AcpSession {
  readonly sessionId: string;
  private connection: MessageConnection;
  private config: AcpSessionConfig;
  private handlers = new Set<EventHandler>();
  private notificationDisposable: Disposable | null = null;
  private fullContent = '';
  private fullReasoning = '';
  /** Whether session.idle was already emitted for the current prompt (via notification). */
  private idleEmitted = false;

  constructor(connection: MessageConnection, sessionId: string, config: AcpSessionConfig) {
    this.connection = connection;
    this.sessionId = sessionId;
    this.config = config;
    this.setupNotificationHandler();
  }

  private setupNotificationHandler(): void {
    // Listen for session/update notifications from the ACP CLI
    this.notificationDisposable = this.connection.onNotification(
      'session/update',
      (params: Record<string, unknown>) => {
        // Only handle updates for this session
        if (params['sessionId'] !== this.sessionId) return;
        this.handleUpdate(params);
      }
    );

    // Also listen for permission requests
    this.connection.onRequest(
      'permission/request',
      async (params: Record<string, unknown>): Promise<{ kind: string }> => {
        if (params['sessionId'] !== this.sessionId) {
          return { kind: 'denied-by-rules' };
        }
        if (this.config.onPermissionRequest) {
          return await this.config.onPermissionRequest(params);
        }
        return { kind: 'approved' };
      }
    );

    // Listen for user input requests
    this.connection.onRequest(
      'input/request',
      async (params: { sessionId: string; prompt: string }): Promise<{ answer: string }> => {
        if (params.sessionId !== this.sessionId) {
          return { answer: '' };
        }
        if (this.config.onUserInputRequest) {
          const answer = await this.config.onUserInputRequest({ prompt: params.prompt });
          return { answer };
        }
        return { answer: '' };
      }
    );
  }

  private handleUpdate(params: Record<string, unknown>): void {
    const type = params['type'] as string | undefined;
    const data = (params['data'] ?? params) as Record<string, unknown>;

    if (!type) {
      // Raw content update — map to assistant.message_delta
      const content = params['content'] as string | undefined;
      if (content !== undefined) {
        this.fullContent += content;
        this.emit('assistant.message_delta', { deltaContent: content, content: this.fullContent });
      }
      return;
    }

    // Direct pass-through for events that already match SDK format
    if (PASSTHROUGH_TYPES.has(type)) {
      this.emit(type, data);
      return;
    }

    // Map ACP update types to SDK event types
    switch (type) {
      case 'text':
      case 'content':
      case 'assistant.message_delta': {
        const delta = (data['deltaContent'] ?? data['content'] ?? data['text'] ?? '') as string;
        if (delta.length > 0) {
          this.fullContent += delta;
          this.emit('assistant.message_delta', { deltaContent: delta, content: this.fullContent });
        }
        break;
      }

      case 'assistant.streaming_delta': {
        // Progress indicator (totalResponseSizeBytes) — pass through
        this.emit('assistant.streaming_delta', data);
        break;
      }

      case 'text_done':
      case 'content_done':
      case 'assistant.message': {
        const content = (data['content'] ?? data['text'] ?? this.fullContent) as string;
        this.emit('assistant.message', {
          content,
          messageId: data['messageId'],
          toolRequests: data['toolRequests'],
          reasoningOpaque: data['reasoningOpaque'],
          reasoningText: data['reasoningText'],
          phase: data['phase'],
          interactionId: data['interactionId'],
          parentToolCallId: data['parentToolCallId'],
        });
        break;
      }

      case 'assistant.intent': {
        this.emit('assistant.intent', data);
        break;
      }

      case 'turn_start':
      case 'assistant.turn_start': {
        this.emit('assistant.turn_start', {
          turnId: data['turnId'] ?? data['id'] ?? '',
          interactionId: data['interactionId'],
        });
        break;
      }

      case 'turn_end':
      case 'assistant.turn_end': {
        this.emit('assistant.turn_end', {
          turnId: data['turnId'] ?? data['id'] ?? '',
        });
        break;
      }

      case 'reasoning':
      case 'thinking':
      case 'assistant.reasoning_delta': {
        const delta = (data['deltaContent'] ?? data['content'] ?? data['text'] ?? '') as string;
        if (delta.length > 0) {
          this.fullReasoning += delta;
          this.emit('assistant.reasoning_delta', { deltaContent: delta });
        }
        break;
      }

      case 'reasoning_done':
      case 'thinking_done':
      case 'assistant.reasoning': {
        const content = (data['content'] ?? this.fullReasoning) as string;
        this.emit('assistant.reasoning', { content });
        break;
      }

      case 'tool_call':
      case 'tool.execution_start': {
        this.emit('tool.execution_start', {
          toolName: data['toolName'] ?? data['name'] ?? 'unknown',
          toolCallId: data['toolCallId'] ?? data['id'] ?? '',
          arguments: data['arguments'] ?? data['args'] ?? data['parameters'] ?? {},
          mcpServerName: data['mcpServerName'],
          mcpToolName: data['mcpToolName'],
          parentToolCallId: data['parentToolCallId'],
        });
        if (this.config.onPreToolUse) {
          this.config.onPreToolUse({
            toolName: (data['toolName'] ?? data['name'] ?? 'unknown') as string,
          });
        }
        break;
      }

      case 'tool_result':
      case 'tool.execution_complete': {
        this.emit('tool.execution_complete', {
          toolCallId: data['toolCallId'] ?? data['id'] ?? '',
          toolName: data['toolName'] ?? data['name'] ?? 'unknown',
          success: data['success'] ?? true,
          result: data['result'] ?? data['output'] ?? {},
          error: data['error'],
          model: data['model'],
          interactionId: data['interactionId'],
          isUserRequested: data['isUserRequested'],
          toolTelemetry: data['toolTelemetry'],
          parentToolCallId: data['parentToolCallId'],
        });
        if (this.config.onPostToolUse) {
          this.config.onPostToolUse({
            toolName: (data['toolName'] ?? data['name'] ?? 'unknown') as string,
          });
        }
        break;
      }

      case 'usage':
      case 'assistant.usage': {
        this.emit('assistant.usage', {
          inputTokens: data['inputTokens'] ?? data['input_tokens'] ?? 0,
          outputTokens: data['outputTokens'] ?? data['output_tokens'] ?? 0,
          cacheReadTokens: data['cacheReadTokens'] ?? data['cache_read_tokens'] ?? 0,
          cacheWriteTokens: data['cacheWriteTokens'] ?? data['cache_write_tokens'] ?? 0,
          cost: data['cost'] ?? 0,
          model: data['model'],
          duration: data['duration'],
          initiator: data['initiator'],
          apiCallId: data['apiCallId'],
          providerCallId: data['providerCallId'],
          parentToolCallId: data['parentToolCallId'],
        });
        break;
      }

      case 'done':
      case 'complete':
      case 'prompt_complete':
      case 'response_complete':
      case 'session.idle': {
        // Emit final message if we accumulated content
        if (this.fullContent.length > 0) {
          this.emit('assistant.message', { content: this.fullContent });
        }
        this.idleEmitted = true;
        this.emit('session.idle', data);
        // Reset for next prompt
        this.fullContent = '';
        this.fullReasoning = '';
        break;
      }

      case 'error':
      case 'session.error': {
        this.emit('session.error', {
          message: data['message'] ?? data['error'] ?? 'Unknown ACP error',
          errorType: data['errorType'],
          stack: data['stack'],
          statusCode: data['statusCode'],
          providerCallId: data['providerCallId'],
        });
        if (this.config.onErrorOccurred) {
          this.config.onErrorOccurred({
            error: ((data['message'] ?? data['error']) as string) ?? 'Unknown error',
            errorContext: 'acp',
            recoverable: (data['recoverable'] as boolean) ?? false,
          });
        }
        break;
      }

      case 'user.message': {
        this.emit('user.message', data);
        break;
      }

      default: {
        // Unknown type — emit as-is so consumers can handle it.
        // eslint-disable-next-line no-console
        console.warn(`[AcpSession] Unmapped event type: ${type} (keys: ${Object.keys(data).join(', ')})`);
        this.emit(type, data);
        break;
      }
    }
  }

  private emit(type: string, data: Record<string, unknown>): void {
    const event = { type, data };
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // Don't let one handler's error break others
      }
    }
  }

  on(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return (): void => {
      this.handlers.delete(handler);
    };
  }

  async send(options: { prompt: string; attachments?: unknown[] }): Promise<void> {
    // Reset content accumulators for new prompt
    this.fullContent = '';
    this.fullReasoning = '';
    this.idleEmitted = false;

    const messages: Array<{ type: string; text: string }> = [
      { type: 'text', text: options.prompt },
    ];

    // Fire session start hook
    if (this.config.onSessionStart) {
      this.config.onSessionStart({ source: 'send' });
    }

    // Guard against the JSON-RPC request hanging forever.
    // The CLI's session/prompt response may block for the entire agentic loop,
    // so use a generous timeout (5 minutes). The CopilotWorker has its own
    // idle + hard cap timeouts that will fire sooner in most cases.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.connection.sendRequest('session/prompt', {
          sessionId: this.sessionId,
          messages,
          ...(this.config.model ? { model: this.config.model } : {}),
          ...(this.config.systemMessage ? { systemMessage: this.config.systemMessage } : {}),
          ...(this.config.reasoningEffort ? { reasoningEffort: this.config.reasoningEffort } : {}),
          ...(options.attachments && options.attachments.length > 0
            ? { attachments: options.attachments }
            : {}),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`ACP session/prompt timed out after ${SEND_REQUEST_TIMEOUT / 1000}s`)),
            SEND_REQUEST_TIMEOUT
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    // If session/prompt resolved but no session.idle notification arrived
    // via session/update, emit session.idle as a fallback so the CopilotWorker
    // doesn't hang. The CLI may signal completion solely through the RPC
    // response without sending a separate idle notification.
    if (!this.idleEmitted) {
      if (this.fullContent.length > 0) {
        this.emit('assistant.message', { content: this.fullContent });
      }
      this.idleEmitted = true;
      this.emit('session.idle', {});
      this.fullContent = '';
      this.fullReasoning = '';
    }
  }

  async sendAndWait(options: { prompt: string }): Promise<{ data: { content: string } }> {
    return new Promise((resolve, reject) => {
      let content = '';
      let settled = false;

      const unsubscribe = this.on((event) => {
        if (settled) return;

        if (event.type === 'assistant.message_delta') {
          content += (event.data['deltaContent'] as string) ?? '';
        } else if (event.type === 'assistant.message') {
          content = (event.data['content'] as string) ?? content;
        } else if (event.type === 'session.idle') {
          settled = true;
          unsubscribe();
          resolve({ data: { content } });
        } else if (event.type === 'session.error') {
          settled = true;
          unsubscribe();
          reject(new Error((event.data['message'] as string) ?? 'Session error'));
        }
      });

      this.send(options).catch((err) => {
        if (!settled) {
          settled = true;
          unsubscribe();
          reject(err);
        }
      });
    });
  }

  async destroy(): Promise<void> {
    if (this.notificationDisposable) {
      this.notificationDisposable.dispose();
      this.notificationDisposable = null;
    }
    this.handlers.clear();
    if (this.config.onSessionEnd) {
      this.config.onSessionEnd({ reason: 'destroy' });
    }
  }

  abort(): void {
    try {
      void this.connection.sendNotification('session/cancel', {
        sessionId: this.sessionId,
      });
    } catch {
      // ignore — connection may be closed
    }
  }
}
