import { AIMessage } from '@langchain/core/messages';
import type { OrchestrationStateType } from '../state.js';
import {
  ORCHESTRATOR_AGENT_ID,
  type TeamConfig,
  type AgentProfile,
  type OrchestratorAnalysis,
  type OrchestratorPlan,
  type StreamCallbackRef,
  type ExecutionContext,
  type AgentContribution,
  type TaskCompletionSummary,
  type TlPhase,
  type TlResponse,
  type TlBudgets,
  type Artifact,
} from '../types.js';
import { z } from 'zod';
import { type OrchestratorLLM, createOrchestratorLLM } from './llm.js';
import { loadOrchestratorPrompt } from '../config/defaults.js';
import { debug, logTlDecision } from '../../core/debug-logger.js';
import { readClaudeMd } from '../../core/project-context.js';
import { findProjectRoot } from '../../core/project-root.js';
import { extractTextFromContent } from '../../core/message.js';
import {
  buildAnalyzerSummary,
  buildEvaluatorSummary,
  buildWorkerRoutingSummary,
  buildStepResultSummary,
  buildNextStepPreview,
  getCapabilityTag,
  invokeJSONOrStream,
} from './request-summary.js';
import { retryOnParseFail, extractOuterJson } from './parse-utils.js';
import { batchUpdatePlanStepStatuses } from './plan-file.js';
import { validateTlResponse, createDefaultBudgets } from './tl-guardrails.js';
import { getTlCorePrompt, getPhasePrompt } from './tl-prompt-loader.js';
import { createLedger, appendToLedger, readLedger, compactLedger, cleanupExpiredLedgers } from './session-ledger.js';
import { join } from 'node:path';

function buildAgentDescription(agent: AgentProfile): string {
  const skills =
    agent.skills !== undefined && agent.skills.length > 0
      ? ` [Skills: ${agent.skills.join(', ')}]`
      : '';
  const cap = getCapabilityTag(agent);
  return `- ${agent.id}: ${agent.name} — ${agent.role} ${cap}${skills}`;
}

function getTeamCapabilityNotice(agents: readonly AgentProfile[]): string {
  const hasExecAgent = agents.some(a => a.provider?.type === 'copilot');
  if (hasExecAgent) return '';
  return '\n\n## IMPORTANT: Discussion-Only Mode\nNo agents in this chat can execute code changes (no [can execute] agents). All agents are [chat only]. You may discuss, plan, and advise, but CANNOT assign implementation tasks. If the user asks for code changes, explain that no execution-capable agent is available and suggest adding a Copilot model.';
}

/**
 * Create the analyzer node that runs BEFORE routing.
 * Analyzes user message intent, complexity, safety, and selects target agents.
 */
export function createAnalyzerNode(
  config: TeamConfig,
  streamCallbackRef: StreamCallbackRef,
  abortControllers?: Map<string, AbortController>
): (state: OrchestrationStateType) => Promise<Partial<OrchestrationStateType>> {
  let llm: OrchestratorLLM | null = null;
  const debugEnabled = process.env['CEBUS_ORCHESTRATOR_DEBUG'] === 'true';

  return async (state: OrchestrationStateType): Promise<Partial<OrchestrationStateType>> => {
    const traceId = state.currentTraceId;
    const orchestratorConfig = config.orchestrator;
    if (!orchestratorConfig) {
      return {};
    }

    const orchestratorMentioned = state.directedTo.includes(ORCHESTRATOR_AGENT_ID);
    if (orchestratorMentioned) {
      await handleOrchestratorConversation(state, orchestratorConfig, config, streamCallbackRef);

      const otherTargets = state.directedTo.filter(id => id !== ORCHESTRATOR_AGENT_ID);
      if (otherTargets.length === 0) {
        return { isComplete: true };
      }

      return { directedTo: otherTargets };
    }

    if (
      state.orchestratorPlanApproved === true &&
      state.orchestratorAnalysis !== null &&
      state.orchestratorAnalysis !== undefined
    ) {
      const analysis = state.orchestratorAnalysis;
      const emit = streamCallbackRef.current;
      emit?.({ type: 'orchestrator_analysis', traceId, analysis });

      const executionContexts: Record<string, ExecutionContext> = {};
      for (const agentId of analysis.selectedAgents) {
        const controller = new AbortController();
        abortControllers?.set(agentId, controller);
        // eslint-disable-next-line security/detect-object-injection -- agentId from analysis.selectedAgents
        executionContexts[agentId] = {
          activeAgentId: agentId,
          allowedTools: ['*'],
          routingReason: `Orchestrator: ${analysis.intent}`,
          timeoutBudget: 120000,
          cancellationToken: controller.signal,
          // eslint-disable-next-line security/detect-object-injection -- agentId from analysis.selectedAgents
          orchestratorGuidance: analysis.agentInstructions[agentId],
        };
      }

      return {
        orchestratorAnalysis: analysis,
        activeAgentId: analysis.selectedAgents[0] ?? null,
        pendingAgents: analysis.selectedAgents.slice(1),
        executionContexts,
        orchestratorMaxRounds: orchestratorConfig.maxRounds ?? 3,
        orchestratorRound: 0,
      };
    }

    if (llm === null) {
      const routingConfig = {
        ...(orchestratorConfig.model !== undefined && orchestratorConfig.model.length > 0
          ? { model: orchestratorConfig.model }
          : {}),
        ...(orchestratorConfig.provider !== undefined
          ? { provider: orchestratorConfig.provider }
          : {}),
      };
      llm = await createOrchestratorLLM(routingConfig);
    }

    const lastHumanMessage = [...state.messages].reverse().find(m => m._getType() === 'human');
    const userMessage = extractTextFromContent(lastHumanMessage?.content);

    const agentDescriptions = config.agents.map(a => buildAgentDescription(a)).join('\n');

    const recentHistory = state.messages
      .slice(-10)
      .map(m => {
        const role = m._getType() === 'human' ? 'User' : ((m as AIMessage).name ?? 'Agent');
        const content = extractTextFromContent(m.content);
        return `${role}: ${content.slice(0, 200)}`;
      })
      .join('\n');

    const analyzerPrompt = loadOrchestratorPrompt('analyzer.md');
    const capabilityNotice = getTeamCapabilityNotice(config.agents);
    const systemPrompt = `${analyzerPrompt}

## Available Agents
${agentDescriptions}

## Chat Mode
${config.conversationMode}

## Recent Conversation
${recentHistory || '(no prior messages)'}

## Agent IDs (use these exact IDs in your response)
${config.agents.map(a => a.id).join(', ')}${capabilityNotice}`;

    const emit = streamCallbackRef.current;

    emit?.({ type: 'orchestrator_phase', traceId, phase: 'analyzing' });

    emit?.({
      type: 'orchestrator_request',
      traceId,
      phase: 'analyzing',
      target: 'analyzer',
      summary: buildAnalyzerSummary(config.agents.length, userMessage),
      intent: 'classify intent',
    });

    try {
      const usageBefore = { ...llm.totalUsage };
      const content = await invokeJSONOrStream(llm, systemPrompt, userMessage, {
        debugEnabled, traceId, source: 'analyzer', emit,
      });
      const usageAfter = llm.totalUsage;
      emit?.({
        type: 'orchestrator_token_usage', traceId,
        tokenUsage: {
          inputTokens: usageAfter.inputTokens - usageBefore.inputTokens,
          outputTokens: usageAfter.outputTokens - usageBefore.outputTokens,
          ...(usageAfter.cacheReadTokens ? { cacheReadTokens: (usageAfter.cacheReadTokens ?? 0) - (usageBefore.cacheReadTokens ?? 0) } : {}),
        },
      });
      let analysis = parseAnalyzerResponse(content, config);

      if (analysis === null) {
        debug('orchestrator', 'analyzer-first-parse-failed', {
          responsePreview: content.slice(0, 300),
          responseLength: content.length,
        });
        analysis = await retryOnParseFail(
          llm, systemPrompt, content,
          (r) => parseAnalyzerResponse(r, config),
        );
        if (analysis === null) {
          const preview = content.slice(0, 200).replace(/\n/g, ' ');
          if (content.trim().length > 0) {
            analysis = parseAnalyzerFromProse(content, config);
            debug('orchestrator', 'analyzer-parsed-from-prose', { raw: preview });
            emit?.({
              type: 'orchestrator_error', traceId, phase: 'analyzing',
              message: 'Analyzer response parsed from prose (JSON mode unavailable for this model)',
              recoverable: true,
            });
          } else {
            emit?.({
              type: 'orchestrator_error', traceId, phase: 'analyzing',
              message: 'Analyzer returned empty response — using fallback routing',
              recoverable: true,
            });
            analysis = makeFallbackAnalysis(config);
          }
        }
      }

      // After exhaustive fallback handling, analysis is guaranteed non-null
      if (analysis === null) analysis = makeFallbackAnalysis(config);

      // When TL is enabled and task is complex, require user approval before dispatching
      if (config.teamLeader !== undefined && analysis.complexity === 'complex' && !analysis.needsApproval) {
        analysis = { ...analysis, needsApproval: true };
      }

      // Capture in const for closure narrowing (TS can't narrow `let` across closures)
      const resolvedAnalysis = analysis;

      emit?.({ type: 'orchestrator_analysis', traceId, analysis: resolvedAnalysis });

      // BUG-2 fix: only use directResponse for meta questions about the orchestrator itself
      const META_INTENTS = ['help', 'status', 'list_agents', 'explain_mode', 'orchestrator_info'];
      if (
        resolvedAnalysis.directResponse !== undefined &&
        resolvedAnalysis.directResponse.length > 0 &&
        META_INTENTS.some(intent => resolvedAnalysis.intent.toLowerCase().includes(intent))
      ) {
        emit?.({ type: 'orchestrator_direct', traceId, content: resolvedAnalysis.directResponse });
        return {
          orchestratorAnalysis: resolvedAnalysis,
          isComplete: true,
        };
      }

      if (resolvedAnalysis.needsApproval && !resolvedAnalysis.plan) {
        // Auto-generate a plan from the analysis for approval UI
        const autoSteps = (resolvedAnalysis.selectedAgents.length > 0
          ? resolvedAnalysis.selectedAgents
          : config.agents.map(a => a.id)
        ).map(agentId => ({
          agentId,
          action: resolvedAnalysis.agentInstructions[agentId] ?? 'Respond to the user request', // eslint-disable-line security/detect-object-injection
        }));
        analysis = {
          ...analysis,
          plan: {
            description: analysis.intent,
            steps: autoSteps,
            estimatedRounds: autoSteps.length,
            estimatedCost: analysis.complexity === 'complex' ? 'medium' : 'low',
          },
        };
      }
      if (analysis.needsApproval && analysis.plan) {
        emit?.({
          type: 'orchestrator_plan',
          traceId,
          plan: analysis.plan,
          awaitingApproval: true,
        });
        return {
          orchestratorAnalysis: analysis,
          systemCommand: 'await_approval',
          orchestratorMaxRounds: orchestratorConfig.maxRounds ?? 3,
        };
      }

      // BUG-1 fix: fallback to all agents when selectedAgents is empty
      const selected = analysis.selectedAgents.length > 0
        ? analysis.selectedAgents
        : config.agents.map(a => a.id);

      const executionContexts: Record<string, ExecutionContext> = {};
      for (const agentId of selected) {
        const controller = new AbortController();
        abortControllers?.set(agentId, controller);
        // eslint-disable-next-line security/detect-object-injection -- agentId from selected agents
        executionContexts[agentId] = {
          activeAgentId: agentId,
          allowedTools: ['*'],
          routingReason: `Orchestrator: ${analysis.intent}`,
          timeoutBudget: 120000,
          cancellationToken: controller.signal,
          // eslint-disable-next-line security/detect-object-injection -- agentId from selected agents
          orchestratorGuidance: analysis.agentInstructions[agentId],
        };
      }

      return {
        orchestratorAnalysis: analysis,
        activeAgentId: selected[0] ?? null,
        pendingAgents: selected.slice(1),
        executionContexts,
        orchestratorMaxRounds: orchestratorConfig.maxRounds ?? 3,
        orchestratorRound: 0,
      };
    } catch (err) {
      debug('orchestrator', 'analyzer-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      emit?.({
        type: 'orchestrator_error', traceId, phase: 'analyzing',
        message: `Analyzer error: ${err instanceof Error ? err.message : String(err)}`,
        recoverable: true,
      });
      // BUG-3 fix: return fallback analysis instead of empty object
      return {
        orchestratorAnalysis: makeFallbackAnalysis(config),
        activeAgentId: config.agents[0]?.id ?? null,
        pendingAgents: config.agents.slice(1).map(a => a.id),
        orchestratorMaxRounds: orchestratorConfig.maxRounds ?? 3,
        orchestratorRound: 0,
      };
    }
  };
}

