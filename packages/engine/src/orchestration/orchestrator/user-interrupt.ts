import type { UserOverride } from '../types.js';

interface InterruptPattern {
  pattern: RegExp;
  type: UserOverride['type'];
  target?: string | undefined;
}

const INTERRUPT_PATTERNS: InterruptPattern[] = [
  { pattern: /\b(skip\s+review|no\s+review)\b/i, type: 'skip_phase', target: 'synthesize' },
  { pattern: /\b(skip\s+to\s+|jump\s+to\s+)(clarify|plan|deliberate|execute|review|synthesize)\b/i, type: 'skip_phase' },
  { pattern: /\b(just\s+do\s+it|proceed|go\s+ahead|execute\s+now)\b/i, type: 'force_phase', target: 'execute' },
  { pattern: /\b(stop|cancel|abort|enough|done)\b/i, type: 'stop' },
  { pattern: /\b(restart|start\s+over|begin\s+again|reset)\b/i, type: 'restart' },
  // Require @mention for "ask"/"try"/"use" to avoid false positives on regular sentences.
  // "switch to" is unambiguous enough to work without @.
  { pattern: /\b(switch\s+to)\s+(@?\w+)/i, type: 'switch_agent' },
  { pattern: /\b(ask|use|try)\s+@(\w+)/i, type: 'switch_agent' },
];

/**
 * Detect user interrupt commands from a message.
 * Returns a UserOverride if an interrupt pattern is matched, null otherwise.
 *
 * Called BEFORE the TL processes the message — zero extra LLM cost for interrupts.
 */
export function detectUserInterrupt(message: string): UserOverride | null {
  const trimmed = message.trim();

  // Only match short messages that look like commands, not regular conversation.
  // Longer messages are almost certainly conversational, not interrupt commands.
  if (trimmed.length > 80) return null;
  // Messages with question marks are questions, not commands
  if (trimmed.includes('?')) return null;

  for (const { pattern, type, target: defaultTarget } of INTERRUPT_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match !== null) {
      let target = defaultTarget;

      // Extract dynamic target for skip_phase
      if (type === 'skip_phase' && match[2] !== undefined) {
        target = match[2].toLowerCase();
      }

      // Extract dynamic target for switch_agent
      if (type === 'switch_agent' && match[2] !== undefined) {
        target = match[2].replace(/^@/, '');
      }

      return { type, ...(target !== undefined ? { target } : {}) };
    }
  }

  return null;
}
