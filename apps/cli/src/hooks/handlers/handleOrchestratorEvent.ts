/**
 * Handle orchestrator stream events (analysis, plan, round, direct, complete).
 */

import type { OrchestrationStreamEvent } from '@cebus/engine';
import type { StreamHandlerContext } from './types';

type OrchestratorAnalysisEvent = Extract<
  OrchestrationStreamEvent,
  { type: 'orchestrator_analysis' }
>;
type OrchestratorPlanEvent = Extract<OrchestrationStreamEvent, { type: 'orchestrator_plan' }>;
type OrchestratorRoundEvent = Extract<OrchestrationStreamEvent, { type: 'orchestrator_round' }>;
type OrchestratorDirectEvent = Extract<OrchestrationStreamEvent, { type: 'orchestrator_direct' }>;
type OrchestratorCompleteEvent = Extract<
  OrchestrationStreamEvent,
  { type: 'orchestrator_complete' }
>;
type OrchestratorPhaseEvent = Extract<OrchestrationStreamEvent, { type: 'orchestrator_phase' }>;
type OrchestratorRequestEvent = Extract<OrchestrationStreamEvent, { type: 'orchestrator_request' }>;
type OrchestratorStepResultEvent = Extract<OrchestrationStreamEvent, { type: 'orchestrator_step_result' }>;
type OrchestratorErrorEvent = Extract<OrchestrationStreamEvent, { type: 'orchestrator_error' }>;
type OrchestratorReasoningEvent = Extract<OrchestrationStreamEvent, { type: 'orchestrator_reasoning' }>;

/** Handle 'orchestrator_analysis': store analysis and show decision in timeline. */
export function handleOrchestratorAnalysis(
  event: OrchestratorAnalysisEvent,
  ctx: StreamHandlerContext
): void {
  ctx.latestAnalysisRef.current = event.analysis;

  const a = event.analysis;

  // Resolve agent IDs to display names via idMap → participants
  const resolveName = (agentId: string): string => {
    const participantId = ctx.idMap.get(agentId);
    if (participantId !== undefined) {
      const p = ctx.participants.find(pp => pp.id === participantId);
      if (p) return p.displayName;
    }
    return agentId;
  };

  // Skip analysis display for simple messages (greetings, one-liners) — just noise
  if (a.complexity === 'simple') return;

  const parts: string[] = [`**${a.intent}** [${a.complexity}]`];

  // Show per-agent instructions when the orchestrator gave specific guidance
  const instructions = Object.entries(a.agentInstructions);
  if (instructions.length > 0) {
    for (const [agentId, instruction] of instructions) {
      parts.push(`- **${resolveName(agentId)}**: ${instruction}`);
    }
  }

  ctx.setStaticEntries(prev => [
    ...prev,
    {
      id: `orc-analysis-${Date.now().toString(36)}`,
      kind: 'orchestrator-message' as const,
      content: parts.join('\n'),
      timestamp: new Date(),
    },
  ]);
}

/** Handle 'orchestrator_plan': show plan approval or log the plan. */
export function handleOrchestratorPlan(
  event: OrchestratorPlanEvent,
  ctx: StreamHandlerContext,
  originalMessage: string
): void {
  if (event.awaitingApproval && ctx.latestAnalysisRef.current) {
    ctx.setPendingPlanApproval({
      plan: event.plan,
      analysis: ctx.latestAnalysisRef.current,
      originalMessage,
    });
  } else {
    const stepsSummary = event.plan.steps
      .map((s, i) => `${i + 1}. ${s.agentId}: ${s.action}`)
      .join(', ');
    ctx.setOrchestratorMessages(prev => [
      ...prev,
      {
        kind: 'plan',
        content: `Plan: ${event.plan.description} (${stepsSummary})`,
        timestamp: new Date(),
      },
    ]);
  }
}

