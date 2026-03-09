import type { ContextConfig, ContextLevel } from './types.js';
import { logContext } from './debug-logger.js';

interface ContextState {
  config: ContextConfig;
  isStale: boolean;
  lastRefreshedAt: number | null;
}

const sessionContextState = new Map<string, ContextState>();

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  level: 'minimal',
};

/**
 * Get context configuration for a session.
 * Creates default config if not exists.
 */
export function getContextConfig(sessionId: string): ContextConfig {
  const state = getOrCreateState(sessionId);
  return { ...state.config };
}

/**
 * Set context level for a session.
 * Marks context as stale so it will be refreshed on next message.
 */
export function setContextLevel(sessionId: string, level: ContextLevel): void {
  const state = getOrCreateState(sessionId);
  const oldLevel = state.config.level;
  if (oldLevel !== level) {
    state.config.level = level;
    state.isStale = true;
    logContext(sessionId, 'level-change', { from: oldLevel, to: level });
  }
}

/**
 * Update context configuration for a session.
 */
export function setContextConfig(sessionId: string, config: Partial<ContextConfig>): void {
  const state = getOrCreateState(sessionId);
  state.config = { ...state.config, ...config };
  state.isStale = true;
}

/**
 * Mark context as stale, forcing refresh on next message.
 * Used for manual /refresh command.
 */
export function markContextStale(sessionId: string): void {
  const state = getOrCreateState(sessionId);
  state.isStale = true;
  logContext(sessionId, 'stale', { reason: 'manual refresh' });
}

/**
 * Check if context needs to be refreshed.
 * Returns true for new sessions or when explicitly marked stale.
 */
export function isContextStale(sessionId: string): boolean {
  const state = sessionContextState.get(sessionId);
  // No state = new session = needs context
  if (!state) return true;
  // Never refreshed = needs context
  if (state.lastRefreshedAt === null) return true;
  // Explicitly marked stale
  return state.isStale;
}

/**
 * Mark context as fresh after sending it.
 * Called by orchestrator after including context in message.
 */
export function markContextFresh(sessionId: string): void {
  const state = getOrCreateState(sessionId);
  state.isStale = false;
  state.lastRefreshedAt = Date.now();
  logContext(sessionId, 'fresh', { level: state.config.level });
}

/**
 * Get the timestamp when context was last refreshed.
 * Returns null if context has never been sent.
 */
export function getLastRefreshedAt(sessionId: string): number | null {
  const state = sessionContextState.get(sessionId);
  return state?.lastRefreshedAt ?? null;
}

/**
 * Clear context state for a session (e.g., when session ends).
 */
export function clearContextState(sessionId: string): void {
  sessionContextState.delete(sessionId);
}

/**
 * Clear all context state (for testing or reset).
 */
export function clearAllContextState(): void {
  sessionContextState.clear();
}

/**
 * Get or create context state for a session.
 */
function getOrCreateState(sessionId: string): ContextState {
  let state = sessionContextState.get(sessionId);
  if (!state) {
    state = {
      config: { ...DEFAULT_CONTEXT_CONFIG },
      isStale: true,
      lastRefreshedAt: null,
    };
    sessionContextState.set(sessionId, state);
  }
  return state;
}