/**
 * Create the evaluator node that runs AFTER each agent response.
 * Decides: complete, next round, or max rounds reached.
 */
export function createEvaluatorNode(
  config: TeamConfig,
  streamCallbackRef: StreamCallbackRef,
  abortControllers?: Map<string, AbortController>
): (state: OrchestrationStateType) => Promise<Partial<OrchestrationStateType>> {
  let llm: OrchestratorLLM | null = null;
  const debugEnabled = process.env['CEBUS_ORCHESTRATOR_DEBUG'] === 'true';

  return async (state: OrchestrationStateType): Promise<Partial<OrchestrationStateType>> => {
    const traceId = state.currentTraceId;
    const orchestratorConfig = config.orchestrator;
    const analysis = state.orchestratorAnalysis;
    if (!orchestratorConfig || !analysis) {
      return { isComplete: true };
    }

    const round = state.orchestratorRound + 1;
    const maxRounds = state.orchestratorMaxRounds;
    const emit = streamCallbackRef.current;

    emit?.({ type: 'orchestrator_phase', traceId, phase: 'reviewing' });

    const lastAiForSummary = [...state.messages].reverse().find(m => m._getType() === 'ai') as AIMessage | undefined;
    const lastAgentIdForSummary = lastAiForSummary?.name ?? '';
    const lastAgentNameForSummary = config.agents.find(a => a.id === lastAgentIdForSummary)?.name ?? lastAgentIdForSummary;

    emit?.({
      type: 'orchestrator_request',
      traceId,
      phase: 'reviewing',
      target: 'evaluator',
      summary: buildEvaluatorSummary(round, maxRounds, lastAgentNameForSummary),
      intent: 'evaluate response',
    });

    if (round >= maxRounds) {
      const taskSummary =
        analysis.plan !== undefined
          ? buildTaskSummary(state, config, analysis, maxRounds, undefined)
          : undefined;
      emit?.({
        type: 'orchestrator_complete',
        traceId,
        summary: `Task completed after ${round} round(s) (max rounds reached).`,
        ...(taskSummary ? { taskSummary } : {}),
      });
      emit?.({ type: 'orchestrator_phase', traceId, phase: 'complete' });
      return {
        orchestratorRound: round,

        isComplete: true,
      };
    }

    if (!analysis.plan) {
      emit?.({
        type: 'orchestrator_complete',
        traceId,
        summary: `Task completed in ${round} round(s).`,
      });
      emit?.({ type: 'orchestrator_phase', traceId, phase: 'complete' });
      return {
        orchestratorRound: round,

        isComplete: true,
      };
    }

    if (llm === null) {
      const routingConfig = {
        ...(orchestratorConfig.model !== undefined && orchestratorConfig.model.length > 0
          ? { model: orchestratorConfig.model }
          : {}),
        ...(orchestratorConfig.provider !== undefined
          ? { provider: orchestratorConfig.provider }
          : {}),
      };
      llm = await createOrchestratorLLM(routingConfig);
    }

    const agentMessages = state.messages.filter(m => m._getType() === 'ai');
    const conversationDigest = agentMessages
      .map(m => {
        const aiMsg = m as AIMessage;
        const agentId = aiMsg.name ?? 'unknown';
        const content = extractTextFromContent(aiMsg.content);
        return `[${agentId}]: ${content.slice(0, 300)}${content.length > 300 ? '...' : ''}`;
      })
      .join('\n\n');

    const lastAiMessage = agentMessages.at(-1);
    const lastResponse = typeof lastAiMessage?.content === 'string' ? lastAiMessage.content : '';
    const lastAgentId = (lastAiMessage as AIMessage | undefined)?.name ?? '';

    const evaluatorPrompt = loadOrchestratorPrompt('evaluator.md');
    const agentDescriptions = config.agents.map(a => buildAgentDescription(a)).join('\n');
    const capabilityNotice = getTeamCapabilityNotice(config.agents);

    const systemPrompt = `${evaluatorPrompt}

## Plan
${analysis.plan.description}
Steps: ${analysis.plan.steps.map((s, i) => `${i + 1}. ${s.agentId}: ${s.action}`).join(', ')}

## Available Agents
${agentDescriptions}

## Current State
Round: ${round}/${maxRounds}
Last agent: ${lastAgentId}
Original intent: ${analysis.intent}

## Agent IDs
${config.agents.map(a => a.id).join(', ')}${capabilityNotice}`;

    try {
      const evalUserMessage = `## Discussion So Far\n${conversationDigest.slice(0, 3000)}\n\n## Latest Response (${lastAgentId})\n${lastResponse.slice(0, 2000)}`;
      const evalUsageBefore = { ...llm.totalUsage };
      const content = await invokeJSONOrStream(
        llm, systemPrompt, evalUserMessage,
        { debugEnabled, traceId, source: 'evaluator', emit },
      );
      const evalUsageAfter = llm.totalUsage;
      emit?.({
        type: 'orchestrator_token_usage', traceId,
        tokenUsage: {
          inputTokens: evalUsageAfter.inputTokens - evalUsageBefore.inputTokens,
          outputTokens: evalUsageAfter.outputTokens - evalUsageBefore.outputTokens,
          ...(evalUsageAfter.cacheReadTokens ? { cacheReadTokens: (evalUsageAfter.cacheReadTokens ?? 0) - (evalUsageBefore.cacheReadTokens ?? 0) } : {}),
        },
      });
      let evaluation = parseEvaluatorResponse(content, config, analysis, round);

      if (evaluation === null) {
        evaluation = await retryOnParseFail(
          llm, systemPrompt, content,
          (r) => parseEvaluatorResponse(r, config, analysis, round),
        );
        if (evaluation === null) {
          evaluation = evaluatorFallback(config, analysis, round);
        }
      }

      if (evaluation.parseFailure) {
        emit?.({
          type: 'orchestrator_error', traceId, phase: 'reviewing',
          message: 'Evaluator parse failure — using plan-aware fallback',
          recoverable: true,
        });
      }

      if (evaluation.isComplete) {
        const taskSummary =
          analysis.plan !== undefined
            ? buildTaskSummary(state, config, analysis, maxRounds, evaluation.executiveSummary)
            : undefined;
        emit?.({
          type: 'orchestrator_complete',
          traceId,
          summary: evaluation.summary ?? `Task completed in ${round} round(s).`,
          ...(taskSummary ? { taskSummary } : {}),
        });
        emit?.({ type: 'orchestrator_phase', traceId, phase: 'complete' });
        return {
          orchestratorRound: round,
          isComplete: true,
        };
      }

      if (evaluation.nextAgentId !== undefined && evaluation.nextAgentId.length > 0) {
        const completedStepIndex = analysis.plan !== undefined
          ? findCurrentPlanStepIndex(analysis.plan, lastAgentId, round)
          : null;
        const nextStepIndex = completedStepIndex !== null ? completedStepIndex + 1 : undefined;
        const nextStep =
          nextStepIndex !== undefined && analysis.plan !== undefined
            // eslint-disable-next-line security/detect-object-injection -- nextStepIndex derived from completedStepIndex + 1
            ? analysis.plan.steps[nextStepIndex]
            : undefined;

        const lastExcerpt = lastResponse.slice(0, 100);
        const completedAction = completedStepIndex !== null && analysis.plan !== undefined
          // eslint-disable-next-line security/detect-object-injection
          ? (analysis.plan.steps[completedStepIndex]?.action ?? '')
          : '';

        emit?.({
          type: 'orchestrator_step_result',
          traceId,
          stepIndex: completedStepIndex ?? round - 1,
          status: 'done',
          agentId: lastAgentId,
          agentName: lastAgentNameForSummary,
          resultSummary: buildStepResultSummary(lastAgentNameForSummary, completedAction, lastExcerpt),
          ...(nextStep ? {
            nextStepIndex,
            nextStepSummary: buildNextStepPreview(
              config.agents.find(a => a.id === nextStep.agentId)?.name ?? nextStep.agentId,
              nextStep.action
            ),
          } : {}),
        });

        const planUpdates: Array<{ stepIndex: number; status: 'done' | 'in_progress' }> = [];
        if (completedStepIndex !== null) planUpdates.push({ stepIndex: completedStepIndex, status: 'done' });
        if (nextStepIndex !== undefined) planUpdates.push({ stepIndex: nextStepIndex, status: 'in_progress' });
        if (planUpdates.length > 0) batchUpdatePlanStepStatuses(state.sessionId, planUpdates);

        const nextAgentName = config.agents.find(a => a.id === evaluation.nextAgentId)?.name ?? evaluation.nextAgentId;

        emit?.({
          type: 'orchestrator_request',
          traceId,
          phase: 'executing',
          target: evaluation.nextAgentId,
          summary: buildWorkerRoutingSummary(nextAgentName, evaluation.guidance),
          intent: 'execute step',
          ...(nextStepIndex !== undefined ? { planStepIndex: nextStepIndex } : {}),
        });

        emit?.({
          type: 'orchestrator_round',
          traceId,
          round,
          maxRounds,
          nextAgent: evaluation.nextAgentId,
          reason: evaluation.reason ?? 'Continuing task',
        });

        const nextController = new AbortController();
        abortControllers?.set(evaluation.nextAgentId, nextController);
        const executionContexts: Record<string, ExecutionContext> = {
          [evaluation.nextAgentId]: {
            activeAgentId: evaluation.nextAgentId,
            allowedTools: ['*'],
            routingReason: evaluation.reason ?? 'Orchestrator continuation',
            timeoutBudget: 120000,
            cancellationToken: nextController.signal,
            orchestratorGuidance: evaluation.guidance ?? evaluation.reason,
          },
        };

        emit?.({ type: 'orchestrator_phase', traceId, phase: 'executing' });

        return {
          orchestratorRound: round,
          activeAgentId: evaluation.nextAgentId,
          pendingAgents: [],
          executionContexts,
          isComplete: false,
        };
      }

      {
        const taskSummary =
          analysis.plan !== undefined
            ? buildTaskSummary(state, config, analysis, maxRounds, undefined)
            : undefined;
        emit?.({
          type: 'orchestrator_complete',
          traceId,
          summary: `Task completed in ${round} round(s).`,
          ...(taskSummary ? { taskSummary } : {}),
        });
        emit?.({ type: 'orchestrator_phase', traceId, phase: 'complete' });
        return {
          orchestratorRound: round,
          isComplete: true,
        };
      }
    } catch (err) {
      debug('orchestrator', 'evaluator-failed', {
        error: err instanceof Error ? err.message : String(err),
        round,
        maxRounds,
      });
      const taskSummary =
        analysis.plan !== undefined
          ? buildTaskSummary(state, config, analysis, maxRounds, undefined)
          : undefined;
      emit?.({
        type: 'orchestrator_complete',
        traceId,
        summary: `Task completed in ${round} round(s) (evaluator error).`,
        ...(taskSummary ? { taskSummary } : {}),
      });
      emit?.({ type: 'orchestrator_phase', traceId, phase: 'complete' });
      return {
        orchestratorRound: round,

        isComplete: true,
      };
    }
  };
}

