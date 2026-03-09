/**
 * Graph Cache
 *
 * Caches compiled orchestration graphs per session.
 * Recompiles only when participants change.
 */

import type { OrchestrationGraph } from '../types.js';
import { compile } from '../index.js';
import { buildSessionConfig, participantHash } from './config-builder.js';
import { getCheckpointer } from './checkpointer.js';

interface CachedGraph {
  graph: OrchestrationGraph;
  hash: string;
}

const MAX_CACHED_GRAPHS = 50;
const cache = new Map<string, CachedGraph>();

/**
 * Get a cached graph or compile a new one if participants changed.
 */
export async function getOrCompileGraph(
  sessionId: string,
  options?: { workingDir?: string; systemPrompt?: string }
): Promise<OrchestrationGraph> {
  const hash = participantHash(sessionId);

  const cached = cache.get(sessionId);
  if (cached && cached.hash === hash) {
    // Move to end for LRU ordering
    cache.delete(sessionId);
    cache.set(sessionId, cached);
    return cached.graph;
  }

  const { teamConfig, agentToParticipant } = buildSessionConfig(sessionId, options);
  const graph = await compile(teamConfig, {
    agentToParticipant,
    checkpointer: getCheckpointer(),
  });

  // Evict oldest entry if at capacity
  if (cache.size >= MAX_CACHED_GRAPHS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }

  cache.set(sessionId, { graph, hash });
  return graph;
}

/**
 * Invalidate the cached graph for a session.
 */
export function invalidateGraph(sessionId: string): void {
  cache.delete(sessionId);
}

/**
 * Clear all cached graphs.
 */
export function clearGraphCache(): void {
  cache.clear();
}
