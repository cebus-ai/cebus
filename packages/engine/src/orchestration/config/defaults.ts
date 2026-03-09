/**
 * Orchestration Configuration Defaults
 *
 * Loads prompt files from .cebus/prompts/ at runtime.
 * Edit the .md files to change model behavior — no rebuild needed.
 *
 * Resolution: findProjectRoot() walks up from cwd to find the .cebus/ marker,
 * then reads .cebus/prompts/{path} from that root.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ChatMode } from '../../core/types.js';
import type { CostTier } from '../../core/model-tiers.js';
import { findProjectRoot } from '../../core/project-root.js';

const _promptCache = new Map<string, string>();

const FALLBACK_PROMPT = `You are participating in a group chat with a user and other AI models.
Respond naturally and concisely. Don't prefix your response with your name.`;

/**
 * Load a prompt file by relative path under the prompts/ directory.
 * Cached after first read. Returns empty string if file is missing.
 */
function loadPromptFile(relativePath: string): string {
  const cached = _promptCache.get(relativePath);
  if (cached !== undefined) return cached;

  const promptPath = resolve(findProjectRoot(), '.cebus', 'prompts', relativePath);
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- promptPath from project root + known subfolder
    const content = readFileSync(promptPath, 'utf-8').trim();
    _promptCache.set(relativePath, content);
    return content;
  } catch {
    _promptCache.set(relativePath, '');
    return '';
  }
}

export function getDefaultSystemPrompt(): string {
  const loaded = loadPromptFile('system.md');
  return loaded || FALLBACK_PROMPT;
}

const MODE_SLUG: Record<ChatMode, string> = {
  free_chat: 'free-chat',
  sequential: 'sequential',
  tag_only: 'tag-only',
  role_based: 'role-based',
  raw: 'raw',
};

export function getModePrompt(mode: ChatMode): string {
  // eslint-disable-next-line security/detect-object-injection -- mode is typed ChatMode enum
  const slug = MODE_SLUG[mode];
  return loadPromptFile(`modes/${slug}.md`);
}

export function getTierPrompt(tier: CostTier): string {
  return loadPromptFile(`tiers/${tier}.md`);
}

export function loadOrchestratorPrompt(filename: string): string {
  return loadPromptFile(`orchestrator/${filename}`);
}