/** Handle 'orchestrator_round': show routing decision in timeline. */
export function handleOrchestratorRound(
  event: OrchestratorRoundEvent,
  ctx: StreamHandlerContext
): void {
  ctx.setStaticEntries(prev => [
    ...prev,
    {
      id: `orc-round-${Date.now().toString(36)}`,
      kind: 'orchestrator-message' as const,
      content: `Round ${event.round}/${event.maxRounds} — routing to **${event.nextAgent}**: ${event.reason}`,
      timestamp: new Date(),
    },
  ]);
  ctx.setPlanProgress(prev =>
    prev ? { ...prev, completed: event.round, activeAgent: event.nextAgent } : null
  );
}

/** Handle 'orchestrator_direct': show direct orchestrator response in timeline. */
export function handleOrchestratorDirect(
  event: OrchestratorDirectEvent,
  ctx: StreamHandlerContext
): void {
  ctx.setStaticEntries(prev => [
    ...prev,
    {
      id: `orc-direct-${Date.now().toString(36)}`,
      kind: 'orchestrator-message' as const,
      content: event.content,
      timestamp: new Date(),
    },
  ]);
}

/** Handle 'orchestrator_complete': mark plan done and add summary. */
export function handleOrchestratorComplete(
  event: OrchestratorCompleteEvent,
  ctx: StreamHandlerContext
): void {
  ctx.setPlanProgress(prev =>
    prev ? { ...prev, completed: prev.plan.steps.length, activeAgent: null } : null
  );
  ctx.setOrchestratorMessages(prev => [
    ...prev,
    {
      kind: 'complete',
      content: event.summary,
      timestamp: new Date(),

      ...(event.taskSummary ? { taskSummary: event.taskSummary } : {}),
    },
  ]);
}

/** Handle 'orchestrator_phase': add a phase indicator message (skip internal 'analyzing' phase). */
export function handleOrchestratorPhase(
  event: OrchestratorPhaseEvent,
  ctx: StreamHandlerContext
): void {
  if (event.phase === 'analyzing') return;
  ctx.setOrchestratorMessages(prev => [
    ...prev,
    {
      kind: 'phase',
      content: event.phase,
      timestamp: new Date(),
      phase: event.phase,
    },
  ]);
}

/** Handle 'orchestrator_request': add a request summary message (skip internal 'analyzing' phase). */
export function handleOrchestratorRequest(
  event: OrchestratorRequestEvent,
  ctx: StreamHandlerContext
): void {
  if (event.phase === 'analyzing') return;
  ctx.setOrchestratorMessages(prev => [
    ...prev,
    {
      kind: 'request',
      content: event.summary,
      timestamp: new Date(),
      summary: event.summary,
      phase: event.phase,
    },
  ]);
}

/** Handle 'orchestrator_step_result': add step result with next preview. */
export function handleOrchestratorStepResult(
  event: OrchestratorStepResultEvent,
  ctx: StreamHandlerContext
): void {
  ctx.setOrchestratorMessages(prev => [
    ...prev,
    {
      kind: 'step_result',
      content: event.resultSummary,
      timestamp: new Date(),
      stepStatus: event.status,
      summary: event.resultSummary,
      nextSummary: event.nextStepSummary,
    },
  ]);
}

/** Handle 'orchestrator_error': display as a dimmed warning (skip recoverable noise). */
export function handleOrchestratorError(
  event: OrchestratorErrorEvent,
  ctx: StreamHandlerContext
): void {
  if (event.recoverable) return;
  ctx.setOrchestratorMessages(prev => [
    ...prev,
    {
      kind: 'error',
      content: `⚠ [${event.phase}] ${event.message}`,
      timestamp: new Date(),
    },
  ]);
}

/** Handle 'orchestrator_reasoning': update reasoning for ThinkingIndicator display. */
export function handleOrchestratorReasoning(
  event: OrchestratorReasoningEvent,
  ctx: StreamHandlerContext
): void {
  // Store under the orchestrator participant ID so ThinkingIndicator shows it
  const orchestratorPid = ctx.idMap.get('__orchestrator__');
  if (orchestratorPid !== undefined) {
    ctx.setReasoningContent(prev => {
      const updated = new Map(prev);
      updated.set(orchestratorPid, (prev.get(orchestratorPid) ?? '') + event.delta);
      return updated;
    });
  }
}
