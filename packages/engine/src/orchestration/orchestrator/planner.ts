import { z } from 'zod';
import type { OrchestrationStateType } from '../state.js';
import type {
  TeamConfig,
  OrchestratorAnalysis,
  OrchestratorPlan,
  StreamCallbackRef,
  ExecutionContext,
} from '../types.js';
import { type OrchestratorLLM, createOrchestratorLLM } from './llm.js';
import { loadOrchestratorPrompt } from '../config/defaults.js';
import { writePlanFile } from './plan-file.js';
import {
  buildPlannerSummary,
  sanitizeSummary,
  getCapabilityTag,
  invokeJSONOrStream,
} from './request-summary.js';
import { retryOnParseFail, extractOuterJson } from './parse-utils.js';
import { debug } from '../../core/debug-logger.js';
import { extractTextFromContent } from '../../core/message.js';

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

const PlannerResponseSchema = z.object({
  description: z.string().max(2000).default(''),
  steps: z.array(PlanStepSchema).max(20).default([]),
  estimatedRounds: z.number().int().min(1).max(10).default(1),
  estimatedCost: z.unknown().transform(normalizeCost).default('medium'),
  needsApproval: z.boolean().default(true),
  agentInstructions: z.record(z.string(), z.string().max(2000)).default({}),
});

function resolveAgentId(rawId: string, config: TeamConfig): string | null {
  const agents = config.agents;
  const exact = agents.find(a => a.id === rawId);
  if (exact) return exact.id;

  const lower = rawId.toLowerCase();
  const caseInsensitive = agents.find(a => a.id.toLowerCase() === lower);
  if (caseInsensitive) return caseInsensitive.id;

  const partial = agents.find(
    a => a.id.toLowerCase().includes(lower) || lower.includes(a.id.toLowerCase())
  );
  if (partial) return partial.id;

  const byName = agents.find(
    a => a.name.toLowerCase() === lower || a.name.toLowerCase().includes(lower) || lower.includes(a.name.toLowerCase())
  );
  if (byName) return byName.id;

  return null;
}

