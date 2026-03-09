/**
 * Trace ID Generator
 *
 * Generates unique trace IDs for request correlation.
 */

import { randomUUID } from 'crypto';

/**
 * Generate a new trace ID (UUID v4).
 */
export function generateTraceId(): string {
  return randomUUID();
}
