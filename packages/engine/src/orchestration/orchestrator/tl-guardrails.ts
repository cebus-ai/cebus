import type {
  TlResponse,
  TlAction,
  TlPhase,
  TlBudgets,
  TeamConfig,
} from '../types.js';
import { TlResponseSchema } from '../types.js';

/** Valid phase transitions enforced by code (not prompt-dependent). */
export const ALLOWED_TRANSITIONS: Record<TlPhase | 'null', TlPhase[]> = {
  null: ['clarify', 'plan', 'deliberate', 'execute', 'ask_user'],
  clarify: ['plan', 'execute', 'deliberate', 'ask_user'],
  plan: ['deliberate', 'execute', 'ask_user'],
  deliberate: ['execute', 'ask_user', 'synthesize'],
  execute: ['review', 'synthesize', 'ask_user', 'execute'],
  review: ['execute', 'synthesize', 'ask_user'],
  synthesize: ['ask_user'],
  ask_user: ['clarify', 'plan', 'deliberate', 'execute', 'review', 'synthesize', 'ask_user'],
};

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitizedResponse: TlResponse | null;
}

/**
 * Validate a TL response against schema, phase transitions, agent IDs, budgets, and state guards.
 */
export function validateTlResponse(
  raw: unknown,
  config: TeamConfig,
  currentPhase: TlPhase | null,
  budgets: TlBudgets,
  hasAgentResponded: boolean,
  recentQuestions: string[]
): ValidationResult {
  const errors: string[] = [];

  const parseResult = TlResponseSchema.safeParse(raw);
  if (!parseResult.success) {
    return {
      valid: false,
      errors: parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
      sanitizedResponse: null,
    };
  }

  const response = parseResult.data;
  const validAgentIds = new Set(config.agents.map(a => a.id));
  const sanitizedActions: TlAction[] = [];

  for (const action of response.actions) {
    const actionErrors: string[] = [];

    // Agent ID validation
    if (action.type === 'route_agent' && !validAgentIds.has(action.targetAgent)) {
      actionErrors.push(`Invalid targetAgent: ${action.targetAgent}`);
      continue;
    }
    if (action.type === 'parallel_route') {
      const invalidTargets = action.targets.filter(t => !validAgentIds.has(t.agentId));
      if (invalidTargets.length > 0) {
        actionErrors.push(`Invalid parallel targets: ${invalidTargets.map(t => t.agentId).join(', ')}`);
        continue;
      }
    }
    if (action.type === 'request_review' && !validAgentIds.has(action.targetAgent)) {
      actionErrors.push(`Invalid review targetAgent: ${action.targetAgent}`);
      continue;
    }

    // Phase transition validation
    if (action.type === 'route_agent' || action.type === 'message') {
      const targetPhase = 'phase' in action ? action.phase : null;
      if (targetPhase !== null) {
        const phaseKey = currentPhase ?? 'null';
        // eslint-disable-next-line security/detect-object-injection -- phaseKey from enum
        const allowed = ALLOWED_TRANSITIONS[phaseKey];
        if (allowed !== undefined && !allowed.includes(targetPhase)) {
          actionErrors.push(`Invalid phase transition: ${currentPhase ?? 'null'} → ${targetPhase}`);
        }
      }
    }

    // State guards
    if (action.type === 'synthesize' && !hasAgentResponded) {
      actionErrors.push('Cannot synthesize before any agent response');
      continue;
    }
    if (action.type === 'request_review' && !hasAgentResponded) {
      actionErrors.push('Cannot review before any agent response');
      continue;
    }
    if (action.type === 'complete' && !hasAgentResponded) {
      actionErrors.push('Cannot complete without at least one agent response');
      continue;
    }

    // Duplicate question check
    if (action.type === 'question') {
      const normalizedQ = action.content.toLowerCase().trim();
      if (recentQuestions.some(q => q.toLowerCase().trim() === normalizedQ)) {
        actionErrors.push('Duplicate question detected');
        continue;
      }
    }

    if (actionErrors.length > 0) {
      errors.push(...actionErrors);
    } else {
      sanitizedActions.push(action);
    }
  }

  // Budget enforcement
  if (budgets.usedTlCycles >= budgets.maxTlCycles) {
    errors.push(`TL cycle budget exceeded: ${budgets.usedTlCycles}/${budgets.maxTlCycles}`);
    return { valid: false, errors, sanitizedResponse: null };
  }

  const hasRouting = sanitizedActions.some(a => a.type === 'route_agent' || a.type === 'parallel_route');
  if (hasRouting && budgets.usedWorkerRounds >= budgets.maxWorkerRounds) {
    errors.push(`Worker round budget exceeded: ${budgets.usedWorkerRounds}/${budgets.maxWorkerRounds}`);
    const withoutRouting = sanitizedActions.filter(a => a.type !== 'route_agent' && a.type !== 'parallel_route');
    if (withoutRouting.length === 0) {
      return { valid: false, errors, sanitizedResponse: null };
    }
    return {
      valid: true,
      errors,
      sanitizedResponse: { version: 1, actions: withoutRouting },
    };
  }

  const hasReview = sanitizedActions.some(a => a.type === 'request_review');
  if (hasReview && budgets.usedReviewRounds >= budgets.maxReviewRounds) {
    errors.push(`Review round budget exceeded: ${budgets.usedReviewRounds}/${budgets.maxReviewRounds}`);
    const withoutReview = sanitizedActions.filter(a => a.type !== 'request_review');
    if (withoutReview.length === 0) {
      return { valid: false, errors, sanitizedResponse: null };
    }
    return {
      valid: true,
      errors,
      sanitizedResponse: { version: 1, actions: withoutReview },
    };
  }

  if (sanitizedActions.length === 0) {
    return { valid: false, errors: [...errors, 'No valid actions remaining after validation'], sanitizedResponse: null };
  }

  return {
    valid: true,
    errors,
    sanitizedResponse: { version: 1, actions: sanitizedActions },
  };
}

/** Create default TL budgets. */
export function createDefaultBudgets(): TlBudgets {
  return {
    maxTlCycles: 15,
    maxWorkerRounds: 5,
    maxReviewRounds: 2,
    usedTlCycles: 0,
    usedWorkerRounds: 0,
    usedReviewRounds: 0,
  };
}
