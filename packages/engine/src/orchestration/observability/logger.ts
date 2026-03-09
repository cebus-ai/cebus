/**
 * Structured Logger
 *
 * T025: Implements OrchestrationLogger with JSON output and trace correlation.
 *
 * Single Responsibility: Format and emit structured log entries.
 * Interface Segregation: Implements OrchestrationLogger — callers depend only on the methods they use.
 */

import type {
  CircuitState,
  MCPToolInvocation,
  OrchestrationLogger,
  RoutingDecision,
} from '../types.js';
import { debug } from '../../core/debug-logger.js';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  readonly traceId: string;
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly component: string;
  readonly event: string;
  readonly data?: Record<string, unknown>;
}

function emit(entry: LogEntry): void {
  debug('orchestration', entry.event, {
    traceId: entry.traceId,
    level: entry.level,
    component: entry.component,
    ...entry.data,
  });
}

export class StructuredLogger implements OrchestrationLogger {
  private readonly enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  routing(decision: RoutingDecision): void {
    if (!this.enabled) return;
    emit({
      traceId: decision.traceId,
      timestamp: new Date().toISOString(),
      level: 'info',
      component: 'orchestrator',
      event: 'routing.decision',
      data: {
        mode: decision.mode,
        orchestrationMode: decision.orchestrationMode,
        targetAgentIds: decision.targetAgentIds,
        reason: decision.reason,
        confidence: decision.confidence,
        tagsParsed: decision.tagsParsed,
        fallbackUsed: decision.fallbackUsed,
      },
    });
  }

  workerStart(traceId: string, agentId: string): void {
    if (!this.enabled) return;
    emit({
      traceId,
      timestamp: new Date().toISOString(),
      level: 'info',
      component: `worker:${agentId}`,
      event: 'worker.start',
    });
  }

  workerComplete(traceId: string, agentId: string, latencyMs: number): void {
    if (!this.enabled) return;
    emit({
      traceId,
      timestamp: new Date().toISOString(),
      level: 'info',
      component: `worker:${agentId}`,
      event: 'worker.complete',
      data: { latencyMs },
    });
  }

  workerError(traceId: string, agentId: string, error: string): void {
    if (!this.enabled) return;
    emit({
      traceId,
      timestamp: new Date().toISOString(),
      level: 'error',
      component: `worker:${agentId}`,
      event: 'worker.error',
      data: { error },
    });
  }

  mcpInvoke(invocation: MCPToolInvocation): void {
    if (!this.enabled) return;
    emit({
      traceId: invocation.traceId,
      timestamp: new Date().toISOString(),
      level: 'info',
      component: `mcp:${invocation.serverId}`,
      event: 'mcp.invoke',
      data: {
        agentId: invocation.agentId,
        toolName: invocation.toolName,
        status: invocation.status,
        latencyMs: invocation.latencyMs,
        error: invocation.error,
      },
    });
  }

  mcpCircuitBreaker(serverId: string, state: CircuitState, reason: string): void {
    if (!this.enabled) return;
    emit({
      traceId: '',
      timestamp: new Date().toISOString(),
      level: state === 'open' ? 'warn' : 'info',
      component: `mcp:${serverId}`,
      event: 'mcp.circuit_breaker',
      data: { state, reason },
    });
  }

  sessionStart(sessionId: string, teamId: string): void {
    if (!this.enabled) return;
    emit({
      traceId: '',
      timestamp: new Date().toISOString(),
      level: 'info',
      component: 'session',
      event: 'session.start',
      data: { sessionId, teamId },
    });
  }

  sessionEnd(sessionId: string): void {
    if (!this.enabled) return;
    emit({
      traceId: '',
      timestamp: new Date().toISOString(),
      level: 'info',
      component: 'session',
      event: 'session.end',
      data: { sessionId },
    });
  }

  sessionCompact(sessionId: string, messagesBefore: number, messagesAfter: number): void {
    if (!this.enabled) return;
    emit({
      traceId: '',
      timestamp: new Date().toISOString(),
      level: 'info',
      component: 'session',
      event: 'session.compact',
      data: { sessionId, messagesBefore, messagesAfter },
    });
  }

  budgetCheck(traceId: string, agentId: string, allowed: boolean, reason?: string): void {
    if (!this.enabled) return;
    emit({
      traceId,
      timestamp: new Date().toISOString(),
      level: allowed ? 'debug' : 'warn',
      component: `worker:${agentId}`,
      event: 'budget.check',
      data: { allowed, reason },
    });
  }

  budgetExceeded(
    traceId: string,
    agentId: string,
    budgetType: string,
    current: number,
    limit: number
  ): void {
    if (!this.enabled) return;
    emit({
      traceId,
      timestamp: new Date().toISOString(),
      level: 'warn',
      component: `worker:${agentId}`,
      event: 'budget.exceeded',
      data: { budgetType, current, limit },
    });
  }

  budgetWarning(
    traceId: string,
    agentId: string,
    budgetType: string,
    usage: number,
    limit: number
  ): void {
    if (!this.enabled) return;
    emit({
      traceId,
      timestamp: new Date().toISOString(),
      level: 'warn',
      component: `worker:${agentId}`,
      event: 'budget.warning',
      data: { budgetType, usage, limit, percentUsed: Math.round((usage / limit) * 100) },
    });
  }
}
