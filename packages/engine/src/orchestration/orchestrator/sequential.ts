/**
 * Sequential (One-by-One) Routing Strategy
 *
 * T013: Cycles through agents sequentially.
 * Returns all agents starting from the next speaker after lastSpeakerIndex.
 *
 * Single Responsibility: Compute next agent rotation from state.
 */

import type { RoutingStrategy, RoutingState, RoutingResult, AgentProfile } from '../types.js';

export class SequentialStrategy implements RoutingStrategy {
  async route(
    _message: string,
    agents: ReadonlyArray<AgentProfile>,
    state: RoutingState
  ): Promise<RoutingResult> {
    if (agents.length === 0) {
      return {
        targetAgentIds: [],
        reason: 'No agents available for sequential routing',
      };
    }

    const orderedIds = this.computeRotation(agents, state.lastSpeakerIndex);

    return {
      targetAgentIds: orderedIds,
      reason: `Sequential routing: all agents respond in order starting from index ${(state.lastSpeakerIndex + 1) % agents.length}`,
    };
  }

  /**
   * Compute a full rotation of agents starting from the next speaker.
   * If lastSpeakerIndex=1 and 3 agents exist: returns [2, 0, 1]
   */
  private computeRotation(agents: ReadonlyArray<AgentProfile>, lastSpeakerIndex: number): string[] {
    const count = agents.length;
    const startIndex = (lastSpeakerIndex + 1) % count;
    const orderedIds: string[] = [];

    for (let i = 0; i < count; i++) {
      const idx = (startIndex + i) % count;
      // eslint-disable-next-line security/detect-object-injection -- idx is computed numeric index
      const agent = agents[idx];
      if (agent !== undefined) {
        orderedIds.push(agent.id);
      }
    }

    return orderedIds;
  }
}
