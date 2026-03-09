import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { resolve as pathResolve, normalize as pathNormalize } from 'path';
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
import { debug, isDebugEnabled, logProviderRequest } from '../../core/debug-logger.js';
import { fileLink } from '../../core/utils/terminal-link.js';
import { resolveCopilotClientConnectionOptions } from '../../providers/shared/copilot-client-options.js';
import { COPILOT_PROGRESS_EVENTS } from '../../providers/shared/copilot-events.js';
import type { PermissionRequest, PermissionRequestResult } from '@github/copilot-sdk';

interface CopilotShutdownStats {
  totalPremiumRequests: number;
  totalApiDurationMs: number;
}

export class CopilotWorker implements WorkerExecutor {
  private client: unknown = null;
  private session: unknown = null;
  /** Stored session ID for zero-cost resume via SDK's resumeSession() */
  private sessionId: string | null = null;
  /** Number of other-agent messages already injected into prior prompts */
  private otherAgentMessagesSeen = 0;

  /** Auto-approve budget: 0=ask, -1=unlimited, N=remaining count */
  private autoApproveBudget = 0;
  /** Pending approval resolvers keyed by approvalId */
  private readonly pendingApprovals = new Map<string, (r: ApprovalResponse) => void>();
  /** Counter for generating unique approval IDs within this worker */
  private approvalCounter = 0;
  /** Mutable ref to the current onStream callback (set per execute() call) */
  private currentOnStream: ((event: OrchestrationStreamEvent) => void) | undefined;
  /** Mutable ref to the current traceId (set per execute() call) */
  private currentTraceId: string | undefined;
  /** Mutable ref to reset the idle timeout (set per execute() call) */
  private resetIdleTimeout: (() => void) | undefined;

  /** Aggregated stats from SDK session.shutdown event */
  private shutdownStats: CopilotShutdownStats | null = null;
  /** Map toolCallId → {toolName, args} so completion events can reference the original args */
  private readonly toolCallArgs = new Map<
    string,
    { toolName: string; args: Record<string, unknown> }
  >();
  /** Pending user input request resolvers keyed by requestId */
  private readonly pendingInputRequests = new Map<string, (answer: string) => void>();
  private inputRequestCounter = 0;

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

    // Reset per-message state
    this.autoApproveBudget = 0;
    this.currentOnStream = onStream;
    this.currentTraceId = traceId;

    try {
      onStream({
        type: 'start',
        agentId: agentProfile.id,
        traceId,
        ...(context.orchestratorGuidance !== undefined && context.orchestratorGuidance.length > 0
          ? { guidance: context.orchestratorGuidance }
          : {}),
      });

      onStream({
        type: 'agent_activity',
        traceId,
        agentId: agentProfile.id,
        activity: 'Connecting to Copilot...',
        toolName: undefined,
        kind: 'progress',
      });
      const session = await this.getOrCreateSession(agentProfile);
      onStream({
        type: 'agent_activity',
        traceId,
        agentId: agentProfile.id,
        activity: 'Connected',
        toolName: undefined,
        kind: 'complete',
        result: 'ready',
      });

      // Build prompt with other models' responses
      // Copilot SDK only accepts a single prompt string, so we prepend
      // other agents' messages. User↔copilot history is tracked by the SDK session.
      // Merge same-turn responses into history so Copilot sees earlier agents' answers
      const fullHistory =
        context.sameTurnResponses !== undefined && context.sameTurnResponses.length > 0
          ? [...conversationHistory, ...context.sameTurnResponses]
          : conversationHistory;

      const prompt = this.buildPromptWithHistory(
        message,
        fullHistory,
        agentProfile.name,
        context.orchestratorGuidance
      );

      let fullContent = '';
      /** Authoritative text segments from assistant.message events (one per model turn). */
      const messageSegments: string[] = [];
      /** Surfaced tool output blocks injected between model turns. */
      let toolOutputBlocks = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      let premiumRequests = 0;
      let resolved = false;

      const result = await new Promise<string>((resolve, reject) => {
        // Cleanup helper — unsubscribes the streaming handler to prevent
        // stale handlers from accumulating across execute() calls on the
        // same reused session (which causes doubled/tripled tokens).
        let unsubscribeFn: (() => void) | undefined;
        const cleanup = (): void => {
          unsubscribeFn?.();
          unsubscribeFn = undefined;
        };

        // Idle timeout guard — only resets on content-producing SDK events
        // (deltas, tool starts/completions, messages) to prevent non-content
        // events (heartbeats, internal bookkeeping) from keeping it alive forever.
        // When waiting for user input, use a much longer timeout (5 minutes).
        const USER_INPUT_TIMEOUT = 5 * 60_000;
        // Absolute hard cap: no single execution can run longer than this,
        // regardless of event activity. Prevents infinite hangs.
        const HARD_CAP_TIMEOUT = 2 * 60_000;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const resetTimeout = (): void => {
          clearTimeout(timer);
          this.resetIdleTimeout = resetTimeout;
          const waitingForUser =
            this.pendingInputRequests.size > 0 || this.pendingApprovals.size > 0;
          const budget = waitingForUser ? USER_INPUT_TIMEOUT : context.timeoutBudget;
          timer = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              cleanup();
              reject(
                new OrchestrationError(
                  'TIMEOUT',
                  `Copilot worker ${agentProfile.id} idle for ${budget}ms with no activity`,
                  traceId
                )
              );
            }
          }, budget);
        };
        resetTimeout();

        // Absolute hard cap timer — never resets
        // Set a flag rather than immediately resolving, so we can still capture
        // messages that arrive after thinking completes but before session.idle
        const hardCapTimer = setTimeout(() => {
          if (!resolved) {
            clearTimeout(timer);
            // Don't resolve yet — wait for session.idle so we capture all messages.
            // This handles cases where thinking takes a while but messages follow.
            // Set a shorter timeout for the grace period after hard cap.
            timer = setTimeout(() => {
              if (!resolved) {
                resolved = true;
                cleanup();
                // Resolve with whatever content we have, or reject if empty
                if (fullContent.length > 0) {
                  resolve(fullContent);
                } else {
                  reject(
                    new OrchestrationError(
                      'TIMEOUT',
                      `Copilot worker ${agentProfile.id} hit absolute timeout (${HARD_CAP_TIMEOUT}ms)`,
                      traceId
                    )
                  );
                }
              }
            }, 5000); // Grace period: wait 5s after hard cap for session.idle
          }
        }, HARD_CAP_TIMEOUT);

