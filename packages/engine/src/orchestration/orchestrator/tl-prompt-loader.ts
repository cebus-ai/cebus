import type { ContextTier } from '../types.js';
import { loadOrchestratorPrompt } from '../config/defaults.js';

/** Priority levels for prompt sections. */
type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

interface PrioritySection {
  priority: Priority;
  content: string;
}

/** Priority sections included per context tier. */
const TIER_PRIORITIES: Record<ContextTier, Priority[]> = {
  not_supported: ['CRITICAL'],
  minimal: ['CRITICAL'],
  lite: ['CRITICAL', 'HIGH'],
  standard: ['CRITICAL', 'HIGH', 'MEDIUM'],
  full: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
  extended: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
};

/** Context window thresholds for tier detection. */
const TIER_THRESHOLDS: Array<{ min: number; max: number; tier: ContextTier }> = [
  { min: 0, max: 8_000, tier: 'not_supported' },
  { min: 8_000, max: 16_000, tier: 'minimal' },
  { min: 16_000, max: 32_000, tier: 'lite' },
  { min: 32_000, max: 64_000, tier: 'standard' },
  { min: 64_000, max: 200_000, tier: 'full' },
  { min: 200_000, max: Infinity, tier: 'extended' },
];

/**
 * Parse `<!-- PRIORITY: LEVEL -->` HTML comments from markdown content.
 * Sections without priority markers are treated as CRITICAL (always included).
 */
export function parsePrioritySections(markdown: string): PrioritySection[] {
  const sections: PrioritySection[] = [];
  const lines = markdown.split('\n');

  let currentPriority: Priority = 'CRITICAL';
  let currentContent: string[] = [];

  for (const line of lines) {
    const match = /<!--\s*PRIORITY:\s*(CRITICAL|HIGH|MEDIUM|LOW)\s*-->/.exec(line);
    if (match !== null) {
      if (currentContent.length > 0) {
        const content = currentContent.join('\n').trim();
        if (content.length > 0) {
          sections.push({ priority: currentPriority, content });
        }
      }
      currentPriority = match[1] as Priority;
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  if (currentContent.length > 0) {
    const content = currentContent.join('\n').trim();
    if (content.length > 0) {
      sections.push({ priority: currentPriority, content });
    }
  }

  return sections;
}

/**
 * Trim priority sections to fit the given context tier.
 * Returns only sections at or above the tier's minimum priority.
 */
export function trimByTier(markdown: string, tier: ContextTier): string {
  const sections = parsePrioritySections(markdown);
  // eslint-disable-next-line security/detect-object-injection -- tier is from enum
  const allowedPriorities = TIER_PRIORITIES[tier];

  const included = sections.filter(s => allowedPriorities.includes(s.priority));
  return included.map(s => s.content).join('\n\n');
}

/**
 * Determine the context tier from a model's context window size.
 */
export function getContextTier(contextWindowSize: number): ContextTier {
  for (const { min, max, tier } of TIER_THRESHOLDS) {
    if (contextWindowSize >= min && contextWindowSize < max) {
      return tier;
    }
  }
  return 'standard';
}

/**
 * Load and trim the phase-specific prompt file.
 * Swap-not-accumulate: only ONE phase .md is loaded at a time.
 */
export function getPhasePrompt(phase: string | null, tier: ContextTier): string | null {
  if (phase === null) return null;
  const raw = loadOrchestratorPrompt(`${phase}.md`);
  if (raw === undefined || raw.length === 0) return null;
  return trimByTier(raw, tier);
}

/**
 * Load and trim the core TL prompt file (team-leader.md).
 */
export function getTlCorePrompt(tier: ContextTier): string {
  const raw = loadOrchestratorPrompt('team-leader.md');
  if (raw === undefined || raw.length === 0) return '';
  return trimByTier(raw, tier);
}
