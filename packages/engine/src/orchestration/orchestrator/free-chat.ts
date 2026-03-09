/**
 * Free Chat Routing Strategy
 *
 * Broadcasts to ALL agents — every model responds to every message.
 * Used with parallel fan-out in the graph for simultaneous execution.
 */

import type { RoutingStrategy, RoutingState, RoutingResult, AgentProfile } from '../types.js';

export class FreeChatStrategy implements RoutingStrategy {
  async route(
    _message: string,
    agents: ReadonlyArray<AgentProfile>,
    _state: RoutingState
  ): Promise<RoutingResult> {
    if (agents.length === 0) {
      return {
        targetAgentIds: [],
        reason: 'No agents available for free chat routing',
      };
    }

    const allIds = agents.map(a => a.id);

    return {
      targetAgentIds: allIds,
      reason: `Free chat routing: broadcasting to all ${allIds.length} agents in parallel`,
    };
  }
}