function findCurrentPlanStepIndex(
  plan: OrchestratorPlan,
  lastAgentId: string,
  round: number
): number | null {
  // Use round as primary hint — check expected step first
  const expected = Math.min(round - 1, plan.steps.length - 1);
  if (expected >= 0 && plan.steps[expected]?.agentId === lastAgentId) {
    return expected;
  }
  // Fallback: search backwards for the agent
  for (let i = plan.steps.length - 1; i >= 0; i--) {
    // eslint-disable-next-line security/detect-object-injection -- i is a loop index
    if (plan.steps[i]!.agentId === lastAgentId) {
      return i;
    }
  }
  return round > 0 ? expected : null;
}

/**
 * Build a TaskCompletionSummary from state and config.
 * Deterministically extracts agent contributions from messages.
 */
function buildTaskSummary(
  state: OrchestrationStateType,
  config: TeamConfig,
  analysis: OrchestratorAnalysis,
  maxRounds: number,
  executiveSummary: string | undefined
): TaskCompletionSummary {
  const agentMap = new Map(config.agents.map(a => [a.id, a]));

  const contributions: AgentContribution[] = [];
  let currentRound = 1;
  let lastAgentId: string | undefined;

  for (const msg of state.messages) {
    if (msg._getType() !== 'ai') continue;
    const aiMsg = msg as AIMessage;
    const agentId = aiMsg.name ?? '';
    if (!agentId || !agentMap.has(agentId)) continue;

    const agent = agentMap.get(agentId)!;
    const content = extractTextFromContent(aiMsg.content);
    if (content.length === 0) continue;

    if (lastAgentId !== undefined && agentId !== lastAgentId) {
      currentRound++;
    }
    lastAgentId = agentId;

    const planStep = analysis.plan?.steps.find(s => s.agentId === agentId);
    const action =
      planStep?.action ??
      // eslint-disable-next-line security/detect-object-injection -- agentId from state.messages
      analysis.agentInstructions[agentId] ??
      agent.role;

    let excerpt = content.slice(0, 150).trim();
    if (content.length > 150) {
      const lastSpace = excerpt.lastIndexOf(' ');
      if (lastSpace > 80) {
        excerpt = excerpt.slice(0, lastSpace);
      }
      excerpt += '...';
    }

    contributions.push({
      agentId,
      agentName: agent.name,
      role: agent.role,
      action,
      excerpt,
      round: currentRound,
    });
  }

  return {
    executiveSummary: executiveSummary ?? analysis.plan?.description ?? 'Task completed.',
    contributions,
    metadata: {
      intent: analysis.intent,
      complexity: analysis.complexity,
      totalRounds: state.orchestratorRound + 1,
      maxRounds,
      ...(analysis.plan ? { planDescription: analysis.plan.description } : {}),
    },
  };
}

let conversationLlm: OrchestratorLLM | null = null;

/**
 * Handle an @Orchestrator mention by streaming a conversational response.
 * Uses the conversation.md prompt and emits start/token/complete events
 * with agentId = ORCHESTRATOR_AGENT_ID.
 */
async function handleOrchestratorConversation(
  state: OrchestrationStateType,
  orchestratorConfig: NonNullable<TeamConfig['orchestrator']>,
  config: TeamConfig,
  streamCallbackRef: StreamCallbackRef
): Promise<void> {
  const traceId = state.currentTraceId;
  const emit = streamCallbackRef.current;

  if (conversationLlm === null) {
    const routingConfig = {
      ...(orchestratorConfig.model !== undefined && orchestratorConfig.model.length > 0
        ? { model: orchestratorConfig.model }
        : {}),
      ...(orchestratorConfig.provider !== undefined
        ? { provider: orchestratorConfig.provider }
        : {}),
    };
    conversationLlm = await createOrchestratorLLM(routingConfig);
  }

  const lastHumanMessage = [...state.messages].reverse().find(m => m._getType() === 'human');
  const userMessage = extractTextFromContent(lastHumanMessage?.content);

  const agentDescriptions = config.agents
    .map(a => {
      const cap = getCapabilityTag(a);
      return `- @${a.id}: ${a.name} — ${a.role} ${cap}`;
    })
    .join('\n');

  const recentHistory = state.messages
    .slice(-10)
    .map(m => {
      const role = m._getType() === 'human' ? 'User' : ((m as AIMessage).name ?? 'Agent');
      const content = extractTextFromContent(m.content);
      return `${role}: ${content.slice(0, 300)}`;
    })
    .join('\n');

  const conversationPrompt = loadOrchestratorPrompt('conversation.md');
  const systemPrompt = `${conversationPrompt || 'You are the Orchestrator, an AI coordinator for this multi-agent group chat. Respond naturally and helpfully.'}

## Agents in This Chat
${agentDescriptions}

## Recent Conversation
${recentHistory || '(no prior messages)'}`;

  emit?.({ type: 'start', agentId: ORCHESTRATOR_AGENT_ID, traceId });
  const convUsageBefore = { ...conversationLlm.totalUsage };

  try {
    let fullContent = '';
    for await (const token of conversationLlm.stream(systemPrompt, userMessage)) {
      fullContent += token;
      emit?.({ type: 'token', agentId: ORCHESTRATOR_AGENT_ID, traceId, token });
    }

    const convUsageAfter = conversationLlm.totalUsage;
    const convDelta: import('../types.js').TokenUsage = {
      inputTokens: convUsageAfter.inputTokens - convUsageBefore.inputTokens,
      outputTokens: convUsageAfter.outputTokens - convUsageBefore.outputTokens,
      ...(convUsageAfter.cacheReadTokens ? { cacheReadTokens: (convUsageAfter.cacheReadTokens ?? 0) - (convUsageBefore.cacheReadTokens ?? 0) } : {}),
    };
    emit?.({ type: 'complete', agentId: ORCHESTRATOR_AGENT_ID, traceId, content: fullContent, tokenUsage: convDelta });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    emit?.({
      type: 'error',
      agentId: ORCHESTRATOR_AGENT_ID,
      traceId,
      error: {
        code: 'WORKER_EXECUTION',
        message: `Orchestrator conversation error: ${errorMsg}`,
        agentId: ORCHESTRATOR_AGENT_ID,
        recoverable: true,
      },
    });
  }
}

// ─── Team Leader Decision Node ───────────────────────────────────────

/**
 * Create the TL decision node. This is the core of the Team Leader feature.
 *
 * The TL decision node:
 * 1. Loads team-leader.md + current phase .md (swap-not-accumulate)
 * 2. Reads session ledger for context
 * 3. Calls TL LLM with composed prompt
 * 4. Validates response via tl-guardrails
 * 5. Executes actions (route, message, question, synthesize, etc.)
 * 6. Appends to ledger
 * 7. Returns state updates
 */
