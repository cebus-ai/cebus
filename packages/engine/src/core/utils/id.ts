/**
 * Shared ID generation utility.
 * Uses crypto.randomUUID() since Node >= 24 is required.
 */

export function generateId(): string {
  return crypto.randomUUID();
}