        // Cancellation guard
        const token = context.cancellationToken;
        if (token !== undefined && typeof token.addEventListener === 'function') {
          if (token.aborted) {
            clearTimeout(timer);
            clearTimeout(hardCapTimer);
            resolved = true;
            cleanup();
            reject(
              new OrchestrationError(
                'CANCELLED',
                `Copilot worker ${agentProfile.id} was cancelled`,
                traceId
              )
            );
            return;
          }
          token.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              clearTimeout(hardCapTimer);
              // Best-effort: tell the SDK to stop running tools / model calls
              try {
                const abortFn = (session as Record<string, unknown>)['abort'];
                if (typeof abortFn === 'function') void (abortFn as () => Promise<void>).call(session);
              } catch { /* best-effort */ }
              if (!resolved) {
                resolved = true;
                cleanup();
                reject(
                  new OrchestrationError(
                    'CANCELLED',
                    `Copilot worker ${agentProfile.id} was cancelled`,
                    traceId
                  )
                );
              }
            },
            { once: true }
          );
        }

        // Subscribe to streaming events
        const typedSession = session as {
          on(handler: (event: { type: string; data: Record<string, unknown> }) => void): () => void;
          send(options: { prompt: string }): Promise<string>;
        };

        unsubscribeFn = typedSession.on(event => {
          if (resolved) return;

          // Only reset idle timeout on events that indicate real progress
          if (COPILOT_PROGRESS_EVENTS.has(event.type)) {
            resetTimeout();
          }

          // Skip subagent/tool-call events — only accumulate the main assistant response.
          // The SDK sets parentToolCallId on events produced by subagents.
          const isSubagent = event.data['parentToolCallId'] !== undefined &&
            event.data['parentToolCallId'] !== null;

          // Streaming delta — token by token
          if (event.type === 'assistant.message_delta' && !isSubagent) {
            const delta = event.data['deltaContent'] as string | undefined;
            if (delta !== undefined && delta.length > 0) {
              fullContent += delta;
              onStream({
                type: 'token',
                agentId: agentProfile.id,
                traceId,
                token: delta,
              });
            }
          }

          if (event.type === 'assistant.reasoning_delta' && !isSubagent) {
            const delta = event.data['deltaContent'] as string | undefined;
            if (delta !== undefined && delta.length > 0) {
              onStream({
                type: 'reasoning_delta',
                traceId,
                agentId: agentProfile.id,
                delta,
              });
            }
          }

          if (event.type === 'assistant.reasoning' && !isSubagent) {
            const content = event.data['content'] as string | undefined;
            if (content !== undefined && content.length > 0) {
              onStream({
                type: 'reasoning_complete',
                traceId,
                agentId: agentProfile.id,
                content,
              });
            }
          }

          if (event.type === 'assistant.message' && !isSubagent) {
            const content = event.data['content'] as string | undefined;
            if (content !== undefined && content.length > 0) {
              // The SDK fires assistant.message per model turn in agentic flows.
              // Accumulate segments so multi-turn content isn't lost, and use
              // the SDK's authoritative text (which corrects garbled deltas).
              messageSegments.push(content);
              fullContent = messageSegments.join('') + toolOutputBlocks;
            }
          }

          // Token usage — emitted by the SDK after each model response
          if (event.type === 'assistant.usage') {
            inputTokens = (event.data['inputTokens'] as number) ?? inputTokens;
            outputTokens = (event.data['outputTokens'] as number) ?? outputTokens;
            cacheReadTokens = (event.data['cacheReadTokens'] as number) ?? cacheReadTokens;
            cacheWriteTokens = (event.data['cacheWriteTokens'] as number) ?? cacheWriteTokens;
            premiumRequests += (event.data['cost'] as number) ?? 0;
            this.logger?.workerComplete(traceId, agentProfile.id, 0);
            debug('copilot-worker', 'sdk-usage', event.data);
          }

          // Session idle — response is done (unless waiting for user interaction)
          if (event.type === 'session.idle') {
            if (this.pendingInputRequests.size > 0 || this.pendingApprovals.size > 0) {
              // SDK went idle while waiting for user input or approval — don't resolve yet.
              // Reset timeout to give the user time to respond.
              resetTimeout();
            } else {
              clearTimeout(timer);
              clearTimeout(hardCapTimer);
              cleanup();
              if (!resolved) {
                resolved = true;
                resolve(fullContent);
              }
            }
          }

          // Tool execution start — emit agent_activity so the UI shows what the agent is doing
          if (event.type === 'tool.execution_start') {
            const toolName = (event.data['toolName'] as string) ?? 'unknown';
            // Skip internal bookkeeping tools that add noise to the activity log
            if (!CopilotWorker.HIDDEN_TOOLS.has(toolName)) {
              // SDK uses `arguments` as the primary key for tool args
              const toolArgs = CopilotWorker.parseToolArgs(
                event.data['arguments'] ?? event.data['args'] ?? event.data['parameters']
              );
              debug('copilot-worker', 'tool-start', { toolName, toolArgs });
              // Store args keyed by toolCallId so formatToolResult can reference them
              const callId = event.data['toolCallId'] as string | undefined;
              if (callId !== undefined && callId.length > 0) {
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

          // Tool execution progress — update activity with progress message
          if (event.type === 'tool.execution_progress') {
            const progressMessage = (event.data['progressMessage'] ?? event.data['message']) as
              | string
              | undefined;
            if (progressMessage !== undefined && progressMessage.length > 0) {
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

          // Tool execution partial result — stream intermediate output
          if (event.type === 'tool.execution_partial_result') {
            const partialOutput = event.data['partialOutput'] as string | undefined;
            if (partialOutput !== undefined && partialOutput.length > 0) {
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

          // Tool execution complete — emit result so the UI shows the outcome
          if (event.type === 'tool.execution_complete') {
            const callId = event.data['toolCallId'] as string | undefined;
            const stored =
              callId !== undefined && callId.length > 0 ? this.toolCallArgs.get(callId) : undefined;
            const toolName = stored?.toolName ?? (event.data['toolName'] as string) ?? 'unknown';
            if (callId !== undefined && callId.length > 0) this.toolCallArgs.delete(callId);

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

              // Handle binary results (images, audio) from tool execution
              const binaryResults = event.data['binaryResultsForLlm'] as
                | Array<{ data: string; mimeType: string }>
                | undefined;
              if (binaryResults !== undefined && binaryResults.length > 0) {
                for (const bin of binaryResults) {
                  if (typeof bin.data === 'string' && typeof bin.mimeType === 'string') {
                    debug('copilot-worker', 'tool-binary-result', {
                      toolName,
                      mimeType: bin.mimeType,
                      dataLength: bin.data.length,
                    });
                    // Emit as an image block if it's an image type
                    if (bin.mimeType.startsWith('image/')) {
                      const imgBlock = `\n\n![Tool output](data:${bin.mimeType};base64,${bin.data})\n\n`;
                      toolOutputBlocks += imgBlock;
                      fullContent += imgBlock;
                      onStream({
                        type: 'token',
                        agentId: agentProfile.id,
                        traceId,
                        token: imgBlock,
                      });
                    }
                  }
                }
              }

              // Surface substantial tool output as streamed content.
              // The model sees tool results in its context and may refer to them
              // (e.g. "Done — showing the diff") without repeating the content.
              // Without this the user never sees the actual output.
              const toolOutput = sdkResult?.detailedContent ?? sdkResult?.content;
              if (
                success !== false &&
                toolOutput !== undefined &&
                toolOutput.length > 200 &&
                CopilotWorker.SURFACE_OUTPUT_TOOLS.has(toolName)
              ) {
                const capped =
                  toolOutput.length > CopilotWorker.SURFACE_OUTPUT_MAX
                    ? toolOutput.slice(0, CopilotWorker.SURFACE_OUTPUT_MAX) + '\n... (truncated)'
                    : toolOutput;
                const lang = CopilotWorker.detectToolOutputLang(toolName, capped);
                const block = `\n\n\`\`\`${lang}\n${capped}\n\`\`\`\n\n`;
                toolOutputBlocks += block;
                fullContent += block;
                onStream({
                  type: 'token',
                  agentId: agentProfile.id,
                  traceId,
                  token: block,
                });
              }
            }
          }

          // Skill invocation events
          if (event.type === 'skill.invoked') {
            const skillName = (event.data['name'] ?? event.data['skillName'] ?? 'skill') as string;
            onStream({
              type: 'agent_activity',
              traceId,
              agentId: agentProfile.id,
              activity: `Using skill: ${skillName}`,
              toolName: undefined,
              kind: 'progress',
            });
          }

          // Subagent lifecycle events
          if (event.type === 'subagent.started') {
            const name = (event.data['name'] ?? event.data['agentName'] ?? 'subagent') as string;
            onStream({
              type: 'agent_activity',
              traceId,
              agentId: agentProfile.id,
              activity: `Subagent started: ${name}`,
              toolName: undefined,
              kind: 'start',
            });
          }

          if (event.type === 'subagent.completed') {
            const name = (event.data['name'] ?? event.data['agentName'] ?? 'subagent') as string;
            onStream({
              type: 'agent_activity',
              traceId,
              agentId: agentProfile.id,
              activity: `Subagent completed: ${name}`,
              toolName: undefined,
              kind: 'complete',
              result: 'done',
            });
          }

          if (event.type === 'subagent.failed') {
            const name = (event.data['name'] ?? event.data['agentName'] ?? 'subagent') as string;
            const errMsg = (event.data['error'] as string) ?? 'unknown error';
            onStream({
              type: 'agent_activity',
              traceId,
              agentId: agentProfile.id,
              activity: `Subagent failed: ${name} — ${errMsg}`,
              toolName: undefined,
              kind: 'complete',
              result: errMsg,
            });
          }

          // Session plan changed — emit as activity for observability
          if (event.type === 'session.plan_changed') {
            const plan = (event.data['plan'] ?? event.data['description']) as string | undefined;
            if (plan !== undefined && plan.length > 0) {
              onStream({
                type: 'agent_activity',
                traceId,
                agentId: agentProfile.id,
                activity: `Plan updated: ${plan.length > 80 ? plan.slice(0, 77) + '...' : plan}`,
                toolName: undefined,
                kind: 'progress',
              });
            }
          }

          // Workspace file changed — emit as activity
          if (event.type === 'session.workspace_file_changed') {
            const filePath = (event.data['path'] ?? event.data['filePath']) as string | undefined;
            const changeType = (event.data['changeType'] ?? event.data['type'] ?? 'changed') as string;
            if (filePath !== undefined && filePath.length > 0) {
              onStream({
                type: 'agent_activity',
                traceId,
                agentId: agentProfile.id,
                activity: `File ${changeType}: ${filePath}`,
                toolName: undefined,
                kind: 'progress',
              });
            }
          }

          // Error — if we already have content, treat as successful completion.
          // The Copilot SDK sometimes fires spurious errors like "missing finish_reason"
          // after the agent has already produced a full response.
          if (event.type === 'session.error') {
            clearTimeout(timer);
            clearTimeout(hardCapTimer);
            cleanup();
            if (!resolved) {
              resolved = true;
              const errMsg = (event.data['message'] as string) ?? 'Unknown Copilot error';
              if (fullContent.length > 0) {
                this.logger?.workerError(
                  traceId,
                  agentProfile.id,
                  `Non-fatal session.error (content preserved): ${errMsg}`
                );
                onStream({
                  type: 'agent_activity',
                  traceId,
                  agentId: agentProfile.id,
                  activity: `Warning: session error suppressed (response preserved): ${errMsg}`,
                  toolName: undefined,
                  kind: 'progress',
                });
                resolve(fullContent);
              } else {
                reject(
                  new OrchestrationError('WORKER_EXECUTION', `Copilot error: ${errMsg}`, traceId)
                );
              }
            }
          }
        });

        // Debug: log prompt size before sending to help diagnose inflated token counts
        if (isDebugEnabled()) {
          const systemContent = agentProfile.instructions.join('\n');
          debug('copilot-worker', 'send-payload', {
            agentId: agentProfile.id,
            promptLength: prompt.length,
            promptTokensEstimate: Math.ceil(prompt.length / 4),
            systemMessageLength: systemContent.length,
            attachmentCount: context.attachments?.length ?? 0,
            otherAgentMessagesSeen: this.otherAgentMessagesSeen,
          });
        }

        const sendPayload: Record<string, unknown> = { prompt };
        if (context.attachments && context.attachments.length > 0) {
          // Copilot SDK accepts file paths only — convert image attachments
          // (which carry base64 data) back to file-type using their original path.
          const sdkAttachments = context.attachments
            .map(a => {
              if (a.type === 'image') {
                // Image attachments carry an optional path from the server upload.
                // If present, pass as a file attachment so the SDK reads the image.
                if ('path' in a && a.path !== undefined && a.path.length > 0) {
                  return {
                    type: 'file' as const,
                    path: a.path,
                    ...(a.displayName !== undefined ? { displayName: a.displayName } : {}),
                  };
                }
                return null; // No path — skip (base64-only, can't send to SDK)
              }
              if (a.type === 'selection') {
                return {
                  type: a.type,
                  filePath: a.filePath,
                  selection: a.selection,
                  ...(a.text !== undefined ? { text: a.text } : {}),
                  ...(a.displayName !== undefined ? { displayName: a.displayName } : {}),
                };
              }
              return {
                type: a.type,
                path: a.path,
                ...(a.displayName !== undefined ? { displayName: a.displayName } : {}),
              };
            })
            .filter(a => a !== null);
          if (sdkAttachments.length > 0) {
            sendPayload['attachments'] = sdkAttachments;
          }
        }

        // send() returns immediately with a message ID — the actual response
        // arrives via events (message_delta, message, session.idle). We must NOT
        // race a grace period against the response; rely on session.idle + idle
        // timeout + hard cap for completion.
        (typedSession.send(sendPayload as { prompt: string }) as Promise<string>).then(
          () => {
            // send() acknowledged — the SDK is now processing the prompt.
            // Do NOT start a grace period here: send() resolves immediately
            // (per SDK docs: "returns immediately after queuing the message"),
            // so a short timer would race against the actual model response.
            //
            // Completion is signaled by:
            //   1. session.idle event (primary, handled in event subscriber above)
            //   2. Idle timeout (no progress events for timeoutBudget ms)
            //   3. Hard cap timeout (absolute 2-minute limit)
            //
            // If waiting for user input or approval, just reset the idle timeout
            // so the user has time to respond.
            if (this.pendingInputRequests.size > 0 || this.pendingApprovals.size > 0) {
              resetTimeout();
            }
          },
          (err: unknown) => {
            clearTimeout(timer);
            clearTimeout(hardCapTimer);
            cleanup();
            if (!resolved) {
              resolved = true;
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          }
        );
      });

      fullContent = result;

      const endTime = new Date();
      const latencyMs = Date.now() - startTime;
      this.logger?.workerComplete(traceId, agentProfile.id, latencyMs);

      // Debug: dump full context window to per-model .md file
      if (isDebugEnabled()) {
        const systemContent = agentProfile.instructions.join('\n');
        logProviderRequest('copilot', {
          requestId: `${traceId}-${agentProfile.id}`,
          model: agentProfile.model ?? 'gpt-4o',
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: prompt },
          ],
          response: fullContent,
          startTime: new Date(startTime),
          endTime,
          usage: {
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            totalTokens: inputTokens + outputTokens,
            ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
            ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
          },
          metadata: {
            agentId: agentProfile.id,
            agentName: agentProfile.name,
            premiumRequests,
            note: 'Copilot SDK manages its own history; only the new prompt is shown here.',
          },
        });
      }

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
        // Copilot is subscription-based — no per-request USD cost.
        // The SDK's `cost` field is the premium request count, not dollars.
        estimatedCostUSD: 0,
      });

      return {
        agentId: agentProfile.id,
        agentName: agentProfile.name,
        content: fullContent,
        toolInvocations: [],
        ...(tokenUsage ? { tokenUsage } : {}),
        estimatedCostUSD: 0,
      };
    } catch (err) {
      // Clear any pending approvals on failure
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
      this.toolCallArgs.clear();
      this.pendingInputRequests.clear();
      this.toolStartTimes.clear();
    }
  }

  async initializeMCP(_agentProfile: AgentProfile): Promise<MCPInitResult> {
    return {
      serverId: 'copilot-native',
      status: 'connected',
      toolCount: 0,
    };
  }

  /**
   * Check whether the Copilot client connection is healthy.
   * Returns 'connected', 'disconnected', or 'unknown'.
   */
  async getConnectionHealth(): Promise<'connected' | 'disconnected' | 'unknown'> {
    if (this.client === null || this.client === undefined) return 'disconnected';
    try {
      const getState = (this.client as Record<string, unknown>)['getState'] as
        | (() => unknown)
        | undefined;
      if (getState) {
        const state = getState.call(this.client);
        if (state === 'connected' || state === 'running') return 'connected';
        if (state === 'disconnected' || state === 'stopped') return 'disconnected';
      }
      const ping = (this.client as Record<string, unknown>)['ping'] as
        | (() => Promise<void>)
        | undefined;
      if (ping) {
        await ping.call(this.client);
        return 'connected';
      }
      return 'unknown';
    } catch {
      return 'disconnected';
    }
  }

  /**
   * Get the stored Copilot session ID for persistence across restarts.
   * Returns null if no session has been created yet.
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Set a previously stored session ID for resumption on next execute().
   */
  setSessionId(id: string): void {
    this.sessionId = id;
  }

  /**
   * Get aggregated stats from the SDK's session.shutdown event.
   * Returns null if no shutdown event has been received yet.
   */
  getShutdownStats(): CopilotShutdownStats | null {
    return this.shutdownStats;
  }

  async dispose(): Promise<void> {
    if (this.session !== null && this.session !== undefined) {
      try {
        await (this.session as { destroy(): Promise<void> }).destroy();
      } catch (error) {
        debug('copilot-worker', 'session-destroy-failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.session = null;
    }
    if (this.client !== null && this.client !== undefined) {
      try {
        // SDK exposes stop() to tear down the CLI subprocess
        const stopFn = (this.client as Record<string, unknown>)['stop'] as
          | (() => Promise<void>)
          | undefined;
        const closeFn = (this.client as Record<string, unknown>)['close'] as
          | (() => Promise<void>)
          | undefined;
        await (stopFn ?? closeFn)?.call(this.client);
      } catch (error) {
        debug('copilot-worker', 'client-stop-failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.client = null;
    }
  }

  /**
   * Resolve a pending approval request from the CLI.
   */
  resolveApproval(approvalId: string, response: ApprovalResponse): void {
    const resolver = this.pendingApprovals.get(approvalId);
    if (!resolver) return;
    this.pendingApprovals.delete(approvalId);

    // User responded — reset idle timeout so the SDK has a fresh window
    this.resetIdleTimeout?.();

    // Update auto-approve budget based on response.
    // The current approval is already resolved — budget represents how many
    // *future* requests to auto-approve (1 = allow the next one too, -1 = unlimited).
    if (response.approved) {
      this.autoApproveBudget = response.budget === -1 ? -1 : Math.max(0, response.budget);
    }

    resolver(response);
  }

  resolveInputRequest(requestId: string, answer: string): void {
    debug('copilot-worker', 'resolve-input-request', {
      requestId,
      answerLength: answer?.length,
      answerPreview: answer?.slice(0, 80),
      hasPending: this.pendingInputRequests.has(requestId),
      pendingKeys: [...this.pendingInputRequests.keys()],
    });

    const resolver = this.pendingInputRequests.get(requestId);
    if (!resolver) {
      debug('copilot-worker', 'resolve-input-request-NOT-FOUND', {
        requestId,
        pendingKeys: [...this.pendingInputRequests.keys()],
      });
      return;
    }
    this.pendingInputRequests.delete(requestId);
    this.resetIdleTimeout?.();

    // Emit activity so the UI shows a thinking indicator while the SDK processes the answer
    const match = /^(.+)-input-\d+$/.exec(requestId);
    if (match?.[1] !== undefined && this.currentOnStream) {
      this.currentOnStream({
        type: 'agent_activity',
        traceId: this.currentTraceId ?? '',
        agentId: match[1],
        activity: 'Processing response…',
        toolName: undefined,
        kind: 'start',
      });
    }

    resolver(answer);
  }

  /**
   * Clear all pending approvals (e.g. on timeout/error).
   * Resolves them as denied so the SDK doesn't hang.
   */
  private clearPendingApprovals(): void {
    for (const [, resolver] of this.pendingApprovals) {
      resolver({ approved: false, budget: 0 });
    }
    this.pendingApprovals.clear();
  }

  /** Track tool start times keyed by toolName for duration measurement. */
  private readonly toolStartTimes = new Map<string, number>();

  private registerHooks(sessionConfig: Record<string, unknown>, agentProfile: AgentProfile): void {
    // SDK v0.1.28+ expects hooks under the `hooks` property
    const hooks: Record<string, unknown> = {};
    sessionConfig['hooks'] = hooks;

    hooks['onSessionStart'] = (input: Record<string, unknown>): void => {
      const source = (input['source'] as string) ?? 'startup';
      debug('copilot-worker', 'hook-session-start', { agentId: agentProfile.id, source });
    };

    hooks['onSessionEnd'] = (input: Record<string, unknown>): void => {
      const reason = (input['reason'] as string) ?? 'complete';
      const summary = input['sessionSummary'] as string | undefined;
      debug('copilot-worker', 'hook-session-end', { agentId: agentProfile.id, reason, summary });

      // Surface session end stats as activity
      if (reason !== 'complete' && this.currentOnStream) {
        this.currentOnStream({
          type: 'agent_activity',
          traceId: this.currentTraceId ?? '',
          agentId: agentProfile.id,
          activity: `Session ended: ${reason}`,
          toolName: undefined,
          kind: 'complete',
          result: summary ?? reason,
        });
      }
    };

    hooks['onPreToolUse'] = (input: Record<string, unknown>): void => {
      const toolName = (input['toolName'] as string) ?? 'unknown';
      debug('copilot-worker', 'hook-pre-tool', { agentId: agentProfile.id, toolName });
      this.toolStartTimes.set(toolName, Date.now());
    };

    hooks['onPostToolUse'] = (input: Record<string, unknown>): void => {
      const toolName = (input['toolName'] as string) ?? 'unknown';
      const startTime = this.toolStartTimes.get(toolName);
      const durationMs = startTime !== undefined ? Date.now() - startTime : undefined;
      this.toolStartTimes.delete(toolName);
      debug('copilot-worker', 'hook-post-tool', { agentId: agentProfile.id, toolName, durationMs });
    };

    hooks['onErrorOccurred'] = (input: Record<string, unknown>): void => {
      const message = (input['error'] as string) ?? (input['message'] as string) ?? 'Unknown error';
      const context = (input['errorContext'] as string) ?? 'system';
      const recoverable = (input['recoverable'] as boolean) ?? false;
      debug('copilot-worker', 'hook-error', {
        agentId: agentProfile.id,
        message,
        context,
        recoverable,
      });
      this.logger?.workerError(
        this.currentTraceId ?? '',
        agentProfile.id,
        `SDK hook error (${context}): ${message}`
      );

      // Surface non-recoverable errors as activity warnings
      if (!recoverable && this.currentOnStream) {
        this.currentOnStream({
          type: 'agent_activity',
          traceId: this.currentTraceId ?? '',
          agentId: agentProfile.id,
          activity: `Warning: ${message}`,
          toolName: undefined,
          kind: 'progress',
        });
      }
    };
  }

  private registerInputRequestHandler(
    sessionConfig: Record<string, unknown>,
    agentProfile: AgentProfile
  ): void {
    sessionConfig['onUserInputRequest'] = (request: Record<string, unknown>): Promise<unknown> => {
      const requestId = `${agentProfile.id}-input-${++this.inputRequestCounter}`;
      const onStream = this.currentOnStream;
      const traceId = this.currentTraceId ?? '';

      // Log the full request to discover SDK's actual property names
      debug('copilot-worker', 'user-input-request', {
        agentId: agentProfile.id,
        requestId,
        requestKeys: Object.keys(request),
        request,
        hasOnStream: onStream !== undefined,
      });

      // Extract prompt — SDK may use different property names
      const prompt = (request['prompt'] ?? request['message'] ?? request['question'] ?? '') as string;

      // Check if SDK provides options (selection-style input)
      const options = request['options'] as string[] | undefined;

      if (!onStream) {
        debug('copilot-worker', 'user-input-request-no-stream', { requestId });
        return Promise.resolve({ selection: '' });
      }

      onStream({
        type: 'user_input_request',
        traceId,
        agentId: agentProfile.id,
        requestId,
        prompt: prompt || (options ? `Select: ${options.join(', ')}` : '(input requested)'),
      });

      return new Promise<unknown>(resolve => {
        this.pendingInputRequests.set(requestId, (answer: string) => {
          // Return both formats — the SDK will use whichever it expects
          debug('copilot-worker', 'resolving-input-promise', {
            requestId,
            answer,
            responseFormat: { selection: answer, value: answer, result: answer },
          });
          resolve({ selection: answer, value: answer, result: answer, answer });
        });
      });
    };
  }

  /**
   * Map SDK permission kind string to our PermissionKind type.
   */
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
      case 'ask_user':
      case 'ask-user':
      case 'user-input':
        return 'read';
      case 'mcp':
        return 'mcp';
      case 'url':
      case 'fetch':
        return 'url';
      default:
        return 'write'; // conservative default
    }
  }

  /**
   * Known read-only shell command prefixes (PowerShell + Unix).
   * If a shell command starts with one of these, it's safe to auto-approve.
   */
  private static readonly READ_ONLY_SHELL_COMMANDS = new Set([
    // PowerShell
    'get-childitem', 'get-content', 'test-path', 'get-item',
    'get-itemproperty', 'get-location', 'select-object', 'where-object',
    'format-list', 'format-table', 'measure-object', 'out-string',
    'select-string', 'resolve-path',
    // Unix/bash
    'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'wc',
    'file', 'stat', 'du', 'df', 'pwd', 'which', 'type',
    'readlink', 'realpath', 'tree', 'test',
  ]);

  /** Operators that chain/pipe commands — reject if present. */
  private static readonly SHELL_CHAIN_PATTERN = /[|;&]|&&|\|\|/;

  /**
   * Check if a shell command is read-only based on known safe commands.
   * Rejects piped/chained commands and redirections.
   */
  private static isReadOnlyShellCommand(fullCommandText: string): boolean {
    const trimmed = fullCommandText.trim().toLowerCase();
    // Reject piped, chained, or redirected commands
    if (CopilotWorker.SHELL_CHAIN_PATTERN.test(trimmed) || trimmed.includes('>')) {
      return false;
    }
    const firstToken = trimmed.split(/[\s"]/)[0] ?? '';
    return CopilotWorker.READ_ONLY_SHELL_COMMANDS.has(firstToken);
  }

  /** Normalized system temp directory (stable for process lifetime). */
  private static readonly TEMP_ROOT = pathNormalize(tmpdir()).toLowerCase();

  /** Normalized path separator for prefix matching. */
  private static readonly NORM_SEP = pathNormalize('/');

  /** Tools that are internal bookkeeping — suppress from the activity log. */
  private static readonly HIDDEN_TOOLS = new Set(['report_intent']);

  /** Tools whose stdout/content should be surfaced as streamed content blocks. */
  private static readonly SURFACE_OUTPUT_TOOLS = new Set([
    'shell',
    'powershell',
    'bash',
    'terminal',
    'run_command',
  ]);

  /** Max characters to surface from tool output (prevents flooding the chat). */
  private static readonly SURFACE_OUTPUT_MAX = 20_000;

  /** Detect the best language tag for a tool output code block. */
  private static detectToolOutputLang(_toolName: string, output: string): string {
    if (output.startsWith('diff --git') || output.startsWith('--- ') || /^@@\s/.test(output)) {
      return 'diff';
    }
    return '';
  }

  private static formatToolActivity(toolName: string, args: Record<string, unknown>): string {
    const pathArg = CopilotWorker.extractPathArg(args);
    const basename = pathArg !== undefined ? (pathArg.split(/[/\\]/).pop() ?? pathArg) : undefined;
    const displayName =
      basename !== undefined && pathArg !== undefined ? fileLink(basename, pathArg) : basename;

    switch (toolName) {
      case 'read_file':
      case 'view':
      case 'cat':
        return displayName !== undefined ? `Read ${displayName}` : 'Reading file';
      case 'edit_file':
      case 'replace':
      case 'patch':
        return displayName !== undefined ? `Editing ${displayName}` : 'Editing file';
      case 'create_file':
      case 'write_file':
        return displayName !== undefined ? `Creating ${displayName}` : 'Creating file';
      case 'delete_file':
      case 'remove':
        return displayName !== undefined ? `Deleting ${displayName}` : 'Deleting file';
      case 'shell':
      case 'powershell':
      case 'bash':
      case 'terminal':
      case 'run_command': {
        const cmd = (args['command'] ?? args['cmd'] ?? args['script']) as string | undefined;
        if (cmd === undefined || cmd.length === 0) return 'Running command';
        const trimmed = cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
        return `Running: ${trimmed}`;
      }
      case 'stop_powershell':
      case 'stop_shell':
      case 'stop_bash':
        return 'Stopping command';
      case 'list_directory':
      case 'ls':
        return displayName !== undefined ? `Listing ${displayName}` : 'Listing directory';
      case 'glob':
      case 'find_files':
      case 'find': {
        const pattern = (args['pattern'] ?? args['glob'] ?? args['include']) as string | undefined;
        return pattern !== undefined && pattern.length > 0
          ? `Searching for ${pattern}`
          : 'Searching for files';
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
        return query !== undefined && query.length > 0 ? `Searching: ${query}` : 'Searching files';
      }
      case 'web_search':
      case 'bing_search': {
        const q = (args['query'] ?? args['q']) as string | undefined;
        return q !== undefined && q.length > 0 ? `Searching web: ${q}` : 'Searching the web';
      }
      case 'web_fetch':
      case 'fetch_url': {
        const url = (args['url'] ?? args['href']) as string | undefined;
        return url !== undefined && url.length > 0 ? `Fetching ${url}` : 'Fetching URL';
      }
      case 'think':
      case 'plan':
        return 'Thinking';
      default: {
        // Try to extract a useful detail from args for context
        const detail = CopilotWorker.extractArgDetail(args);
        const readable = toolName.replace(/[_-]/g, ' ');
        const label = readable.charAt(0).toUpperCase() + readable.slice(1);
        return detail !== undefined ? `${label}: ${detail}` : label;
      }
    }
  }

  /**
   * Extract a file path from tool args, trying common key names first,
   * then falling back to any string value that looks like a file path.
   */
  private static extractPathArg(args: Record<string, unknown>): string | undefined {
    // Try well-known key names first (camelCase + snake_case + short names)
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
      // eslint-disable-next-line security/detect-object-injection -- key from known constant array
      const val = args[key];
      if (typeof val === 'string' && val.length > 0) return val;
    }
    // Fallback: scan all values for something that looks like a file path
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

  /** Extract the most useful arg value for display in the default case. */
  private static extractArgDetail(args: Record<string, unknown>): string | undefined {
    // Try common arg names in priority order
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
      // eslint-disable-next-line security/detect-object-injection -- key from known constant array
      const val = args[key];
      if (typeof val === 'string' && val.length > 0) {
        return val.length > 60 ? val.slice(0, 57) + '...' : val;
      }
    }
    return undefined;
  }

  /**
   * Parse raw SDK arguments into a Record<string, unknown>.
   * Handles: undefined, string, object, array, and nested wrappers.
   */
  private static parseToolArgs(raw: unknown): Record<string, unknown> {
    if (raw === null || raw === undefined) return {};
    if (typeof raw === 'string') {
      // Some tools pass a JSON string
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return { path: raw };
      }
    }
    if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
    return {};
  }

  /**
   * Format a tool completion result into a human-readable result string.
   * Uses the structured SDK result ({content, detailedContent}) and the
   * original tool args for context.
   */
  private static formatToolResult(
    toolName: string,
    success: boolean | undefined,
    sdkResult: { content?: string; detailedContent?: string } | undefined,
    sdkError: { message?: string; code?: string } | undefined,
    originalArgs?: Record<string, unknown> | undefined
  ): string {
    // Error case
    if (success === false && sdkError?.message !== undefined && sdkError.message.length > 0) {
      const msg = sdkError.message;
      return msg.length > 100 ? msg.slice(0, 97) + '...' : msg;
    }

    const content = sdkResult?.content ?? '';

    switch (toolName) {
      case 'read_file':
      case 'view':
      case 'cat': {
        // Try to count lines from content
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
        // Extract exit code or short summary from content
        if (content) {
          const lines = content.trim().split('\n');
          const lastLine = lines[lines.length - 1] ?? '';
          // Check for exit code pattern
          const exitMatch = /exit\s*code\s*[=:]?\s*(\d+)/i.exec(content);
          if (exitMatch) return `exit code ${exitMatch[1]}`;
          // Show last line if short enough
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
        const query =
          originalArgs !== undefined
            ? ((originalArgs['query'] ?? originalArgs['q']) as string | undefined)
            : undefined;
        if (content.length > 0) {
          const results = content.trim().split('\n').filter(Boolean).length;
          return query !== undefined && query.length > 0
            ? `${results} results for "${query}"`
            : `${results} results`;
        }
        return 'done';
      }
      default: {
        // Use content summary if available
        if (content && content.length > 0) {
          const trimmed = content.trim();
          if (trimmed.length <= 80) return trimmed;
          return trimmed.slice(0, 77) + '...';
        }
        return 'done';
      }
    }
  }

  /**
   * Prepend only NEW other-model responses to the prompt.
   *
   * The Copilot SDK session tracks user↔copilot exchanges internally,
   * and also retains prior prompts (which already included other models'
   * responses from earlier turns). So we only inject messages the SDK
   * hasn't seen yet — i.e. other agents' responses since the last call.
   */
  private buildPromptWithHistory(
    message: string,
    history: ReadonlyArray<{ role: string; content: string; name?: string | undefined }>,
    myName: string,
    orchestratorGuidance?: string | undefined
  ): string {
    // Filter to only other agents' responses
    const otherAgentMessages = history.filter(m => m.role === 'assistant' && m.name !== myName);

    // Only include messages beyond what we've already injected
    const newMessages = otherAgentMessages.slice(this.otherAgentMessagesSeen);
    this.otherAgentMessagesSeen = otherAgentMessages.length;

    // Build the prompt with optional orchestrator guidance prefix
    const guidancePrefix =
      orchestratorGuidance !== undefined && orchestratorGuidance.length > 0
        ? `[Orchestrator Instructions]\n${orchestratorGuidance}\n\n`
        : '';

    if (newMessages.length === 0) return `${guidancePrefix}${message}`;

    const lines = newMessages.map(m => {
      const sender = m.name ?? 'Another model';
      return `[${sender}]: ${m.content}`;
    });

    return `${guidancePrefix}Other models said:\n${lines.join('\n')}\n\nUser: ${message}`;
  }

  /** Race a promise against a timeout, rejecting with a descriptive error */
  private static async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new OrchestrationError('TIMEOUT', `${label} timed out after ${ms}ms`)),
            ms
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async getOrCreateSession(agentProfile: AgentProfile): Promise<unknown> {
    if (this.session !== null && this.session !== undefined) return this.session;

    // On Windows, check for PowerShell 6+ (pwsh) before starting the SDK
    if (process.platform === 'win32') {
      try {
        execFileSync('pwsh.exe', ['--version'], { stdio: 'pipe', timeout: 5000 });
      } catch {
        throw new OrchestrationError(
          'WORKER_EXECUTION',
          'GitHub Copilot SDK requires PowerShell 6+ (pwsh) on Windows, but it was not found. ' +
            'Install it with: winget install Microsoft.PowerShell — then restart your terminal.'
        );
      }
    }

    const copilotSdk = await import('@github/copilot-sdk');
    const CopilotClient =
      (copilotSdk as Record<string, unknown>)['CopilotClient'] ??
      (copilotSdk as Record<string, unknown>)['default'];

    if (CopilotClient === null || CopilotClient === undefined) {
      throw new OrchestrationError(
        'WORKER_EXECUTION',
        'Failed to import CopilotClient from @github/copilot-sdk'
      );
    }

    // Pass cwd at client level — this is where the SDK's CLI process runs,
    // and determines where built-in tools (file_editor, shell, etc.) operate.
    const workingDir = agentProfile.allowedPaths?.[0];
    const connectionOptions = resolveCopilotClientConnectionOptions(process.env, message => {
      debug('copilot-worker', 'copilot-client-options-warning', { message });
    });
    const clientOptions: Record<string, unknown> = {
      clientName: 'cebus',
      ...connectionOptions,
    };

    const hasCliServerUrl =
      typeof connectionOptions['cliUrl'] === 'string' &&
      (connectionOptions['cliUrl'] as string).length > 0;

    if (!hasCliServerUrl) {
      if (workingDir !== undefined && workingDir.length > 0) {
        clientOptions['cwd'] = workingDir;
      }
      // Build a clean environment for the CLI subprocess.
      // CRITICAL: Do NOT inherit NODE_OPTIONS from the parent — it often contains
      // debug/inspect flags (especially in VS Code extension host or tsx dev mode)
      // that cause the CLI subprocess to hang on startup.
      const cleanEnv = { ...process.env };
      cleanEnv['NODE_OPTIONS'] = '--no-warnings';
      delete cleanEnv['NODE_INSPECT'];
      delete cleanEnv['NODE_INSPECT_RESUME_ON_START'];
      if (process.platform === 'win32') {
        cleanEnv['SHELL'] = 'pwsh.exe';
      }
      clientOptions['env'] = cleanEnv;
    }

    this.client = new (CopilotClient as new (
      opts?: Record<string, unknown>
    ) => Record<string, unknown>)(clientOptions);

    // Start the client — required before createSession (initializes CLI connection)
    const startFn = (this.client as Record<string, unknown>)['start'] as
      | (() => Promise<void>)
      | undefined;
    if (startFn) {
      await CopilotWorker.withTimeout(
        startFn.call(this.client),
        50_000,
        'Copilot CLI client.start()'
      );
    }

    const systemContent = agentProfile.instructions.join('\n');

    // Determine if tools are enabled (Yes mode) or disabled (No mode)
    const toolsEnabled =
      agentProfile.availableTools === undefined || agentProfile.availableTools.length > 0;

    const sessionConfig: Record<string, unknown> = {
      model: agentProfile.model ?? 'gpt-4o',
      systemMessage: { mode: 'append', content: systemContent },
      streaming: true,
      infiniteSessions: { enabled: true },
    };

    // Set working directory at session level — tells the CLI's built-in tools
    // (file_editor, shell, etc.) where to operate.
    if (workingDir !== undefined && workingDir.length > 0) {
      sessionConfig['workingDirectory'] = workingDir;
    }

    // Permission handler — async, awaited by the SDK.
    // The SDK's session._handlePermissionRequest() does `await this.permissionHandler(...)`,
    // so returning a Promise pauses tool execution until the user responds.
    //
    // Path enforcement → deny operations outside allowedPaths without prompting;
    // read (within allowed) → auto-approve; No mode → always deny;
    // Yes mode → check budget, if exhausted emit approval_required + wait for user.
    const allowedRoots = (agentProfile.allowedPaths ?? [])
      .map(p => pathNormalize(p).toLowerCase());

    sessionConfig['onPermissionRequest'] = (request: PermissionRequest): Promise<PermissionRequestResult> | PermissionRequestResult => {
      debug('copilot-worker', 'permission-request', request);

      const permKind = CopilotWorker.mapPermissionKind(request.kind);

      // No mode (tools disabled) — always deny
      if (!toolsEnabled) {
        return { kind: 'denied-by-rules', rules: [] };
      }

      // Path enforcement — deny operations outside the allowed directory tree.
      // This mirrors CLI behavior: refuse immediately, no permission prompt.
      // Checks both explicit path fields AND paths embedded in shell command strings.
      // For read/shell operations, also allow the system temp directory (SDK uses it
      // for inter-agent communication via the `task` tool).
      if (allowedRoots.length > 0) {
        const isPathAllowed = (p: string): boolean => {
          const resolved = pathNormalize(
            pathResolve(workingDir ?? '.', p)
          ).toLowerCase();
          if (allowedRoots.some(
            root => resolved === root || resolved.startsWith(root + CopilotWorker.NORM_SEP)
          )) return true;
          if (permKind === 'read' || permKind === 'shell') {
            if (resolved === CopilotWorker.TEMP_ROOT || resolved.startsWith(CopilotWorker.TEMP_ROOT + CopilotWorker.NORM_SEP)) {
              return true;
            }
          }
          return false;
        };

        // 1. Check explicit path fields (file-write, create-directory, etc.)
        const requestPath = CopilotWorker.extractPathArg(request as Record<string, unknown>);
        if (requestPath !== undefined && requestPath.length > 0 && !isPathAllowed(requestPath)) {
          debug('copilot-worker', 'path-outside-allowed', { requestPath, allowedRoots });
          return { kind: 'denied-by-rules', rules: [] };
        }

        // 2. Scan all string values in the request for absolute paths.
        // SDK sends paths in various keys: fullCommandText, command, input,
        // commands[].identifier, intention, etc. — check them all.
        const stringsToScan: string[] = [];
        for (const val of Object.values(request)) {
          if (typeof val === 'string' && val.length > 0) stringsToScan.push(val);
          if (Array.isArray(val)) {
            for (const item of val) {
              if (typeof item === 'string' && item.length > 0) stringsToScan.push(item);
              if (typeof item === 'object' && item !== null) {
                for (const v of Object.values(item as Record<string, unknown>)) {
                  if (typeof v === 'string' && v.length > 0) stringsToScan.push(v);
                }
              }
            }
          }
        }
        // Match Windows (C:\...) and Unix (/...) absolute paths in all string values
        const absPathRegex = /(?:[A-Za-z]:[/\\][^\s"'|&;,]+|\/(?:usr|home|tmp|var|etc|opt|mnt)[^\s"'|&;,]*)/g;
        for (const str of stringsToScan) {
          let match: RegExpExecArray | null;
          absPathRegex.lastIndex = 0;
          while ((match = absPathRegex.exec(str)) !== null) {
            if (!isPathAllowed(match[0])) {
              debug('copilot-worker', 'path-outside-allowed', {
                source: str,
                matchedPath: match[0],
                allowedRoots,
              });
              return { kind: 'denied-by-rules', rules: [] };
            }
          }
        }
      }

      // Read operations within allowed paths — auto-approve
      if (permKind === 'read') {
        return { kind: 'approved' };
      }

      // Read-only shell commands within allowed paths — auto-approve.
      // The SDK marks commands like Get-ChildItem, Test-Path, Get-Content as kind:"shell"
      // even though they only read. Detect these and treat them as reads.
      if (permKind === 'shell') {
        const cmdText = (request as Record<string, unknown>).fullCommandText;
        if (typeof cmdText === 'string' && CopilotWorker.isReadOnlyShellCommand(cmdText)) {
          debug('copilot-worker', 'shell-auto-approve-readonly', { command: cmdText });
          return { kind: 'approved' };
        }
      }

      // Check auto-approve budget
      if (this.autoApproveBudget !== 0) {
        if (this.autoApproveBudget > 0) {
          this.autoApproveBudget--;
        }
        // -1 (unlimited) stays as-is
        return { kind: 'approved' };
      }

      // Budget exhausted — emit approval_required and wait for user response
      const approvalId = `${agentProfile.id}-perm-${++this.approvalCounter}`;
      const onStream = this.currentOnStream;
      const traceId = this.currentTraceId ?? '';

      if (!onStream) {
        // No stream callback (non-interactive mode) — deny by default for safety
        return { kind: 'denied-by-rules', rules: [] };
      }

      const parameters: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(request)) {
        if (key !== 'kind') {
          // eslint-disable-next-line security/detect-object-injection -- key from Object.entries iteration
          parameters[key] = value;
        }
      }

      onStream({
        type: 'approval_required',
        traceId,
        agentId: agentProfile.id,
        toolName: (request.toolName as string | undefined) ?? request.kind,
        parameters,
        approvalId,
        permissionKind: permKind,
      });

      return new Promise<PermissionRequestResult>(resolve => {
        this.pendingApprovals.set(approvalId, (response: ApprovalResponse) => {
          if (response.approved) {
            resolve({ kind: 'approved' });
          } else {
            resolve({ kind: 'denied-interactively-by-user' });
          }
        });
      });
    };

    if (agentProfile.reasoningEffort) {
      sessionConfig['reasoningEffort'] = agentProfile.reasoningEffort;
    }

    if (agentProfile.provider?.byok) {
      sessionConfig['provider'] = {
        type: agentProfile.provider.byok.providerType,
        baseUrl: agentProfile.provider.byok.baseUrl,
        apiKey: agentProfile.provider.byok.apiKey,
      };
    }

    if (agentProfile.customAgents && agentProfile.customAgents.length > 0) {
      sessionConfig['customAgents'] = agentProfile.customAgents;
    }

    if (agentProfile.skillDirectories && agentProfile.skillDirectories.length > 0) {
      sessionConfig['skillDirectories'] = agentProfile.skillDirectories;
    }

    if (agentProfile.disabledSkills && agentProfile.disabledSkills.length > 0) {
      sessionConfig['disabledSkills'] = agentProfile.disabledSkills;
    }

    this.registerHooks(sessionConfig, agentProfile);
    this.registerInputRequestHandler(sessionConfig, agentProfile);

    if (toolsEnabled && agentProfile.availableTools !== undefined) {
      sessionConfig['availableTools'] = agentProfile.availableTools;
    }

    if (toolsEnabled && agentProfile.allowedPaths !== undefined) {
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

    // Try to resume an existing session (zero token cost — server-side state).
    // Pass the full sessionConfig so workingDirectory and other settings are updated.
    if (this.sessionId !== null) {
      try {
        const resumeSession = (this.client as Record<string, unknown>)['resumeSession'] as
          | ((sessionId: string, config: Record<string, unknown>) => Promise<unknown>)
          | undefined;
        if (resumeSession) {
          this.session = await CopilotWorker.withTimeout(
            resumeSession.call(this.client, this.sessionId, sessionConfig),
            15_000,
            'Copilot SDK resumeSession()'
          );
          debug('copilot-worker', 'session-resumed', { sessionId: this.sessionId });
          return this.session;
        }
      } catch (err) {
        // Resume failed — fall through to create a new session
        debug('copilot-worker', 'session-resume-failed', {
          sessionId: this.sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
        this.sessionId = null;
        this.currentOnStream?.({
          type: 'agent_activity',
          traceId: this.currentTraceId ?? '',
          agentId: agentProfile.id,
          activity: 'Session expired, starting fresh',
          toolName: undefined,
          kind: 'progress',
        });
      }
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

    this.session = await CopilotWorker.withTimeout(
      createSession.call(this.client, sessionConfig),
      30_000,
      'Copilot SDK createSession()'
    );

    // Store the session ID for future resumption
    const sessionObj = this.session as Record<string, unknown> | null;
    const newSessionId = sessionObj?.['sessionId'] ?? sessionObj?.['id'];
    if (typeof newSessionId === 'string') {
      this.sessionId = newSessionId;
      debug('copilot-worker', 'session-created', { sessionId: this.sessionId });
    }

    // Register persistent listener for session.shutdown stats and SDK compaction events
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

      // Forward SDK compaction lifecycle events to the stream
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
        // SDK may use different field names — try multiple keys
        const preTokens =
          (event.data['preCompactionTokens'] as number) ??
          (event.data['pre_compaction_tokens'] as number) ??
          (event.data['tokensBefore'] as number) ??
          0;
        const postTokens =
          (event.data['postCompactionTokens'] as number) ??
          (event.data['post_compaction_tokens'] as number) ??
          (event.data['tokensAfter'] as number) ??
          0;
        const removed =
          (event.data['messagesRemoved'] as number) ??
          (event.data['messages_removed'] as number) ??
          1;
        this.currentOnStream?.({
          type: 'compaction_status',
          traceId: this.currentTraceId ?? '',
          agentId: agentProfile.id,
          agentName: agentProfile.name,
          source: 'sdk',
          totalMessages: preTokens,
          windowSize: postTokens,
          compactedMessages: removed,
          summarized: true,
          ...(preTokens > 0 ? { totalTokens: preTokens } : {}),
          ...(postTokens > 0 ? { windowTokens: postTokens } : {}),
        });
      }
    });

    return this.session;
  }
}
