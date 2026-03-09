/**
 * Shared prompt building utilities for all worker implementations.
 */

import type { AgentProfile, ExecutionContext } from '../types.js';

/**
 * Build the full system prompt for an agent, including orchestrator guidance.
 *
 * agentProfile.instructions already contains the base system prompt
 * (identity, participants, mode, tier, project context) built by config-builder.ts.
 */
export function buildSystemPrompt(agentProfile: AgentProfile, context: ExecutionContext): string {
  const parts = [...agentProfile.instructions];

  if (context.orchestratorGuidance !== undefined && context.orchestratorGuidance.length > 0) {
    parts.push('', '## Orchestrator Instructions', context.orchestratorGuidance);
  }

  return parts.join('\n');
}