export function createTlDecisionNode(
  config: TeamConfig,
  streamCallbackRef: StreamCallbackRef,
  abortControllers: Map<string, AbortController>
): (state: OrchestrationStateType) => Promise<Partial<OrchestrationStateType>> {
  let llm: OrchestratorLLM | null = null;
  const tlConfig = config.teamLeader;
  const recentQuestions: string[] = [];
  let decisionCounter = 0;
  let artifactCounter = 0;

  return async (state: OrchestrationStateType): Promise<Partial<OrchestrationStateType>> => {
    const traceId = state.currentTraceId;
    const emit = streamCallbackRef.current;

    if (!tlConfig?.enabled) {
      return { isComplete: true };
    }

    // Handle @Orchestrator mentions — stream a conversational response
    const orchestratorMentioned = state.directedTo.includes(ORCHESTRATOR_AGENT_ID);
    if (orchestratorMentioned) {
      const orchestratorConfig = config.orchestrator;
      if (orchestratorConfig) {
        await handleOrchestratorConversation(state, orchestratorConfig, config, streamCallbackRef);
      }
      const otherTargets = state.directedTo.filter(id => id !== ORCHESTRATOR_AGENT_ID);
      if (otherTargets.length === 0) {
        return { isComplete: true };
      }
      // Continue with remaining targets via normal TL routing below
    }

    // Initialize LLM on first call
    if (llm === null) {
      const routingConfig = {
        ...(tlConfig.model !== undefined && tlConfig.model.length > 0 ? { model: tlConfig.model } : {}),
        ...(tlConfig.provider !== undefined ? { provider: tlConfig.provider } : {}),
      };
      llm = await createOrchestratorLLM(routingConfig);
    }

    // Initialize or retrieve budgets
    const budgets: TlBudgets = state.budgets ?? createDefaultBudgets();
    budgets.usedTlCycles++;

    // Hard budget stop — prevent infinite TL loops
    if (budgets.usedTlCycles > budgets.maxTlCycles) {
      debug('orchestrator', 'tl-budget-exceeded', {
        usedCycles: budgets.usedTlCycles,
        maxCycles: budgets.maxTlCycles,
      });
      const fallback = makeFallbackAnalysis(config);
      const route = buildRouteContexts(
        fallback.selectedAgents.map(id => ({
          agentId: id, reason: 'TL budget exceeded: broadcast', guidance: '',
        })),
        abortControllers, false,
      );
      return {
        orchestratorAnalysis: fallback,
        activeAgentId: route.activeAgentId,
        pendingAgents: route.pendingAgents,
        executionContexts: route.contexts,
        budgets,
        sessionLedgerPath: state.sessionLedgerPath,
        tlSeenMessageCount: state.messages.length,
        isComplete: true,
      };
    }

    // Simple messages (greetings) — skip TL LLM call entirely, just broadcast with brevity.
    // When user @tagged specific models, only route to those.
    const lastHuman = [...state.messages].reverse().find(m => m._getType() === 'human');
    const lastHumanText = extractTextFromContent(lastHuman?.content);
    if (budgets.usedTlCycles <= 1 && isSimpleMessage(lastHumanText)) {
      debug('tl', 'simple-message-bypass', { text: lastHumanText });
      const targets = state.directedTo.length > 0
        ? config.agents.filter(a => state.directedTo.includes(a.id))
        : config.agents;
      const route = buildRouteContexts(
        targets.map(a => ({ agentId: a.id, reason: 'Simple message: broadcast', guidance: '' })),
        abortControllers, true,
      );
      return {
        activeAgentId: route.activeAgentId,
        pendingAgents: route.pendingAgents,
        executionContexts: route.contexts,
        budgets,
        sessionLedgerPath: state.sessionLedgerPath,
        tlSeenMessageCount: state.messages.length,
        isComplete: true,
      };
    }

    // ── Satisfaction Response Detection ─────────────────────────────
    // When the user's message is a response to the confirmation gate
    // ("Looks good, thanks!" / "Go deeper" / "Different approach"),
    // handle it as a conversation control signal, not a new question.
    const isSatisfied = isSatisfactionResponse(lastHumanText);
    if (isSatisfied === 'satisfied') {
      debug('tl', 'satisfaction-detected', { text: lastHumanText.slice(0, 60) });
      return {
        budgets,
        sessionLedgerPath: state.sessionLedgerPath,
        tlSeenMessageCount: state.messages.length,
        isComplete: true,
      };
    }
    // "go deeper" / "different approach" — fall through to TL LLM so it re-routes

    // ── Strategy Detection ───────────────────────────────────────────
    // Detect user's strategy preference from their message content.
    // Strategy keywords appear when the user responds to the strategy gate question,
    // or when they've previously expressed a preference in conversation history.
    let detectedStrategy: 'discussion' | 'separate' | null = null;
    let updatedTaskLedger: import('../types.js').TaskLedger | null = state.taskLedger;

    const existingStrategy = state.taskLedger?.userPreferences?.find(
      p => p.startsWith('strategy:')
    );
    if (existingStrategy) {
      detectedStrategy = existingStrategy.replace('strategy:', '') as 'discussion' | 'separate';
    } else {
      // Check if the user's current message is a strategy selection response.
      // This works even when TL state resets between stream() calls.
      const lower = lastHumanText.toLowerCase();
      const isStrategyResponse = lower.includes('discussion') || lower.includes('debate')
        || lower.includes('separate task') || lower.includes('different angle');

      if (isStrategyResponse) {
        const isDiscussion = lower.includes('discussion') || lower.includes('debate')
          || lower.includes('opinion') || lower.includes('share');
        detectedStrategy = isDiscussion ? 'discussion' : 'separate';
        updatedTaskLedger = state.taskLedger ?? {
          goal: '', facts: [], unknowns: [], steps: [],
          agreedApproach: null, userPreferences: [], decisions: [],
        };
        updatedTaskLedger.userPreferences = [
          ...updatedTaskLedger.userPreferences.filter(p => !p.startsWith('strategy:')),
          `strategy:${detectedStrategy}`,
        ];

        debug('tl', 'strategy-detected', { userText: lastHumanText.slice(0, 80), strategy: detectedStrategy });
      }
    }

    // T072: Budget stall warning — debug only, not user-facing
    if (budgets.usedTlCycles >= budgets.maxTlCycles - 2) {
      debug('orchestrator', 'tl-budget-warning', {
        usedCycles: budgets.usedTlCycles,
        maxCycles: budgets.maxTlCycles,
      });
    }

    // T048: History window warning — only warn mid-conversation, not on first message
    const TL_MIN_HISTORY = 20;
    if (budgets.usedTlCycles === 1 && state.messages.length < TL_MIN_HISTORY && state.messages.length > 2) {
      debug('orchestrator', 'tl-low-history', { count: state.messages.length, min: TL_MIN_HISTORY });
    }

    // TL always gets the full prompt — its instructions are small (~3K chars)
    // and trimming by tier cripples orchestration for no meaningful token savings.
    const tier: import('../types.js').ContextTier = 'full';

    // Initialize session ledger on first cycle
    let ledgerPath = state.sessionLedgerPath;
    if (ledgerPath === null) {
      const sessionsDir = join(process.cwd(), '.cebus', 'sessions');
      // Cleanup expired ledgers on session start
      cleanupExpiredLedgers(sessionsDir);
      ledgerPath = createLedger({
        sessionId: state.sessionId,
        sessionsDir,
        chatMode: config.conversationMode,
        models: config.agents.map(a => a.name),
        goal: state.orchestratorAnalysis?.intent ?? 'General conversation',
        tier,
      });
    }

    // Compose prompt: team-leader.md + phase .md (swap-not-accumulate)
    const corePrompt = getTlCorePrompt(tier);
    const phasePrompt = getPhasePrompt(state.currentPhase, tier);
    const ledgerContent = readLedger(ledgerPath, tier);

    const agentDescriptions = config.agents.map(a => buildAgentDescription(a)).join('\n');

    // T056: TL Lite mode — single agent, simplified flow
    const isTlLite = config.agents.length <= 1;

    // Build state context for TL — show more content on round 2+ for synthesis
    const isFirstCycle = budgets.usedTlCycles <= 1;
    const msgLimit = isFirstCycle ? 300 : 1500;
    const msgCount = isFirstCycle ? 6 : 10;
    const lastMessages = state.messages.slice(-msgCount).map(m => {
      const role = m._getType() === 'human' ? 'User' : ((m as AIMessage).name ?? 'Agent');
      const content = extractTextFromContent(m.content);
      return `${role}: ${content.slice(0, msgLimit)}`;
    }).join('\n');

    const agentResponseCount = state.messages.filter(
      m => m._getType() === 'ai' && (m as AIMessage).name !== 'team-leader'
    ).length;

    // Detect if NEW worker responses arrived since last TL cycle — triggers synthesis.
    // Uses tlSeenMessageCount to avoid treating old responses as new.
    const newMessagesSinceLastCycle = state.messages.length - state.tlSeenMessageCount;
    const newWorkerResponses = newMessagesSinceLastCycle > 0
      ? state.messages.slice(-newMessagesSinceLastCycle).filter(
          m => m._getType() === 'ai' && (m as AIMessage).name !== 'team-leader'
        ).length
      : 0;
    const workerResponsesSinceLastRoute = !isFirstCycle && newWorkerResponses > 0;

    // ── Discussion Round 1 Shortcut ─────────────────────────────────
    // When user chose "discussion", route all agents with independent
    // opinion guidance. Skips TL LLM call for reliability.
    // Each model is told to give their own take without referencing others,
    // ensuring unbiased initial perspectives even in sequential mode.
    if (
      !workerResponsesSinceLastRoute &&
      detectedStrategy === 'discussion' &&
      budgets.usedWorkerRounds === 0
    ) {
      const userQuestion = extractTextFromContent(
        [...state.messages].reverse().find(m => m._getType() === 'human')?.content ?? ''
      );
      const discussionGuidance = `Share your honest, independent perspective on this question. Keep to 2-3 paragraphs. Do NOT reference or repeat what other models said — give YOUR unique take.\n\nQuestion: ${userQuestion}`;

      emit?.({
        type: 'tl_message',
        content: "Let's hear each model's independent take on this.",
        phase: 'execute',
        messageType: 'guidance',
      });

      budgets.usedWorkerRounds++;

      const route = buildRouteContexts(
        config.agents.map(a => ({
          agentId: a.id,
          reason: 'TL: discussion round 1',
          guidance: discussionGuidance,
        })),
        abortControllers, false,
      );

      emit?.({
        type: 'tl_routing_plan',
        assignments: config.agents.map(a => ({
          agentId: a.id,
          agentName: a.name,
          guidance: 'Share your independent perspective',
        })),
        parallel: true,
      });

      appendToLedger(ledgerPath, 'execute',
        `**Discussion round 1:** ${config.agents.map(a => `@${a.id}`).join(', ')}`);

      return {
        activeAgentId: route.activeAgentId,
        pendingAgents: route.pendingAgents,
        executionContexts: route.contexts,
        budgets,
        sessionLedgerPath: ledgerPath,
        tlSeenMessageCount: state.messages.length,
        isComplete: false,
        currentPhase: 'execute',
        previousPhase: state.currentPhase,
        ...(updatedTaskLedger !== state.taskLedger ? { taskLedger: updatedTaskLedger } : {}),
      };
    }

    // ── Deliberation Shortcut (Discussion mode) ──────────────────────
    // After discussion round 1, skip the TL LLM call and route a
    // deliberation round directly. More reliable than asking TL to
    // produce correct routing JSON for deliberation.
    if (
      workerResponsesSinceLastRoute &&
      detectedStrategy === 'discussion' &&
      budgets.usedWorkerRounds <= 1
    ) {
      const recentWorkerMsgs = state.messages
        .slice(state.tlSeenMessageCount)
        .filter(m => m._getType() === 'ai' && (m as AIMessage).name !== 'team-leader');

      const summaries = recentWorkerMsgs.map(m => {
        const ai = m as AIMessage;
        return `- @${ai.name ?? 'unknown'}: ${extractTextFromContent(ai.content).slice(0, 300)}`;
      }).join('\n');

      const deliberationGuidance = `The other models have shared their initial views:\n${summaries}\n\nReact to their perspectives. Where do you agree or disagree? What approach is strongest and why? Keep to 2-3 paragraphs.`;

      emit?.({
        type: 'tl_message',
        content: "Great initial perspectives! Now let's have each model react to the others' views and debate the strongest approach.",
        phase: 'deliberate',
        messageType: 'guidance',
      });

      budgets.usedWorkerRounds++;

      const route = buildRouteContexts(
        config.agents.map(a => ({
          agentId: a.id,
          reason: 'TL: deliberation round',
          guidance: deliberationGuidance,
        })),
        abortControllers, false,
      );

      emit?.({
        type: 'tl_routing_plan',
        assignments: config.agents.map(a => ({
          agentId: a.id,
          agentName: a.name,
          guidance: 'React to other models\' perspectives — agree, disagree, identify strongest approach',
        })),
        parallel: config.conversationMode !== 'sequential',
      });

      appendToLedger(ledgerPath, 'deliberate',
        `**Deliberation round:** ${config.agents.map(a => `@${a.id}`).join(', ')}`);

      return {
        activeAgentId: route.activeAgentId,
        pendingAgents: route.pendingAgents,
        executionContexts: route.contexts,
        budgets,
        sessionLedgerPath: ledgerPath,
        tlSeenMessageCount: state.messages.length,
        isComplete: false,
        currentPhase: 'deliberate',
        previousPhase: state.currentPhase,
        ...(updatedTaskLedger !== state.taskLedger ? { taskLedger: updatedTaskLedger } : {}),
      };
    }

    const analyzerContext = state.orchestratorAnalysis
      ? `Intent: ${state.orchestratorAnalysis.intent}\nComplexity: ${state.orchestratorAnalysis.complexity}`
      : '';

    // TL always needs project context for good routing — load independently of agent context level
    let projectContextContent = config.projectContext ?? '';
    if (projectContextContent.length === 0) {
      try {
        projectContextContent = readClaudeMd(findProjectRoot()) ?? '';
      } catch {
        // Non-critical — TL works without project context
      }
    }
    const projectContext = projectContextContent.length > 0
      ? `\n## Project Context\n${projectContextContent.slice(0, 2000)}`
      : '';

    const systemPrompt = `${corePrompt}
${phasePrompt ? `\n## Current Phase Skill\n${phasePrompt}` : ''}
${projectContext}

## Available Agents
${agentDescriptions}

## Agent IDs
${config.agents.map(a => a.id).join(', ')}

## State
Phase: ${state.currentPhase ?? 'initial'}
Chat Mode: ${config.conversationMode}
TL Cycle: ${budgets.usedTlCycles}/${budgets.maxTlCycles}
Worker Rounds: ${budgets.usedWorkerRounds}/${budgets.maxWorkerRounds}
Review Rounds: ${budgets.usedReviewRounds}/${budgets.maxReviewRounds}
Agent Responses: ${agentResponseCount}
${isTlLite ? 'Mode: TL Lite (single agent — skip deliberation/voting, use clarify + progress + self-review)' : ''}
${detectedStrategy ? `User Strategy: ${detectedStrategy === 'discussion' ? 'DISCUSSION — route ALL models with the SAME question, then have them debate/critique each other in a second round before synthesizing' : 'SEPARATE TASKS — assign DIFFERENT focused tasks to each model, then synthesize results'}` : ''}
Verbosity: ${tlConfig.verbosity ?? 'normal'}
${analyzerContext}

## Session Ledger
${ledgerContent || '(empty — first cycle)'}
${workerResponsesSinceLastRoute ? `
## ACTION REQUIRED: Workers Have Responded
The agents have finished responding. You MUST now respond with valid JSON containing a "synthesize" action.

REQUIRED RESPONSE FORMAT (respond with ONLY this JSON, no markdown, no explanation):
{"version":1,"actions":[{"type":"synthesize","scope":"full"},{"type":"complete","stopReason":"Synthesis delivered","deliverSynthesis":true}]}

Do NOT write the synthesis yourself. Do NOT respond with markdown. ONLY return the JSON above.
The system will automatically generate the synthesis from the agent responses.
` : ''}
## Recent Messages
${lastMessages || '(no messages yet)'}`;

    const lastHumanMessage = [...state.messages].reverse().find(m => m._getType() === 'human');
    const userMessage = extractTextFromContent(lastHumanMessage?.content) || '';

    const startTime = Date.now();

    try {
      // Check for user override first
      if (state.userOverride !== null) {
        const override = state.userOverride;
        emit?.({
          type: 'tl_interrupt',
          interruptType: override.type,
          target: override.target,
          previousPhase: state.currentPhase,
        });

        const overrideResult = handleUserOverride(override, state, config);
        appendToLedger(ledgerPath, state.currentPhase ?? 'execute',
          `**User Override:** ${override.type}${override.target ? ` → ${override.target}` : ''}`);

        return {
          ...overrideResult,
          userOverride: null,
          budgets,
          sessionLedgerPath: ledgerPath,
        };
      }

      // T066: Mid-flow abort — create AbortController for TL LLM call
      const tlAbortController = new AbortController();
      abortControllers.set('team-leader', tlAbortController);

      // T071: TL timeout handling — configurable timeout (default 30s)
      const tlTimeout = tlConfig.timeout ?? 30000;
      const timeoutId = setTimeout(() => tlAbortController.abort(), tlTimeout);

      // Call TL LLM — this is the slow path, show thinking indicator
      emit?.({ type: 'tl_thinking', active: true });
      let content: string;
      try {
        content = await invokeJSONOrStream(llm, systemPrompt, userMessage, {
          debugEnabled: process.env['CEBUS_ORCHESTRATOR_DEBUG'] === 'true',
          traceId,
          source: 'analyzer',
          emit,
        });
      } finally {
        clearTimeout(timeoutId);
        abortControllers.delete('team-leader');
      }

      // Parse and validate response
      const tlLatencyMs = Date.now() - startTime;
      let parsed: unknown;
      try {
        const jsonStr = extractOuterJson(content);
        parsed = jsonStr ? JSON.parse(jsonStr) : JSON.parse(content);
      } catch {
        // Retry once on invalid JSON
        debug('orchestrator', 'tl-json-parse-failed', { preview: content.slice(0, 200) });
        logTlDecision({
          cycle: budgets.usedTlCycles, phase: state.currentPhase ?? 'initial',
          systemPrompt, userMessage, rawResponse: content,
          fallback: 'JSON parse failed — retrying', latencyMs: tlLatencyMs,
        });
        const retryContent = await invokeJSONOrStream(llm, systemPrompt + '\n\nIMPORTANT: You MUST respond with valid JSON. Your previous response was not valid JSON.', userMessage, {
          debugEnabled: false, traceId, source: 'analyzer', emit,
        });
        try {
          const jsonStr = extractOuterJson(retryContent);
          parsed = jsonStr ? JSON.parse(jsonStr) : JSON.parse(retryContent);
        } catch {
          // Fallback to analyzer routing
          debug('orchestrator', 'tl-json-fallback', { message: 'TL response was not valid JSON — falling back to analyzer routing' });
          logTlDecision({
            cycle: budgets.usedTlCycles, phase: state.currentPhase ?? 'initial',
            systemPrompt, userMessage, rawResponse: retryContent,
            fallback: 'JSON retry also failed — broadcast fallback', latencyMs: Date.now() - startTime,
          });
          // If workers already responded and TL returned non-JSON, treat the raw text
          // as a direct synthesis attempt — the TL tried to synthesize but skipped the JSON wrapper.
          if (workerResponsesSinceLastRoute) {
            debug('tl', 'non-json-synthesis-fallback', { preview: retryContent.slice(0, 200) });
            const contributors = [...new Set(
              state.messages
                .filter(m => m._getType() === 'ai' && (m as AIMessage).name !== 'team-leader')
                .map(m => (m as AIMessage).name ?? 'unknown')
            )];
            emit?.({
              type: 'tl_synthesis',
              unified_output: retryContent,
              contributors,
            });
            return {
              budgets,
              sessionLedgerPath: ledgerPath,
              tlSeenMessageCount: state.messages.length,
              currentPhase: 'synthesize' as TlPhase,
              isComplete: true,
            };
          }
          const fallback = makeFallbackAnalysis(config);
          const route = buildRouteContexts(
            fallback.selectedAgents.map(id => ({
              agentId: id, reason: 'TL JSON fallback: broadcast', guidance: '',
            })),
            abortControllers, false,
          );
          return {
            orchestratorAnalysis: fallback,
            activeAgentId: route.activeAgentId,
            pendingAgents: route.pendingAgents,
            executionContexts: route.contexts,
            budgets,
            sessionLedgerPath: ledgerPath,
            tlSeenMessageCount: state.messages.length,
            isComplete: false,
          };
        }
      }

      // Normalize common LLM field name mistakes before validation
      normalizeTlActions(parsed);

      // Check if agent has responded (for state guards)
      const hasAgentResponded = state.messages.some(
        m => m._getType() === 'ai' && (m as AIMessage).name !== 'team-leader'
      );

      const validation = validateTlResponse(
        parsed, config, state.currentPhase, budgets, hasAgentResponded, recentQuestions
      );

      if (!validation.valid || validation.sanitizedResponse === null) {
        debug('orchestrator', 'tl-validation-errors', { errors: validation.errors, cycle: budgets.usedTlCycles });
        logTlDecision({
          cycle: budgets.usedTlCycles, phase: state.currentPhase ?? 'initial',
          systemPrompt, userMessage, rawResponse: content,
          fallback: `Validation failed: ${validation.errors.join('; ')}`, latencyMs: tlLatencyMs,
        });
        // If workers already responded and TL validation failed, try to extract usable
        // content from the raw response as a synthesis fallback.
        if (workerResponsesSinceLastRoute) {
          debug('tl', 'validation-fail-synthesis-fallback', { preview: content.slice(0, 200) });
          // Check if the raw content looks like a synthesis attempt (non-trivial text)
          if (content.length > 50) {
            const contributors = [...new Set(
              state.messages
                .filter(m => m._getType() === 'ai' && (m as AIMessage).name !== 'team-leader')
                .map(m => (m as AIMessage).name ?? 'unknown')
            )];
            emit?.({
              type: 'tl_synthesis',
              unified_output: content,
              contributors,
            });
          }
          return {
            budgets,
            sessionLedgerPath: ledgerPath,
            tlSeenMessageCount: state.messages.length,
            currentPhase: 'synthesize' as TlPhase,
            isComplete: true,
          };
        }
        const fallback = makeFallbackAnalysis(config);
        const route = buildRouteContexts(
          fallback.selectedAgents.map(id => ({
            agentId: id, reason: 'TL validation fallback: broadcast', guidance: '',
          })),
          abortControllers, false,
        );
        return {
          orchestratorAnalysis: fallback,
          activeAgentId: route.activeAgentId,
          pendingAgents: route.pendingAgents,
          executionContexts: route.contexts,
          budgets,
          sessionLedgerPath: ledgerPath,
          tlSeenMessageCount: state.messages.length,
        };
      }

      const tlResponse = validation.sanitizedResponse;

      // Log TL decision to .cebus/team-leader.md
      logTlDecision({
        cycle: budgets.usedTlCycles, phase: state.currentPhase ?? 'initial',
        systemPrompt, userMessage, rawResponse: content,
        parsedActions: tlResponse.actions, latencyMs: tlLatencyMs,
      });

      // Emit metrics
      const latencyMs = Date.now() - startTime;
      emit?.({
        type: 'tl_metrics',
        tlCycle: budgets.usedTlCycles,
        tokensIn: estimateTokenCount(systemPrompt + userMessage),
        tokensOut: estimateTokenCount(content),
        latencyMs,
        phase: state.currentPhase ?? 'clarify',
      });

      // Debug: log TL actions for diagnosis
      debug('tl', 'tl-actions', {
        cycle: budgets.usedTlCycles,
        actions: tlResponse.actions.map(a => ({
          type: a.type,
          ...(a.type === 'route_agent' ? { targetAgent: a.targetAgent } : {}),
          ...(a.type === 'parallel_route' ? { targets: a.targets?.map((t: { agentId: string }) => t.agentId) } : {}),
        })),
      });

      // Execute actions
      const result = await executeTlActions(
        tlResponse, state, config, budgets, ledgerPath, tier,
        emit, traceId, abortControllers, recentQuestions,
        decisionCounter, artifactCounter,
        (n) => { decisionCounter = n; },
        (n) => { artifactCounter = n; },
        llm!
      );

      // TL done thinking — clear indicator before emitting results
      emit?.({ type: 'tl_thinking', active: false });

      // T068: Compact ledger if over budget
      compactLedger(ledgerPath, tier);

      // ── Strategy Gate ──────────────────────────────────────────────
      // On the first routing cycle for non-simple messages, intercept
      // the routing and ask the user how they want the team to work.
      // This ensures the user picks "discussion" or "separate tasks"
      // BEFORE any agents are dispatched.
      const hasRoutingResult = result.activeAgentId !== undefined
        && result.activeAgentId !== null
        && result.activeAgentId.length > 0;
      const alreadyAskingUser = result.currentPhase === 'ask_user';
      const userAlreadyChoseStrategy = detectedStrategy !== null
        || (state.taskLedger?.userPreferences?.some(p => p.startsWith('strategy:')) ?? false);
      // Skip strategy gate on follow-up messages (conversation history present).
      // If there are prior AI responses in the message list, this is a continuation.
      const isFollowUp = state.messages.slice(0, -1).some(
        m => m._getType() === 'ai' && (m as AIMessage).name !== 'team-leader'
      );
      // Skip when user @tagged specific models — they want those models, not a team discussion.
      const isDirected = state.directedTo.length > 0;

      if (
        budgets.usedTlCycles === 1 &&
        !isSimpleMessage(lastHumanText) &&
        hasRoutingResult &&
        !alreadyAskingUser &&
        !userAlreadyChoseStrategy &&
        !isFollowUp &&
        !isDirected &&
        config.agents.length > 1
      ) {
        debug('tl', 'strategy-gate-intercept', { cycle: budgets.usedTlCycles });

        // Keep any message actions already emitted (plan announcement),
        // but strip the routing — user hasn't approved yet
        result.activeAgentId = null;
        result.pendingAgents = [];
        result.executionContexts = {};

        emit?.({
          type: 'tl_awaiting_input',
          question: 'How would you like the team to approach this?',
          options: [
            'Discussion — models share opinions, debate, and build on each other',
            'Separate tasks — each model focuses on a different angle',
          ],
          inputType: 'choice',
        });

        appendToLedger(ledgerPath, 'ask_user',
          '**Strategy question:** Discussion vs Separate tasks');

        result.isComplete = true;
        result.previousPhase = state.currentPhase;
        result.currentPhase = 'ask_user';
      }

      // ── User Confirmation Gate ─────────────────────────────────────
      // After synthesis, ask the user if satisfied instead of auto-completing.
      // Skip for directed messages — user wanted a specific model, not a team flow.
      if (
        result.isComplete === true &&
        workerResponsesSinceLastRoute &&
        !isSimpleMessage(lastHumanText) &&
        config.agents.length > 1 &&
        result.currentPhase !== 'ask_user' &&
        state.directedTo.length === 0
      ) {
        emit?.({
          type: 'tl_awaiting_input',
          question: 'Are you satisfied with this analysis, or would you like the team to explore further?',
          options: [
            'Looks good, thanks!',
            'Go deeper on some points',
            'Different approach',
          ],
          inputType: 'choice',
        });
        result.currentPhase = 'ask_user';
      }

      // Persist taskLedger with strategy preference if detected
      if (updatedTaskLedger !== state.taskLedger) {
        result.taskLedger = updatedTaskLedger;
      }

      return result;
    } catch (err) {
      emit?.({ type: 'tl_thinking', active: false });
      debug('orchestrator', 'tl-decision-error', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Error already logged via debug above — don't show internal errors to users

      // Fallback — broadcast to all agents with execution contexts
      const fallback = makeFallbackAnalysis(config);
      const route = buildRouteContexts(
        fallback.selectedAgents.map(id => ({
          agentId: id, reason: 'TL error fallback: broadcast', guidance: '',
        })),
        abortControllers, false,
      );
      return {
        orchestratorAnalysis: fallback,
        activeAgentId: route.activeAgentId,
        pendingAgents: route.pendingAgents,
        executionContexts: route.contexts,
        budgets,
        sessionLedgerPath: ledgerPath,
        tlSeenMessageCount: state.messages.length,
      };
    }
  };
}

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Lightweight heuristic to detect simple/greeting messages without an LLM call. */
function isSimpleMessage(text: string): boolean {
  if (text.length > 120) return false;
  const words = text.trim().split(/\s+/);
  if (words.length > 15) return false;
  const lower = text.toLowerCase().trim();
  const greetings = /^(hi|hello|hey|yo|sup|howdy|greetings|good\s+(morning|afternoon|evening)|thanks|thank\s+you|bye|goodbye|see\s+ya|cheers|ok|okay|sure|yes|no|yeah|nah|cool|nice|great|lol|haha|hmm|huh|wow|what'?s\s+up|wh?ats\s+up|wassup|looks?\s+good|that'?s?\s+(good|great|enough|all|it))\b/;
  return greetings.test(lower);
}

/**
 * Detect if a user message is a satisfaction/confirmation response
 * to the TL's "Are you satisfied?" prompt.
 * Returns 'satisfied' to end, 'unsatisfied' to continue, or null if not a response.
 */
function isSatisfactionResponse(text: string): 'satisfied' | 'unsatisfied' | null {
  if (text.length > 150) return null;
  const lower = text.toLowerCase().trim();

  // Positive (satisfied) — matches the exact options + common variations
  const satisfied = /^(looks?\s+good|that'?s?\s+(good|great|enough|all|it)|i'?m?\s+satisf|satisf|perfect|done|finish|wrap|good\s+(job|work|enough)|no\s+(more|further)|all\s+(good|set|done)|move\s+on|end\s+it|stop)/;
  if (satisfied.test(lower)) return 'satisfied';

  // Negative (wants more) — matches "go deeper", "different approach", etc.
  const unsatisfied = /^(go\s+deep|deep|different|more|another|keep\s+go|continu|explore|expand|dig\s+deep|not\s+(satisf|enough|done)|try\s+again|redo)/;
  if (unsatisfied.test(lower)) return 'unsatisfied';

  return null;
}

function handleUserOverride(
  override: NonNullable<OrchestrationStateType['userOverride']>,
  state: OrchestrationStateType,
  config: TeamConfig
): Partial<OrchestrationStateType> {
  switch (override.type) {
    case 'stop':
      return { isComplete: true, currentPhase: null };
    case 'restart':
      return {
        currentPhase: null,
        previousPhase: null,
        tlCycle: 0,
        taskLedger: null,
        progressLedger: null,
        discussionHistory: null,
      };
    case 'skip_phase': {
      const targetPhase = (override.target ?? 'synthesize') as TlPhase;
      return {
        previousPhase: state.currentPhase,
        currentPhase: targetPhase,
      };
    }
    case 'force_phase': {
      const targetPhase = (override.target ?? 'execute') as TlPhase;
      return {
        previousPhase: state.currentPhase,
        currentPhase: targetPhase,
      };
    }
    case 'switch_agent': {
      const targetAgent = override.target;
      const agent = config.agents.find(
        a => a.id === targetAgent || a.name.toLowerCase() === targetAgent?.toLowerCase()
      );
      if (agent) {
        return {
          activeAgentId: agent.id,
          pendingAgents: [],
          isComplete: false,
        };
      }
      return {};
    }
    default:
      return {};
  }
}

interface RouteTarget {
  agentId: string;
  reason: string;
  guidance?: string | undefined;
  timeoutMs?: number | undefined;
}

function buildRouteContexts(
  targets: RouteTarget[],
  abortControllers: Map<string, AbortController>,
  isSimple: boolean,
): { contexts: Record<string, ExecutionContext>; activeAgentId: string; pendingAgents: string[] } {
  const contexts: Record<string, ExecutionContext> = {};
  for (const t of targets) {
    const ctrl = new AbortController();
    abortControllers.set(t.agentId, ctrl);
    // eslint-disable-next-line security/detect-object-injection -- agentId from validated routing
    contexts[t.agentId] = {
      activeAgentId: t.agentId,
      allowedTools: ['*'],
      routingReason: t.reason,
      timeoutBudget: t.timeoutMs ?? 120000,
      cancellationToken: ctrl.signal,
      ...(isSimple
        ? { orchestratorGuidance: 'Keep your response to 1-2 sentences. Be brief and natural.' }
        : t.guidance ? { orchestratorGuidance: t.guidance } : {}),
    };
  }
  return {
    contexts,
    activeAgentId: targets[0]!.agentId,
    pendingAgents: targets.slice(1).map(t => t.agentId),
  };
}

async function executeTlActions(
  tlResponse: TlResponse,
  state: OrchestrationStateType,
  config: TeamConfig,
  budgets: TlBudgets,
  ledgerPath: string,
  _tier: string,
  emit: ((event: import('../types.js').OrchestrationStreamEvent) => void) | undefined,
  _traceId: string,
  abortControllers: Map<string, AbortController>,
  recentQuestions: string[],
  _decisionCounter: number,
  artifactCounter: number,
  _setDecisionCounter: (n: number) => void,
  setArtifactCounter: (n: number) => void,
  llm: OrchestratorLLM
): Promise<Partial<OrchestrationStateType>> {
  const stateUpdates: Partial<OrchestrationStateType> = {
    budgets,
    sessionLedgerPath: ledgerPath,
    // Reset routing state — TL is now the authority on routing.
    // Without this, stale activeAgentId from the analyzer leaks through
    // when TL decides not to route (e.g. direct message + complete).
    activeAgentId: null,
    pendingAgents: [],
    executionContexts: {},
    // Record how many messages TL has seen so the next cycle can detect new worker responses
    tlSeenMessageCount: state.messages.length,
  };

  const newArtifacts: Artifact[] = [];

  // For simple messages (greetings, one-liners), suppress TL UI noise —
  // just route and complete without showing routing plans or guidance
  // Detect simple tasks without an LLM call — short messages with no special structure
  const isSimple = state.orchestratorAnalysis?.complexity === 'simple'
    || isSimpleMessage(extractTextFromContent(
      [...state.messages].reverse().find(m => m._getType() === 'human')?.content
    ));

  // When user @tagged specific models, restrict TL routing to only those agents
  const directedAgents = state.directedTo.length > 0
    ? new Set(state.directedTo.filter(id => config.agents.some(a => a.id === id)))
    : null;

  // Detect if TL is trying to answer directly (message+complete, no routing).
  // TL is a coordinator — it should route to agents, not answer user questions.
  const hasRouting = tlResponse.actions.some(
    a => a.type === 'route_agent' || a.type === 'parallel_route' || a.type === 'request_review'
  );
  const hasMessageAndComplete = tlResponse.actions.some(a => a.type === 'message')
    && tlResponse.actions.some(a => a.type === 'complete');
  if (!hasRouting && hasMessageAndComplete) {
    debug('tl', 'tl-direct-answer-fallback', {
      reason: 'TL tried message+complete with no routing — falling back to broadcast',
    });
    const route = buildRouteContexts(
      config.agents.map(a => ({ agentId: a.id, reason: 'TL fallback: broadcast', guidance: '' })),
      abortControllers, isSimple,
    );
    return {
      ...stateUpdates,
      activeAgentId: route.activeAgentId,
      pendingAgents: route.pendingAgents,
      executionContexts: route.contexts,
      isComplete: false,
    };
  }

  for (const action of tlResponse.actions) {
    switch (action.type) {
      case 'message': {
        // Skip TL guidance messages for simple tasks (no "Let me have the team introduce themselves")
        if (isSimple) break;

        // Emit TL message as visible AIMessage
        emit?.({
          type: 'tl_message',
          content: action.content,
          phase: action.phase,
          messageType: 'guidance',
        });

        // Phase transition
        if (action.phase !== state.currentPhase) {
          emit?.({
            type: 'tl_phase_change',
            from: state.currentPhase,
            to: action.phase,
            reason: 'TL message in new phase',
          });
          stateUpdates.previousPhase = state.currentPhase;
          stateUpdates.currentPhase = action.phase;
        }

        appendToLedger(ledgerPath, action.phase, `**TL:** ${action.content.slice(0, 200)}`);
        break;
      }

      case 'question': {
        recentQuestions.push(action.content);
        // Only emit tl_awaiting_input — the UI prompt already shows the question
        emit?.({
          type: 'tl_awaiting_input',
          question: action.content,
          options: action.options,
          inputType: action.inputType,
        });

        appendToLedger(ledgerPath, 'ask_user', `**TL asked:** ${action.content}`);

        // End graph — user's answer will come as next message
        stateUpdates.isComplete = true;
        stateUpdates.previousPhase = state.currentPhase;
        stateUpdates.currentPhase = 'ask_user';
        break;
      }

      case 'summary': {
        emit?.({
          type: 'tl_summary',
          proposals: {},
          differences: [],
          recommendation: `${action.progress} → Next: ${action.nextStep}`,
        });
        appendToLedger(ledgerPath, state.currentPhase ?? 'execute',
          `**Progress:** ${action.progress}\n**Next:** ${action.nextStep}`);
        break;
      }

      case 'route_agent': {
        budgets.usedWorkerRounds++;

        // When user @tagged specific models, only route to those — ignore TL's choice
        if (directedAgents !== null) {
          const ids = [...directedAgents];
          const route = buildRouteContexts(
            ids.map(id => ({ agentId: id, reason: `TL: @mention → ${id}`, guidance: action.guidance })),
            abortControllers, isSimple,
          );
          Object.assign(stateUpdates, {
            activeAgentId: route.activeAgentId,
            pendingAgents: route.pendingAgents,
            executionContexts: route.contexts,
            isComplete: false,
          });

          emit?.({
            type: 'tl_routing_plan',
            assignments: ids.map(id => {
              const agent = config.agents.find(a => a.id === id);
              return { agentId: id, agentName: agent?.name ?? id, guidance: action.guidance };
            }),
            parallel: false,
          });
          break;
        }

        // In group chat with no @tag, broadcast to ALL agents —
        // route_agent should not silently drop participants
        if (config.agents.length > 1) {
          const route = buildRouteContexts(
            config.agents.map(a => ({ agentId: a.id, reason: 'TL: broadcast', guidance: action.guidance })),
            abortControllers, isSimple,
          );
          Object.assign(stateUpdates, {
            activeAgentId: route.activeAgentId,
            pendingAgents: route.pendingAgents,
            executionContexts: route.contexts,
            isComplete: false,
          });

          emit?.({
            type: 'tl_routing_plan',
            assignments: config.agents.map(a => ({
              agentId: a.id,
              agentName: a.name,
              guidance: action.guidance,
            })),
            parallel: false,
          });
          break;
        }

        const controller = new AbortController();
        abortControllers.set(action.targetAgent, controller);

        stateUpdates.activeAgentId = action.targetAgent;
        stateUpdates.pendingAgents = [];
        stateUpdates.executionContexts = {
          [action.targetAgent]: {
            activeAgentId: action.targetAgent,
            allowedTools: ['*'],
            routingReason: `TL: ${action.guidance.slice(0, 100)}`,
            timeoutBudget: 120000,
            cancellationToken: controller.signal,
            orchestratorGuidance: action.guidance,
          },
        };
        stateUpdates.isComplete = false;

        // Emit routing plan so CLI can show what the TL asked
        const routeAgent = config.agents.find(a => a.id === action.targetAgent);
        emit?.({
          type: 'tl_routing_plan',
          assignments: [{
            agentId: action.targetAgent,
            agentName: routeAgent?.name ?? action.targetAgent,
            guidance: action.guidance,
          }],
          parallel: false,
        });

        if (action.phase !== state.currentPhase) {
          emit?.({
            type: 'tl_phase_change',
            from: state.currentPhase,
            to: action.phase,
            reason: `Routing to ${action.targetAgent}`,
          });
          stateUpdates.previousPhase = state.currentPhase;
          stateUpdates.currentPhase = action.phase;
        }

        appendToLedger(ledgerPath, action.phase,
          `**Route:** @${action.targetAgent} — ${action.guidance.slice(0, 100)}`);
        break;
      }

      case 'synthesize': {
        // Collect agent responses for synthesis
        const agentMessages = state.messages
          .filter(m => m._getType() === 'ai' && (m as AIMessage).name !== 'team-leader')
          .map(m => {
            const ai = m as AIMessage;
            return { agent: ai.name ?? 'unknown', content: extractTextFromContent(ai.content) };
          });

        const contributors = [...new Set(agentMessages.map(m => m.agent))];

        // Use TL LLM to produce an actual synthesis instead of raw concatenation
        let unified: string;
        try {
          const synthPrompt = `You are synthesizing multiple model responses into ONE unified answer for the user.

RULES:
- Do NOT repeat what each model said verbatim
- Extract the KEY INSIGHTS and combine them into a clear, concise answer
- If models agree, state the consensus once
- If models disagree, present the different perspectives briefly
- Keep it shorter than any individual response
- Use markdown formatting for readability
- No code unless the user specifically asked for code

User's question: ${extractTextFromContent([...state.messages].reverse().find(m => m._getType() === 'human')?.content ?? '')}

Model responses:
${agentMessages.map(m => `### ${m.agent}\n${m.content.slice(0, 1500)}`).join('\n\n')}

Write the unified synthesis now:`;

          unified = await llm.invoke('You are a synthesis assistant. Return only plain text, no JSON wrapping.', synthPrompt);
        } catch {
          // Fallback: brief summary if LLM call fails
          unified = agentMessages.map(m => `**${m.agent}**: ${m.content.slice(0, 200)}...`).join('\n\n');
        }

        emit?.({
          type: 'tl_synthesis',
          unified_output: unified,
          contributors,
        });

        artifactCounter++;
        setArtifactCounter(artifactCounter);
        newArtifacts.push({
          id: `ART-${String(artifactCounter).padStart(3, '0')}`,
          type: 'synthesis',
          author: 'team-leader',
          status: 'draft',
          createdAt: Date.now(),
          contentRef: `synthesis-cycle-${budgets.usedTlCycles}`,
        });

        stateUpdates.previousPhase = state.currentPhase;
        stateUpdates.currentPhase = 'synthesize';
        appendToLedger(ledgerPath, 'synthesize',
          `**Synthesis:** ${contributors.join(', ')} → unified output`);
        break;
      }

      case 'complete': {
        // If workers were dispatched in this same action batch (e.g. parallel_route + complete),
        // defer completion for non-simple tasks — let workers run and TL will get another round to synthesize.
        // Simple tasks (greetings) complete immediately after workers — no synthesis needed.
        const workersDispatched = stateUpdates.activeAgentId !== undefined
          && stateUpdates.activeAgentId !== null
          && stateUpdates.activeAgentId.length > 0;
        if (workersDispatched && !isSimple) {
          debug('tl', 'Deferring complete — workers dispatched, TL will get synthesis round');
          break;
        }

        // Mark complete — for simple tasks with workers dispatched, this ensures
        // the graph exits after workers finish (worker→END) instead of looping
        // back to tl_decision for an unnecessary synthesis LLM call.
        stateUpdates.isComplete = true;
        stateUpdates.currentPhase = null;

        // deliverSynthesis is handled by the synthesize action — no extra message needed

        appendToLedger(ledgerPath, state.currentPhase ?? 'execute',
          `**Complete:** ${action.stopReason}`);
        break;
      }

      case 'vote_request': {
        emit?.({
          type: 'tl_awaiting_input',
          question: action.topic,
          options: action.options,
          inputType: 'choice',
        });

        appendToLedger(ledgerPath, state.currentPhase ?? 'execute', `**Vote:** ${action.topic}`);

        // End graph — user's vote will come as next message
        stateUpdates.isComplete = true;
        stateUpdates.previousPhase = state.currentPhase;
        stateUpdates.currentPhase = 'ask_user';
        break;
      }

      case 'request_review': {
        budgets.usedReviewRounds++;
        const controller = new AbortController();
        abortControllers.set(action.targetAgent, controller);

        stateUpdates.activeAgentId = action.targetAgent;
        stateUpdates.pendingAgents = [];
        stateUpdates.executionContexts = {
          [action.targetAgent]: {
            activeAgentId: action.targetAgent,
            allowedTools: ['*'],
            routingReason: `TL Review: ${action.criteria.join(', ').slice(0, 100)}`,
            timeoutBudget: 120000,
            cancellationToken: controller.signal,
            orchestratorGuidance: `Review the previous output against these criteria:\n${action.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
          },
        };
        stateUpdates.isComplete = false;
        stateUpdates.previousPhase = state.currentPhase;
        stateUpdates.currentPhase = 'review';

        appendToLedger(ledgerPath, 'review',
          `**Review:** @${action.targetAgent} — ${action.criteria.join(', ')}`);
        break;
      }

      case 'pause': {
        if (action.needsUserInput) {
          emit?.({
            type: 'tl_awaiting_input',
            question: action.reason,
            inputType: 'freeform',
          });

          appendToLedger(ledgerPath, state.currentPhase ?? 'execute', `**Paused:** ${action.reason}`);

          // End graph — user's response will come as next message
          stateUpdates.isComplete = true;
          stateUpdates.previousPhase = state.currentPhase;
          stateUpdates.currentPhase = 'ask_user';
        }
        break;
      }

      case 'parallel_route': {
        // T066: Parallel dispatch via Send() — set up all targets
        if (action.targets.length > 0) {
          // When user @tagged specific models, filter targets to only those
          const effectiveTargets = directedAgents !== null
            ? action.targets.filter(t => directedAgents.has(t.agentId))
            : action.targets;
          // If none of TL's targets match directedTo, route to directed agents directly
          let finalTargets = effectiveTargets.length > 0
            ? effectiveTargets
            : directedAgents !== null
              ? [...directedAgents].map(id => ({
                  agentId: id,
                  guidance: action.targets[0]?.guidance ?? 'Respond to the user',
                }))
              : [];

          // For group chat with no @tag, ensure ALL agents are included —
          // TL sometimes omits agents from parallel_route targets
          if (directedAgents === null && finalTargets.length < config.agents.length) {
            const targetIds = new Set(finalTargets.map(t => t.agentId));
            const defaultGuidance = action.targets[0]?.guidance ?? 'Respond to the user';
            for (const agent of config.agents) {
              if (!targetIds.has(agent.id)) {
                finalTargets.push({ agentId: agent.id, guidance: defaultGuidance });
              }
            }
          }

          if (finalTargets.length === 0) break;

          budgets.usedWorkerRounds++;

          const route = buildRouteContexts(
            finalTargets.map(t => ({
              agentId: t.agentId,
              reason: `TL parallel: ${t.guidance.slice(0, 50)}`,
              guidance: t.guidance,
              timeoutMs: action.timeoutMs,
            })),
            abortControllers, isSimple,
          );
          Object.assign(stateUpdates, {
            activeAgentId: route.activeAgentId,
            pendingAgents: route.pendingAgents,
            executionContexts: route.contexts,
            isComplete: false,
          });

          // Emit routing plan so UI/CLI can show what each model is asked to do
          emit?.({
            type: 'tl_routing_plan',
            assignments: finalTargets.map(t => {
              const agent = config.agents.find(a => a.id === t.agentId);
              return {
                agentId: t.agentId,
                agentName: agent?.name ?? t.agentId,
                guidance: t.guidance,
              };
            }),
            parallel: config.conversationMode !== 'sequential' && finalTargets.length > 1,
          });

          const dispatchLabel = config.conversationMode === 'sequential'
            ? '**Sequential dispatch:**'
            : '**Parallel:**';
          appendToLedger(ledgerPath, state.currentPhase ?? 'execute',
            `${dispatchLabel} ${finalTargets.map(t => `@${t.agentId}`).join(', ')}`);
        }
        break;
      }

      case 'inspect_history': {
        // Deep read — load full conversation history for TL context (Full+ tier only)
        const historyDump = state.messages.map(m => {
          const role = m._getType() === 'human' ? 'User' : ((m as AIMessage).name ?? 'Agent');
          const content = extractTextFromContent(m.content);
          return `[${role}]: ${content.slice(0, 500)}`;
        }).join('\n');

        appendToLedger(ledgerPath, state.currentPhase ?? 'execute',
          `**Inspect:** ${action.query}\n**History snapshot** (${state.messages.length} messages):\n${historyDump.slice(0, 2000)}`);
        break;
      }
    }
  }

  if (newArtifacts.length > 0) {
    stateUpdates.artifacts = newArtifacts;
  }

  // For simple tasks, mark complete when workers are dispatched — skip the
  // post-worker TL round-trip (worker → tl_decision → synthesis LLM call).
  // Workers respond directly to the user; no synthesis is needed for greetings etc.
  if (
    isSimple &&
    stateUpdates.activeAgentId !== undefined &&
    stateUpdates.activeAgentId !== null &&
    stateUpdates.activeAgentId.length > 0 &&
    stateUpdates.isComplete !== true
  ) {
    stateUpdates.isComplete = true;
  }

  // Safety net: if workers are being dispatched with no @tag, ensure ALL agents are included.
  // TL LLM sometimes omits agents — this guarantees group chat broadcast.
  if (
    directedAgents === null &&
    config.agents.length > 1 &&
    stateUpdates.activeAgentId !== undefined &&
    stateUpdates.activeAgentId !== null &&
    stateUpdates.activeAgentId.length > 0 &&
    stateUpdates.executionContexts !== undefined
  ) {
    const dispatched = new Set([
      stateUpdates.activeAgentId,
      ...(stateUpdates.pendingAgents ?? []),
    ]);
    const missing = config.agents.filter(a => !dispatched.has(a.id));
    if (missing.length > 0) {
      debug('tl', 'broadcast-backfill', { missing: missing.map(a => a.id) });
      for (const agent of missing) {
        const ctrl = new AbortController();
        abortControllers.set(agent.id, ctrl);
        stateUpdates.executionContexts[agent.id] = {
          activeAgentId: agent.id,
          allowedTools: ['*'],
          routingReason: 'TL: broadcast backfill',
          timeoutBudget: 120000,
          cancellationToken: ctrl.signal,
        };
      }
      stateUpdates.pendingAgents = [
        ...(stateUpdates.pendingAgents ?? []),
        ...missing.map(a => a.id),
      ];
    }
  }

  return stateUpdates;
}

