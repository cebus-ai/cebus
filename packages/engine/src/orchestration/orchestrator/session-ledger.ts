import { writeFileSync, readFileSync, renameSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { ContextTier, TlPhase } from '../types.js';

/** Token budget for ledger content per context tier. */
const TIER_BUDGETS: Record<ContextTier, number> = {
  not_supported: 0,
  minimal: 200,
  lite: 400,
  standard: 800,
  full: 1500,
  extended: 3000,
};

/** Rough token estimate: characters / 4. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface LedgerOptions {
  sessionId: string;
  sessionsDir: string;
  chatMode: string;
  models: string[];
  goal: string;
  tier: ContextTier;
}

/**
 * Create a new session ledger file.
 * Returns the absolute path to the ledger file.
 */
export function createLedger(options: LedgerOptions): string {
  const { sessionId, sessionsDir, chatMode, models, goal, tier } = options;
  const filePath = join(sessionsDir, `${sessionId}.session.md`);

  mkdirSync(dirname(filePath), { recursive: true });

  const content = `# Session Ledger — ${sessionId}
Created: ${new Date().toISOString()}
Mode: ${chatMode} + TL
Models: ${models.map(m => `@${m}`).join(', ')}
Goal: ${goal}
Tier: ${tier}

---

`;

  atomicWrite(filePath, content);
  return filePath;
}

/**
 * Append a phase section to the session ledger.
 * Uses atomic write (temp + rename) to prevent corruption.
 */
export function appendToLedger(
  filePath: string,
  phase: TlPhase,
  content: string
): void {
  const existing = readLedgerRaw(filePath);
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });

  const section = `## Phase: ${phase.toUpperCase()}
**Started:** ${timestamp}
${content}

---

`;

  atomicWrite(filePath, existing + section);
}

/**
 * Read the session ledger content, applying compaction if over budget.
 * Content is wrapped in `<session-ledger>` delimiters for prompt injection protection.
 */
export function readLedger(filePath: string, tier: ContextTier): string {
  const raw = readLedgerRaw(filePath);
  if (raw.length === 0) return '';

  // eslint-disable-next-line security/detect-object-injection -- tier is from enum
  const budget = TIER_BUDGETS[tier];
  if (budget === 0) return '';

  const tokens = estimateTokens(raw);
  const content = tokens > budget ? compactLedgerContent(raw, budget, tier) : raw;

  return `<session-ledger>
${content}
</session-ledger>`;
}

/**
 * Compact older phases in the ledger to 1-line summaries.
 * Keeps current + previous phases in full detail.
 * Never prunes DecisionRecord entries.
 */
export function compactLedger(filePath: string, tier: ContextTier): void {
  const raw = readLedgerRaw(filePath);
  if (raw.length === 0) return;

  // eslint-disable-next-line security/detect-object-injection -- tier is from enum
  const budget = TIER_BUDGETS[tier];
  const tokens = estimateTokens(raw);

  if (tokens <= budget) return;

  const compacted = compactLedgerContent(raw, budget, tier);
  atomicWrite(filePath, compacted);
}

/**
 * Clean up expired session ledger files older than TTL.
 */
export function cleanupExpiredLedgers(sessionsDir: string, ttlMs: number = 24 * 60 * 60 * 1000): void {
  if (!existsSync(sessionsDir)) return;

  const now = Date.now();
  const files = readdirSync(sessionsDir).filter(f => f.endsWith('.session.md'));

  for (const file of files) {
    const filePath = join(sessionsDir, file);
    try {
      const stat = statSync(filePath);
      if (now - stat.mtimeMs > ttlMs) {
        unlinkSync(filePath);
      }
    } catch {
      // Ignore errors during cleanup
    }
  }
}

// ─── Internal Helpers ────────────────────────────────────────────────

function readLedgerRaw(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, filePath);
}

function compactLedgerContent(raw: string, budget: number, tier: ContextTier): string {
  const sections = raw.split(/^---$/m).map(s => s.trim()).filter(s => s.length > 0);
  if (sections.length <= 2) return raw;

  // Header is always first section
  const header = sections[0]!;
  const phaseSections = sections.slice(1);

  // Keep last N phases full based on tier
  const keepFull = tier === 'minimal' ? 1 : tier === 'lite' ? 2 : tier === 'standard' ? 2 : 3;
  const fullPhases = phaseSections.slice(-keepFull);
  const compactPhases = phaseSections.slice(0, -keepFull);

  const compactedLines = compactPhases.map(section => {
    const phaseMatch = /## Phase: (\w+)/.exec(section);
    const phaseName = phaseMatch?.[1] ?? 'UNKNOWN';

    // Preserve DecisionRecord references
    const decisions = section.match(/\[DEC-\d+\]/g) ?? [];
    const decisionNote = decisions.length > 0 ? ` (${decisions.join(', ')})` : '';

    return `${phaseName}: ✅ completed${decisionNote}`;
  });

  const result = [
    header,
    '---',
    ...compactedLines.map(l => l),
    '---',
    ...fullPhases.flatMap(s => [s, '---']),
  ].join('\n\n');

  // If still over budget, truncate
  if (estimateTokens(result) > budget) {
    return result.slice(0, budget * 4);
  }

  return result;
}
