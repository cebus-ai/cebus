/**
 * Orchestration Configuration Defaults
 *
 * Loads prompt files from .cebus/prompts/ at runtime.
 * Edit the .md files to change model behavior — no rebuild needed.
 *
 * Resolution order:
 * 1. .cebus/prompts/{path} (relative to cwd — primary)
 * 2. {packageDir}/.cebus/prompts/{path} (relative to this module — works after npm install)
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ChatMode } from '../../core/types.js';
import type { CostTier } from '../../core/model-tiers.js';

const _promptCache = new Map<string, string>();

const FALLBACK_PROMPT = `You are participating in a group chat with a user and other AI models.
Respond naturally and concisely. Don't prefix your response with your name.`;

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPromptFile(relativePath: string): string {
  const cached = _promptCache.get(relativePath);
  if (cached !== undefined) return cached;

  const searchBases = [
    resolve(process.cwd(), '.cebus/prompts'),
    resolve(__dirname, '..', '..', '..', '.cebus', 'prompts'),
  ];

  const searchPaths = searchBases
    .map(base => {
      const full = resolve(base, relativePath);
      return full.startsWith(base) ? full : null;
    })
    .filter((p): p is string => p !== null);

  for (const promptPath of searchPaths) {
    try {
      const content = readFileSync(promptPath, 'utf-8').trim();
      _promptCache.set(relativePath, content);
      return content;
    } catch {
      // Try next path
    }
  }

  _promptCache.set(relativePath, '');
  return '';
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
};

export function getModePrompt(mode: ChatMode): string {
  const slug = MODE_SLUG[mode];
  return loadPromptFile(`modes/${slug}.md`);
}

export function getTierPrompt(tier: CostTier): string {
  return loadPromptFile(`tiers/${tier}.md`);
}

export function loadOrchestratorPrompt(filename: string): string {
  return loadPromptFile(`orchestrator/${filename}`);
}
