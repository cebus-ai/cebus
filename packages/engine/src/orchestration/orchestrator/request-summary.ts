import type { OrchestrationStreamEvent, OrchestratorReasoningSource } from '../types.js';
import type { OrchestratorLLM } from './llm.js';

const MAX_SUMMARY_LENGTH = 200;

const API_KEY_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,
  /sk-or-[a-zA-Z0-9_-]{20,}/g,
  /ghp_[a-zA-Z0-9]{36,}/g,
  /AIzaSy[a-zA-Z0-9_-]{33}/g,
  /Bearer\s+[a-zA-Z0-9._-]{20,}/gi,
  /[A-Z_]{2,}(?:_API)?_KEY\s*=\s*\S+/g,
  /[A-Z_]{2,}(?:_API)?_SECRET\s*=\s*\S+/g,
];

export function sanitizeSummary(text: string): string {
  let result = text;
  for (const pattern of API_KEY_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  if (result.length > MAX_SUMMARY_LENGTH) {
    result = result.slice(0, MAX_SUMMARY_LENGTH - 3) + '...';
  }
  return result;
}

export function buildAnalyzerSummary(agentCount: number, messagePreview: string): string {
  const preview = sanitizeSummary(messagePreview.slice(0, 80));
  return `Analyzing request to determine intent and select from ${agentCount} agents: "${preview}"`;
}

export function buildPlannerSummary(intent: string, agentIds: string[]): string {
  const agents = agentIds.slice(0, 5).join(', ');
  const suffix = agentIds.length > 5 ? ` +${agentIds.length - 5} more` : '';
  return sanitizeSummary(`Building execution plan for: ${intent} (agents: ${agents}${suffix})`);
}

export function buildEvaluatorSummary(
  round: number,
  maxRounds: number,
  lastAgentName: string
): string {
  return `Evaluating ${lastAgentName}'s response (round ${round}/${maxRounds})...`;
}

export function buildWorkerRoutingSummary(
  agentName: string,
  guidance: string | undefined
): string {
  const action = guidance !== undefined && guidance.length > 0
    ? sanitizeSummary(guidance.slice(0, 120))
    : 'respond to the request';
  return `Asking ${agentName} to ${action}...`;
}

export function buildStepResultSummary(
  agentName: string,
  action: string,
  excerpt: string
): string {
  const truncAction = action.length > 80 ? action.slice(0, 77) + '...' : action;
  const truncExcerpt = excerpt.length > 100 ? excerpt.slice(0, 97) + '...' : excerpt;
  return sanitizeSummary(`${agentName} completed: ${truncAction || truncExcerpt}`);
}

export function buildNextStepPreview(agentName: string, action: string): string {
  const truncAction = action.length > 100 ? action.slice(0, 97) + '...' : action;
  return sanitizeSummary(`Next: ${agentName} will ${truncAction}`);
}

export function getCapabilityTag(agent: { provider?: { type: string } | undefined }): string {
  return agent.provider?.type === 'copilot'
    ? '[can execute: file editing, shell commands]'
    : '[chat only]';
}

/**
 * Use JSON mode when debug is off (no reasoning visibility needed),
 * fall back to streaming with reasoning when debug is on.
 */
export async function invokeJSONOrStream(
  llm: OrchestratorLLM,
  systemPrompt: string,
  userMessage: string,
  opts: {
    debugEnabled: boolean;
    traceId: string;
    source: OrchestratorReasoningSource;
    emit: ((event: OrchestrationStreamEvent) => void) | undefined;
  }
): Promise<string> {
  if (opts.debugEnabled) return streamWithReasoning(llm, systemPrompt, userMessage, opts);
  return llm.invokeJSON(systemPrompt, userMessage);
}

/**
 * Stream an LLM response, collecting the full output and optionally emitting
 * batched debug reasoning events (flush every 100 chars or 150ms).
 */
export async function streamWithReasoning(
  llm: OrchestratorLLM,
  systemPrompt: string,
  userMessage: string,
  opts: {
    debugEnabled: boolean;
    traceId: string;
    source: OrchestratorReasoningSource;
    emit: ((event: OrchestrationStreamEvent) => void) | undefined;
  }
): Promise<string> {
  let fullResponse = '';
  let buffer = '';
  let lastFlush = Date.now();

  for await (const token of llm.stream(systemPrompt, userMessage)) {
    fullResponse += token;
    if (opts.debugEnabled) {
      buffer += token;
      if (buffer.length >= 100 || Date.now() - lastFlush >= 150) {
        opts.emit?.({ type: 'orchestrator_reasoning', traceId: opts.traceId, delta: buffer, source: opts.source });
        buffer = '';
        lastFlush = Date.now();
      }
    }
  }

  if (opts.debugEnabled && buffer.length > 0) {
    opts.emit?.({ type: 'orchestrator_reasoning', traceId: opts.traceId, delta: buffer, source: opts.source });
  }

  return fullResponse;
}
