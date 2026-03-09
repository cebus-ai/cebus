/**
 * Handle Team Leader (TL) stream events.
 *
 * TL messages (guidance, synthesis, summaries) are rendered as first-class
 * conversation entries in the Static timeline — same visual treatment as
 * user and model messages — so the user sees TL thinking chronologically.
 *
 * Phase transitions remain as subtle orchestrator indicators.
 */

import type { OrchestrationStreamEvent } from '@cebus/engine';
import type { StreamHandlerContext } from './types';
import type { StaticEntry } from '../../chat-types';

type TlRoutingPlanEvent = Extract<OrchestrationStreamEvent, { type: 'tl_routing_plan' }>;
type TlMessageEvent = Extract<OrchestrationStreamEvent, { type: 'tl_message' }>;
type TlPhaseChangeEvent = Extract<OrchestrationStreamEvent, { type: 'tl_phase_change' }>;
type TlAwaitingInputEvent = Extract<OrchestrationStreamEvent, { type: 'tl_awaiting_input' }>;
type TlSummaryEvent = Extract<OrchestrationStreamEvent, { type: 'tl_summary' }>;
type TlSynthesisEvent = Extract<OrchestrationStreamEvent, { type: 'tl_synthesis' }>;
type TlWarningEvent = Extract<OrchestrationStreamEvent, { type: 'tl_warning' }>;
type TlMetricsEvent = Extract<OrchestrationStreamEvent, { type: 'tl_metrics' }>;
type TlInterruptEvent = Extract<OrchestrationStreamEvent, { type: 'tl_interrupt' }>;

/**
 * Defer a static entry addition by 2 ticks to match the timing of model
 * completion (handleCompleteEvent uses a 2-phase setTimeout pattern).
 * This preserves chronological ordering between model responses and TL messages.
 */
function deferTlStaticEntry(entry: StaticEntry, ctx: StreamHandlerContext): void {
  setTimeout(() => {
    setTimeout(() => {
      ctx.setStaticEntries(prev => [...prev, entry]);
    }, 0);
  }, 0);
}

/** Handle 'tl_routing_plan': show what TL asked each model to do. */
export function handleTlRoutingPlan(event: TlRoutingPlanEvent, ctx: StreamHandlerContext): void {
  // Prepare agents for a new round — reset tracking and create fresh placeholders
  // so that 'start' events are recognized and thinking indicators appear.
  ctx.prepareForNewRound(event.assignments.map(a => a.agentId));

  deferTlStaticEntry(
    {
      id: `tl-plan-${Date.now().toString(36) + Math.random().toString(36).slice(2, 6)}`,
      kind: 'tl-routing-plan' as const,
      assignments: event.assignments,
      parallel: event.parallel,
      timestamp: new Date(),
    },
    ctx,
  );
}

/** Handle 'tl_message': render as a conversation message in the timeline. */
export function handleTlMessage(event: TlMessageEvent, ctx: StreamHandlerContext): void {
  deferTlStaticEntry(
    {
      id: `tl-msg-${Date.now().toString(36) + Math.random().toString(36).slice(2, 6)}`,
      kind: 'tl-message' as const,
      content: event.content,
      phase: event.phase,
      timestamp: new Date(),
    },
    ctx,
  );
}

/** Handle 'tl_phase_change': internal tracking only — no user-visible output. */
export function handleTlPhaseChange(_event: TlPhaseChangeEvent, _ctx: StreamHandlerContext): void {
  // Phase transitions are internal TL state — the TL's messages already
  // communicate what it's doing in the conversation timeline.
}

/** Handle 'tl_awaiting_input': show question prompt and await user input. */
export function handleTlAwaitingInput(event: TlAwaitingInputEvent, ctx: StreamHandlerContext): void {
  ctx.setPendingUserInput({
    requestId: `tl-input-${Date.now()}`,
    agentName: 'Team Leader',
    prompt: event.question,
    participantId: '',
    options: event.options,
  });
}

/** Handle 'tl_summary': render as a conversation message. */
export function handleTlSummary(event: TlSummaryEvent, ctx: StreamHandlerContext): void {
  deferTlStaticEntry(
    {
      id: `tl-sum-${Date.now().toString(36) + Math.random().toString(36).slice(2, 6)}`,
      kind: 'tl-message' as const,
      content: event.recommendation,
      phase: 'review',
      timestamp: new Date(),
    },
    ctx,
  );
}

/** Handle 'tl_synthesis': render as a conversation message. */
export function handleTlSynthesis(event: TlSynthesisEvent, ctx: StreamHandlerContext): void {
  deferTlStaticEntry(
    {
      id: `tl-syn-${Date.now().toString(36) + Math.random().toString(36).slice(2, 6)}`,
      kind: 'tl-message' as const,
      content: event.unified_output,
      phase: 'synthesize',
      timestamp: new Date(),
    },
    ctx,
  );
}

/** Handle 'tl_warning': display warning/info. */
export function handleTlWarning(event: TlWarningEvent, ctx: StreamHandlerContext): void {
  if (event.severity === 'error') {
    ctx.setOrchestratorMessages(prev => [
      ...prev,
      {
        kind: 'error' as const,
        content: event.message,
        timestamp: new Date(),
      },
    ]);
  }
}

type TlThinkingEvent = Extract<OrchestrationStreamEvent, { type: 'tl_thinking' }>;

/** Handle 'tl_thinking': show/hide TL thinking indicator. */
export function handleTlThinking(event: TlThinkingEvent, ctx: StreamHandlerContext): void {
  ctx.setTlThinking(event.active);
}

/** Handle 'tl_metrics': log metrics (debug only). */
export function handleTlMetrics(_event: TlMetricsEvent, _ctx: StreamHandlerContext): void {
  // Metrics are logged by the engine; CLI just acknowledges
}

/** Handle 'tl_interrupt': show interrupt acknowledgement. */
export function handleTlInterrupt(event: TlInterruptEvent, ctx: StreamHandlerContext): void {
  ctx.setOrchestratorMessages(prev => [
    ...prev,
    {
      kind: 'status' as const,
      content: `User interrupt: ${event.interruptType}${event.target ? ` → ${event.target}` : ''}`,
      timestamp: new Date(),
    },
  ]);
}