// --- Zod schemas for orchestrator LLM response validation ---

const PlanStepSchema = z.object({
  agentId: z.string().max(64).default(''),
  action: z.string().max(500).default(''),
  dependsOn: z.number().optional(),
});

type EstimatedCost = 'low' | 'medium' | 'high';

const COST_MAP: Record<string, EstimatedCost> = {
  low: 'low', cheap: 'low', minimal: 'low', small: 'low',
  medium: 'medium', moderate: 'medium', normal: 'medium', average: 'medium',
  high: 'high', expensive: 'high', large: 'high',
};

function normalizeCost(value: unknown): EstimatedCost {
  if (typeof value !== 'string') return 'medium';
  return COST_MAP[value.toLowerCase().trim()] ?? 'medium';
}

const PlanSchema = z.object({
  description: z.string().max(2000).default(''),
  steps: z.array(PlanStepSchema).max(20).default([]),
  estimatedRounds: z.number().int().min(1).max(10).default(1),
  estimatedCost: z.unknown().transform(normalizeCost).default('medium'),
});

type Complexity = 'simple' | 'moderate' | 'complex';

const COMPLEXITY_MAP: Record<string, Complexity> = {
  simple: 'simple', easy: 'simple', trivial: 'simple', basic: 'simple', low: 'simple',
  moderate: 'moderate', medium: 'moderate', normal: 'moderate', average: 'moderate',
  complex: 'complex', hard: 'complex', difficult: 'complex', advanced: 'complex', high: 'complex',
};

