/**
 * Shared session utilities for provider adapters.
 * Eliminates duplicated time parsing and session lifecycle logic.
 */

import type { ProviderSessionState } from '../types';
import { logProvider } from '../../core/debug-logger';

/**
 * Parse a time string to milliseconds.
 * Supports: '5m' (minutes), '1h' (hours), '30s' (seconds), or raw number (seconds).
 * Returns defaultMs if timeStr is undefined or unparseable.
 */
export function parseTimeToMs(timeStr: string | undefined, defaultMs: number): number {
  if (timeStr === undefined || timeStr.length === 0) return defaultMs;

  const match = timeStr.match(/^(\d+)(s|m|h)?$/);
  if (match?.[1] === undefined || match[1].length === 0) return defaultMs;

  const value = parseInt(match[1], 10);
  const unit = match[2] ?? 's';

  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    default:
      return value * 1000;
  }
}

/**
 * Ensure a valid session exists for the given model.
 * Creates a new session if none exists, the model changed, or the session expired.
 * Returns the current (possibly new) session state.
 */
export function ensureSession<T extends ProviderSessionState>(
  current: T | null,
  modelId: string,
  timeoutMs: number,
  factory: (modelId: string) => T,
  providerId: string
): T {
  const sessionExpired =
    current !== null && Date.now() - new Date(current.lastActivityAt).getTime() > timeoutMs;

  if (!current || current.modelId !== modelId || sessionExpired) {
    if (sessionExpired) {
      logProvider(providerId, 'session-expired', {
        oldSessionId: current?.sessionId,
        modelId,
      });
    }
    const newSession = factory(modelId);
    return newSession;
  }

  current.lastActivityAt = new Date().toISOString();
  return current;
}
