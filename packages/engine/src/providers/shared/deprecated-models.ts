/**
 * Deprecated model detection and filtering.
 *
 * Models matching these patterns are excluded from model discovery
 * and onboarding selection. Patterns are checked against the model ID
 * (case-insensitive).
 */

/** Model ID patterns considered deprecated (checked via substring match). */
const DEPRECATED_PATTERNS: string[] = [
  // Anthropic Claude 3 / 3.5 family — EOL Feb 2026
  'claude-3-haiku',
  'claude-3-sonnet',
  'claude-3-opus',
  'claude-3-5-haiku',
  'claude-3-5-sonnet',
  'claude-3.5-haiku',
  'claude-3.5-sonnet',

  // OpenAI legacy GPT-4o family
  'gpt-4o',
];

/**
 * Returns true if a model ID matches a known deprecated pattern.
 */
export function isDeprecatedModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return DEPRECATED_PATTERNS.some(pattern => lower.includes(pattern));
}