function normalizeComplexity(value: unknown): Complexity {
  if (typeof value !== 'string') return 'moderate';
  return COMPLEXITY_MAP[value.toLowerCase().trim()] ?? 'moderate';
}

const AnalyzerResponseSchema = z.object({
  intent: z.string().max(200).default('general'),
  complexity: z.unknown().transform(normalizeComplexity),
  safetyFlags: z.array(z.string().max(100)).max(10).default([]),
  selectedAgents: z.array(z.string().max(64)).default([]),
  agentInstructions: z.record(z.string(), z.string().max(2000)).default({}),
  directResponse: z.string().max(5000).optional(),
  needsApproval: z.boolean().default(false),
  plan: PlanSchema.optional(),
});

const EvaluatorResponseSchema = z.object({
  isComplete: z.boolean().optional(),
  complete: z.boolean().optional(),
  nextAgentId: z.string().max(64).optional(),
  nextAgent: z.string().max(64).optional(),
  reason: z.string().max(500).optional(),
  guidance: z.string().max(2000).optional(),
  summary: z.string().max(2000).optional(),
  executiveSummary: z.string().max(5000).optional(),
});

function resolveAgentId(rawId: string, config: TeamConfig): string | null {
  const agents = config.agents;
  const exact = agents.find(a => a.id === rawId);
  if (exact) return exact.id;

  const lower = rawId.toLowerCase();
  const caseInsensitive = agents.find(a => a.id.toLowerCase() === lower);
  if (caseInsensitive) return caseInsensitive.id;

  const partial = agents.find(
    a => a.id.toLowerCase().includes(lower) || lower.includes(a.id.toLowerCase()),
  );
  if (partial) return partial.id;

  const byName = agents.find(
    a =>
      a.name.toLowerCase() === lower ||
      a.name.toLowerCase().includes(lower) ||
      lower.includes(a.name.toLowerCase()),
  );
  if (byName) return byName.id;

  return null;
}