export function parsePlannerResponse(
  response: string,
  config: TeamConfig
): { plan: OrchestratorPlan; needsApproval: boolean; agentInstructions: Record<string, string> } | null {
  const jsonStr = extractOuterJson(response);
  if (!jsonStr) return null;

  try {
    const raw = JSON.parse(jsonStr);
    const result = PlannerResponseSchema.safeParse(raw);
    if (!result.success) {
      debug('orchestrator', 'planner-zod-validation-failed', {
        issues: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
      });
      return null;
    }

    const parsed = result.data;
    const validSteps = parsed.steps
      .map(s => {
        const resolved = resolveAgentId(s.agentId, config);
        return resolved ? { ...s, agentId: resolved } : null;
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    if (validSteps.length === 0) return null;

    return {
      plan: {
        description: parsed.description,
        steps: validSteps.map(s => ({
          agentId: s.agentId,
          action: s.action,
          ...(s.dependsOn !== undefined ? { dependsOn: s.dependsOn } : {}),
        })),
        estimatedRounds: parsed.estimatedRounds,
        estimatedCost: parsed.estimatedCost,
      },
      needsApproval: parsed.needsApproval,
      agentInstructions: parsed.agentInstructions,
    };
  } catch (parseErr) {
    debug('orchestrator', 'planner-json-parse-failed', {
      error: parseErr instanceof Error ? parseErr.message : String(parseErr),
    });
    return null;
  }
}

export function createPlannerNode(
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
      return {};
    }

    if (analysis.complexity === 'simple') {
      return {};
    }

    const emit = streamCallbackRef.current;

    emit?.({ type: 'orchestrator_phase', traceId, phase: 'planning' });

    emit?.({
      type: 'orchestrator_request',
      traceId,
      phase: 'planning',
      target: 'planner',
      summary: buildPlannerSummary(analysis.intent, analysis.selectedAgents),
      intent: 'generate execution plan',
    });

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

    const agentDescriptions = config.agents
      .map(a => {
        const cap = getCapabilityTag(a);
        const skills =
          a.skills !== undefined && a.skills.length > 0
            ? ` [Skills: ${a.skills.join(', ')}]`
            : '';
        return `- ${a.id}: ${a.name} — ${a.role} ${cap}${skills}`;
      })
      .join('\n');

    const plannerPrompt = loadOrchestratorPrompt('planner.md');
    const planRules = loadOrchestratorPrompt('plan.md');

    const systemPrompt = `${plannerPrompt}

${planRules ? `## Plan Generation Rules\n${planRules}\n` : ''}
## Analyzer Classification
Intent: ${analysis.intent}
Complexity: ${analysis.complexity}
Selected agents: ${analysis.selectedAgents.join(', ')}

## Available Agents
${agentDescriptions}

## Agent IDs (use these exact IDs)
${config.agents.map(a => a.id).join(', ')}`;

    try {
      const fullResponse = await invokeJSONOrStream(llm, systemPrompt, userMessage, {
        debugEnabled, traceId, source: 'planner', emit,
      });

      let parsed = parsePlannerResponse(fullResponse, config);

      if (!parsed) {
        debug('orchestrator', 'planner-first-parse-failed', {
          responsePreview: fullResponse.slice(0, 300),
          responseLength: fullResponse.length,
        });
        parsed = await retryOnParseFail(
          llm, systemPrompt, fullResponse,
          (r) => parsePlannerResponse(r, config),
        );
      }

      if (!parsed) {
        const preview = fullResponse.slice(0, 200).replace(/\n/g, ' ');
        debug('orchestrator', 'planner-failed-to-parse', {
          responseLength: fullResponse.length,
          responsePreview: preview,
        });

        parsed = parsePlannerFromProse(fullResponse, config, analysis);
        if (parsed) {
          emit?.({
            type: 'orchestrator_error', traceId, phase: 'planning',
            message: 'Extracted plan from prose (no JSON found)',
            recoverable: true,
          });
        } else {
          parsed = makeFallbackPlan(config, analysis);
          if (!parsed) {
            emit?.({
              type: 'orchestrator_error', traceId, phase: 'planning',
              message: 'Failed to parse planner response — using direct routing',
              recoverable: true,
            });
            return {};
          }
          emit?.({
            type: 'orchestrator_error', traceId, phase: 'planning',
            message: 'Used fallback plan from analysis',
            recoverable: true,
          });
        }
      }

      const { plan, needsApproval, agentInstructions } = parsed;

      writePlanFile(state.sessionId, plan);

      const mergedInstructions: Record<string, string> = {
        ...analysis.agentInstructions,
        ...agentInstructions,
      };

      const updatedAnalysis: OrchestratorAnalysis = {
        ...analysis,
        plan,
        needsApproval,
        agentInstructions: mergedInstructions,
      };

      emit?.({
        type: 'orchestrator_plan',
        traceId,
        plan,
        awaitingApproval: needsApproval,
      });

      if (needsApproval) {
        return {
          orchestratorAnalysis: updatedAnalysis,
          systemCommand: 'await_approval',
        };
      }

      const executionContexts: Record<string, ExecutionContext> = {};
      for (const agentId of updatedAnalysis.selectedAgents) {
        const controller = new AbortController();
        abortControllers?.set(agentId, controller);
        // eslint-disable-next-line security/detect-object-injection -- agentId from analysis.selectedAgents
        executionContexts[agentId] = {
          activeAgentId: agentId,
          allowedTools: ['*'],
          routingReason: `Orchestrator plan: ${sanitizeSummary(plan.description)}`,
          timeoutBudget: 120000,
          cancellationToken: controller.signal,
          // eslint-disable-next-line security/detect-object-injection -- agentId from analysis.selectedAgents
          orchestratorGuidance: mergedInstructions[agentId],
        };
      }

      return {
        orchestratorAnalysis: updatedAnalysis,
        activeAgentId: updatedAnalysis.selectedAgents[0] ?? null,
        pendingAgents: updatedAnalysis.selectedAgents.slice(1),
        executionContexts,
      };
    } catch (err) {
      debug('orchestrator', 'planner-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {};
    }
  };
}

/**
 * Extract plan steps from a natural language planner response.
 * Scans numbered lists / bullet points for agent references and actions.
 */
function parsePlannerFromProse(
  response: string,
  config: TeamConfig,
  analysis: OrchestratorAnalysis,
): { plan: OrchestratorPlan; needsApproval: boolean; agentInstructions: Record<string, string> } | null {
  if (response.trim().length === 0) return null;

  const lines = response.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const steps: { agentId: string; action: string }[] = [];

  const stepPattern = /^(?:\d+[.)]\s*|[-*]\s+)/;
  for (const line of lines) {
    if (!stepPattern.test(line)) continue;
    const text = line.replace(stepPattern, '').trim();
    const matched = config.agents.find(
      a => text.toLowerCase().includes(a.id.toLowerCase()) || text.toLowerCase().includes(a.name.toLowerCase()),
    );
    if (matched) {
      const action = text
        .replace(new RegExp(matched.id, 'gi'), '')
        .replace(new RegExp(matched.name, 'gi'), '')
        .replace(/^[\s:—–-]+/, '')
        .trim();
      steps.push({ agentId: matched.id, action: action || 'Execute assigned task' });
    }
  }

  if (steps.length === 0) return null;

  const firstLine = lines[0] ?? analysis.intent;
  const description = firstLine.replace(stepPattern, '').slice(0, 500);

  return {
    plan: {
      description,
      steps,
      estimatedRounds: steps.length,
      estimatedCost: steps.length > 3 ? 'high' : steps.length > 1 ? 'medium' : 'low',
    },
    needsApproval: steps.length >= 3,
    agentInstructions: Object.fromEntries(steps.map(s => [s.agentId, s.action])),
  };
}

function makeFallbackPlan(
  _config: TeamConfig,
  analysis: OrchestratorAnalysis,
): { plan: OrchestratorPlan; needsApproval: boolean; agentInstructions: Record<string, string> } | null {
  if (analysis.selectedAgents.length === 0) return null;

  const steps = analysis.selectedAgents.map(agentId => ({
    agentId,
    // eslint-disable-next-line security/detect-object-injection -- agentId from analysis.selectedAgents
    action: analysis.agentInstructions[agentId] ?? `Respond to user's message`,
  }));

  return {
    plan: {
      description: `Handle: ${analysis.intent}`,
      steps,
      estimatedRounds: steps.length,
      estimatedCost: 'low',
    },
    needsApproval: false,
    agentInstructions: analysis.agentInstructions,
  };
}
