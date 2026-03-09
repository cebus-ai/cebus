/**
 * Tag-Only Routing Strategy
 *
 * T012: Parses @agent_id mentions from messages.
 * Routes to explicitly tagged agents in tag order.
 * Returns help message when no valid tags found.
 *
 * Single Responsibility: Parse tags, validate against agents, produce routing result.
 */

import type { RoutingStrategy, RoutingState, RoutingResult, AgentProfile } from '../types.js';

const TAG_PATTERN = /@([a-zA-Z0-9-]+)/g;

export class TagOnlyStrategy implements RoutingStrategy {
  async route(
    message: string,
    agents: ReadonlyArray<AgentProfile>,
    _state: RoutingState
  ): Promise<RoutingResult> {
    const parsedTags = this.extractTags(message);
    const validAgentIds = this.matchAgents(parsedTags, agents);

    if (validAgentIds.length === 0) {
      return this.buildHelpResult(agents);
    }

    return {
      targetAgentIds: validAgentIds,
      reason: `Tag-only routing: matched ${validAgentIds.join(', ')} from message tags`,
    };
  }

  private extractTags(message: string): string[] {
    const tags: string[] = [];
    let match: RegExpExecArray | null;
    TAG_PATTERN.lastIndex = 0;

    while ((match = TAG_PATTERN.exec(message)) !== null) {
      const tag = match[1];
      if (tag !== undefined && !tags.includes(tag)) {
        tags.push(tag);
      }
    }

    return tags;
  }

  private matchAgents(tags: string[], agents: ReadonlyArray<AgentProfile>): string[] {
    const agentIds = new Set(agents.map(a => a.id.toLowerCase()));

    return tags
      .filter(tag => agentIds.has(tag.toLowerCase()))
      .map(tag => {
        const agent = agents.find(a => a.id.toLowerCase() === tag.toLowerCase());
        return agent?.id ?? tag;
      });
  }

  private buildHelpResult(agents: ReadonlyArray<AgentProfile>): RoutingResult {
    const agentList = agents.map(a => `  @${a.id} — ${a.name}: ${a.role}`).join('\n');

    return {
      targetAgentIds: [],
      reason: 'No valid agent tags found. Please tag an agent with @agent_id.',
      isHelpMessage: true,
      helpContent: `Please tag an agent to route your message:\n${agentList}`,
    };
  }
}