/** Build a safe fallback analysis that routes to all agents with moderate complexity. */
function makeFallbackAnalysis(config: TeamConfig): OrchestratorAnalysis {
  return {
    intent: 'general',
    complexity: 'moderate',
    safetyFlags: [],
    selectedAgents: config.agents.map(a => a.id),
    agentInstructions: {},
    needsApproval: false,
  };
}

/**
 * Extract structured analysis from a natural language LLM response when JSON parsing fails.
 * Scans for agent references, complexity keywords, and intent from the prose.
 */
function parseAnalyzerFromProse(response: string, config: TeamConfig): OrchestratorAnalysis {
  const lower = response.toLowerCase();

  let complexity: Complexity = 'moderate';
  if (/\b(simple|easy|straightforward|trivial)\b/.test(lower)) complexity = 'simple';
  else if (/\b(complex|difficult|multi[- ]?step|complicated|advanced)\b/.test(lower)) complexity = 'complex';

  const mentionedAgents = config.agents.filter(
    a => lower.includes(a.id.toLowerCase()) || lower.includes(a.name.toLowerCase()),
  );
  const selectedAgents =
    mentionedAgents.length > 0 ? mentionedAgents.map(a => a.id) : config.agents.map(a => a.id);

  // Try to extract intent from embedded JSON first
  let intent = 'general';
  const jsonStr = extractOuterJson(response);
  if (jsonStr) {
    try {
      const raw = JSON.parse(jsonStr) as Record<string, unknown>;
      if (typeof raw.intent === 'string' && raw.intent.length > 0) {
        intent = raw.intent;
      }
    } catch {
      // Fall through to prose extraction
    }
  }
  if (intent === 'general') {
    const firstLine = response.split(/[.\n]/).find(s => {
      const trimmed = s.trim();
      return trimmed.length > 5 && !trimmed.startsWith('{') && !trimmed.startsWith('"');
    })?.trim() ?? 'general';
    intent = firstLine.length > 200 ? firstLine.slice(0, 197) + '...' : firstLine;
  }

  return {
    intent,
    complexity,
    safetyFlags: [],
    selectedAgents,
    agentInstructions: {},
    needsApproval: false,
  };
}

/**
 * Parse the analyzer LLM response into a OrchestratorAnalysis.
 * Returns null on failure so the caller can retry and emit errors.
 */
function parseAnalyzerResponse(response: string, config: TeamConfig): OrchestratorAnalysis | null {
  const jsonStr = extractOuterJson(response);
  if (jsonStr) {
    try {
      const raw = JSON.parse(jsonStr);
      const result = AnalyzerResponseSchema.safeParse(raw);

      if (result.success) {
        const parsed = result.data;

        let selectedAgents = parsed.selectedAgents
          .map(id => resolveAgentId(id, config))
          .filter((id): id is string => id !== null);

        if (
          selectedAgents.length === 0 &&
          (parsed.directResponse === undefined || parsed.directResponse.length === 0)
        ) {
          selectedAgents = [config.agents[0]?.id ?? ''];
        }

        let plan: OrchestratorPlan | undefined;
        if (parsed.plan && parsed.plan.steps.length > 0) {
          const resolvedSteps = parsed.plan.steps
            .map(s => {
              const resolved = resolveAgentId(s.agentId, config);
              return resolved
                ? { agentId: resolved, action: s.action, ...(s.dependsOn !== undefined ? { dependsOn: s.dependsOn } : {}) }
                : null;
            })
            .filter((s): s is NonNullable<typeof s> => s !== null);

          if (resolvedSteps.length > 0) {
            plan = {
              description: parsed.plan.description,
              steps: resolvedSteps,
              estimatedRounds: parsed.plan.estimatedRounds,
              estimatedCost: parsed.plan.estimatedCost,
            };
          }
        }

        return {
          intent: parsed.intent,
          complexity: parsed.complexity,
          safetyFlags: parsed.safetyFlags,
          plan,
          selectedAgents,
          agentInstructions: parsed.agentInstructions,
          directResponse:
            parsed.directResponse !== undefined &&
            parsed.directResponse.length > 0 &&
            selectedAgents.length === 0
              ? parsed.directResponse
              : undefined,
          needsApproval: parsed.needsApproval,
        };
      }

      debug('orchestrator', 'analyzer-zod-validation-failed', {
        issues: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
      });
    } catch (parseErr) {
      debug('orchestrator', 'analyzer-json-parse-failed', {
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
    }
  }

  return null;
}

interface EvaluatorResult {
  isComplete: boolean;
  nextAgentId?: string | undefined;
  reason?: string | undefined;
  guidance?: string | undefined;
  summary?: string | undefined;
  executiveSummary?: string | undefined;
  parseFailure?: boolean | undefined;
}

/**
 * Parse the evaluator LLM response into a decision.
 * Returns null on failure so the caller can retry.
 */
function parseEvaluatorResponse(
  response: string,
  config: TeamConfig,
  _analysis?: OrchestratorAnalysis,
  _round?: number,
): EvaluatorResult | null {
  const jsonStr = extractOuterJson(response);
  if (jsonStr) {
    try {
      const raw = JSON.parse(jsonStr);
      const result = EvaluatorResponseSchema.safeParse(raw);

      if (result.success) {
        const parsed = result.data;
        const isComplete = parsed.isComplete ?? parsed.complete ?? false;

        if (isComplete) {
          return {
            isComplete: true,
            summary: parsed.summary,
            executiveSummary: parsed.executiveSummary,
          };
        }

        const nextAgentId = parsed.nextAgentId ?? parsed.nextAgent;

        if (
          nextAgentId !== undefined &&
          nextAgentId.length > 0 &&
          config.agents.some(a => a.id === nextAgentId)
        ) {
          return {
            isComplete: false,
            nextAgentId,
            reason: parsed.reason,
            guidance: parsed.guidance,
          };
        }

        return { isComplete: true, summary: 'Task completed.' };
      }

      debug('orchestrator', 'evaluator-zod-validation-failed', {
        issues: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
      });
    } catch (parseErr) {
      debug('orchestrator', 'evaluator-json-parse-failed', {
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
    }
  }

  return null;
}

/** Plan-aware fallback for when evaluator parse fails entirely. */
function evaluatorFallback(
  config: TeamConfig,
  analysis?: OrchestratorAnalysis,
  round?: number,
): EvaluatorResult {
  if (analysis?.plan) {
    const nextStep = analysis.plan.steps[round ?? 0];
    if (nextStep && config.agents.some(a => a.id === nextStep.agentId)) {
      return {
        isComplete: false,
        nextAgentId: nextStep.agentId,
        guidance: nextStep.action,
        parseFailure: true,
      };
    }
  }
  return { isComplete: true, parseFailure: true };
}

/**
 * Normalize common LLM field name mistakes in TL response before Zod validation.
 * LLMs often use synonyms like "agent" instead of "targetAgent", "message" instead of "guidance".
 */
function normalizeTlActions(parsed: unknown): void {
  if (typeof parsed !== 'object' || parsed === null) return;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.actions)) return;

  for (const action of obj.actions) {
    if (typeof action !== 'object' || action === null) continue;
    const a = action as Record<string, unknown>;

    // Normalize switch_agent → route_agent so it goes through broadcast logic
    if (a.type === 'switch_agent') {
      a.type = 'route_agent';
      if (a.guidance === undefined) a.guidance = 'Respond to the user';
    }

    // Normalize agent field names → targetAgent
    if (a.targetAgent === undefined) {
      if (typeof a.agent === 'string') { a.targetAgent = a.agent; delete a.agent; }
      else if (typeof a.agentId === 'string') { a.targetAgent = a.agentId; delete a.agentId; }
      else if (typeof a.target === 'string') { a.targetAgent = a.target; delete a.target; }
    }

    // Normalize guidance field names → guidance
    if (a.guidance === undefined && a.type === 'route_agent') {
      if (typeof a.message === 'string') { a.guidance = a.message; delete a.message; }
      else if (typeof a.instruction === 'string') { a.guidance = a.instruction; delete a.instruction; }
      else if (typeof a.instructions === 'string') { a.guidance = a.instructions; delete a.instructions; }
      else if (typeof a.prompt === 'string') { a.guidance = a.prompt; delete a.prompt; }
      else if (typeof a.content === 'string') { a.guidance = a.content; }
    }

    // Normalize phase — default to 'execute' if missing on route_agent/message
    if (a.phase === undefined && (a.type === 'route_agent' || a.type === 'message')) {
      a.phase = 'execute';
    }

    // Normalize parallel_route targets — LLMs may use agent/targetAgent instead of agentId
    if (a.type === 'parallel_route' && Array.isArray(a.targets)) {
      for (const target of a.targets) {
        if (typeof target !== 'object' || target === null) continue;
        const t = target as Record<string, unknown>;
        if (t.agentId === undefined) {
          if (typeof t.agent === 'string') { t.agentId = t.agent; delete t.agent; }
          else if (typeof t.targetAgent === 'string') { t.agentId = t.targetAgent; delete t.targetAgent; }
          else if (typeof t.id === 'string') { t.agentId = t.id; delete t.id; }
        }
        if (t.guidance === undefined) {
          if (typeof t.message === 'string') { t.guidance = t.message; delete t.message; }
          else if (typeof t.instruction === 'string') { t.guidance = t.instruction; delete t.instruction; }
          else if (typeof t.prompt === 'string') { t.guidance = t.prompt; delete t.prompt; }
          else { t.guidance = 'Respond to the user'; }
        }
      }
    }
  }
}
