import type { ModelInfo } from '../providers/types';

export type CostTier = 'budget' | 'middle' | 'premium' | 'local';

export interface TieredModel {
  providerId: string;
  providerName: string;
  displayGroup: string;
  displayGroupName: string;
  model: ModelInfo;
  tier: CostTier;
  priority: number;
}

const PREMIUM_KEYWORDS = [
  'opus', // All Opus models are premium (covers 4, 4.1, 4.5, 4.6, etc.)
  'gpt-5.4',
  'gpt-5.3',
  'gpt-5.2',
  'GPT-5.2',
  'gpt-5.1',
  'gpt-4.1',
  '-pro-',
  '-pro',
  'codex',

  ':70b',
  ':72b',
  ':120b',
  ':180b',
  ':405b',
  '-70b',
  '-72b',
  '-120b',
  '-180b',
  '-405b',
];

const BUDGET_KEYWORDS = [
  'haiku',
  'mini',
  'nano',
  '3-flash',

  'phi',
  'tinyllama',
  ':0.5b',
  ':1b',
  ':1.5b',
  ':2b',
  ':3b',
  '-0.5b',
  '-1b',
  '-1.5b',
  '-2b',
  '-3b',
];

const MODEL_PRIORITY: Record<string, number> = {
  'claude-opus-4-6': 1,
  'claude-opus-4.6': 1,
  'gpt-5.4': 2,
  'gpt-5.3-codex': 3,
  'gpt-5.2': 4,
  'GPT-5.2-Codex': 4,
  'gpt-5.1': 5,
  'gpt-5.1-codex': 5,
  'claude-opus-4-5-20251101': 6,
  'claude-opus-4.5': 6,
  'gpt-4.1': 7,
  'claude-sonnet-4-5-20250929': 8,
  'claude-sonnet-4.5': 8,
  'gemini-3.1-pro-preview': 8,
  'gemini-3-pro-preview': 9,
  'gemini-2.5-pro': 10,
  'gemini-2.5-pro-preview': 10,

  'llama3.3:70b': 10,
  'qwen2.5:72b': 10,
  'mixtral:8x22b': 10,

  'claude-sonnet-4-20250514': 11,
  'gemini-3.1-flash-preview': 12,
  'gemini-3-flash-preview': 13,
  'gemini-2.5-flash': 14,
  'gemini-2.0-flash': 15,

  'llama3.3:latest': 16,
  'llama3.2:latest': 16,
  'qwen2.5:latest': 16,
  'qwen2.5:7b': 16,
  'qwen2.5:14b': 17,
  'mistral:latest': 17,
  'mixtral:latest': 17,
  'gemma2:latest': 17,
  'codellama:latest': 18,
  'deepseek-coder:latest': 18,

  'claude-haiku-4-5-20251001': 22,
  'gpt-4.1-mini': 23,

  'phi:latest': 27,
  'phi3:latest': 27,
  'gemma2:2b': 27,
  'tinyllama:latest': 28,
};

const OPENROUTER_COMPANY_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  'meta-llama': 'Meta',
  'x-ai': 'xAI',
  moonshotai: 'Kimi',
  minimax: 'MiniMax',
  'z-ai': 'GLM (Zhipu)',
};

export function getDisplayGroup(
  providerId: string,
  modelId: string
): { displayGroup: string; displayGroupName: string } {
  if (providerId === 'openrouter') {
    const slashIdx = modelId.indexOf('/');
    if (slashIdx > 0) {
      const prefix = modelId.substring(0, slashIdx);
      // eslint-disable-next-line security/detect-object-injection -- prefix from modelId split
      const companyName = OPENROUTER_COMPANY_NAMES[prefix] ?? prefix;
      return {
        displayGroup: `openrouter-${prefix}`,
        displayGroupName: `${companyName} (OpenRouter)`,
      };
    }
  }
  if (providerId === 'ollama') {
    return { displayGroup: 'ollama', displayGroupName: 'Ollama (Local)' };
  }
  return { displayGroup: providerId, displayGroupName: '' };
}

function extractModelSize(modelId: string): number {
  const match = modelId.match(/[:-](\d+)b/i);
  return match?.[1] !== undefined && match[1].length > 0 ? parseInt(match[1], 10) : 0;
}

export function getModelTier(modelId: string): CostTier {
  const lowerModelId = modelId.toLowerCase();

  if (PREMIUM_KEYWORDS.some(keyword => lowerModelId.includes(keyword))) {
    return 'premium';
  }

  if (BUDGET_KEYWORDS.some(keyword => lowerModelId.includes(keyword))) {
    return 'budget';
  }

  return 'middle';
}

export function getModelTierWithBilling(
  modelId: string,
  billingMultiplier?: number | undefined
): CostTier {
  if (billingMultiplier !== undefined) {
    if (billingMultiplier >= 2.0) return 'premium';
    if (billingMultiplier >= 0.5) return 'middle';
    return 'budget';
  }
  return getModelTier(modelId);
}

export function getModelPriority(modelId: string): number {
  // eslint-disable-next-line security/detect-object-injection -- modelId from trusted provider data
  if (MODEL_PRIORITY[modelId] !== undefined) return MODEL_PRIORITY[modelId]!;
  const slashIdx = modelId.indexOf('/');
  if (slashIdx > 0) {
    const bare = modelId.substring(slashIdx + 1);
    // eslint-disable-next-line security/detect-object-injection -- bare from modelId split
    if (MODEL_PRIORITY[bare] !== undefined) return MODEL_PRIORITY[bare]!;
  }
  return 999;
}

export function getModelPrice(model: ModelInfo): number | undefined {
  const p = model.capabilities.pricing;
  if (!p) return undefined;
  return p.promptPer1M + p.completionPer1M;
}

export function categorizeModels(
  providerModels: Array<{ providerId: string; providerName: string; models: ModelInfo[] }>
): TieredModel[] {
  const tiered: TieredModel[] = [];
  const seenModels = new Set<string>();

  for (const provider of providerModels) {
    for (const model of provider.models) {
      const modelKey = `${provider.providerId}:${model.id}`;

      if (seenModels.has(modelKey)) {
        continue;
      }
      seenModels.add(modelKey);

      const { displayGroup, displayGroupName } = getDisplayGroup(provider.providerId, model.id);

      tiered.push({
        providerId: provider.providerId,
        providerName: provider.providerName,
        displayGroup,
        displayGroupName: displayGroupName || provider.providerName,
        model,
        tier: provider.providerId === 'ollama' ? 'local' : getModelTier(model.id),
        priority: getModelPriority(model.id),
      });
    }
  }

  tiered.sort((a, b) => {
    const tierOrder: Record<CostTier, number> = { premium: 0, middle: 1, budget: 2, local: 3 };
    const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
    if (tierDiff !== 0) return tierDiff;

    return a.priority - b.priority;
  });

  return tiered;
}

export function filterModelsByTier(models: TieredModel[], preference: CostTier): TieredModel[] {
  const filtered = models.filter(m => {
    switch (preference) {
      case 'local':
        return m.providerId === 'ollama';

      case 'premium':
        return m.providerId !== 'ollama' && (m.tier === 'premium' || m.tier === 'middle');

      case 'middle':
        return m.providerId !== 'ollama';

      case 'budget':
        return m.providerId === 'ollama' || m.tier === 'budget' || m.tier === 'middle';
    }
  });

  return filtered.sort((a, b) => {
    if (preference === 'budget') {
      const aIsLocal = a.providerId === 'ollama';
      const bIsLocal = b.providerId === 'ollama';
      if (aIsLocal && !bIsLocal) return -1;
      if (!aIsLocal && bIsLocal) return 1;

      if (aIsLocal && bIsLocal) {
        const aSize = extractModelSize(a.model.id);
        const bSize = extractModelSize(b.model.id);
        if (aSize !== bSize) return aSize - bSize;
        return a.model.id.localeCompare(b.model.id);
      }

      return b.priority - a.priority;
    }

    const aTierMatch = a.tier === preference ? 0 : 1;
    const bTierMatch = b.tier === preference ? 0 : 1;
    if (aTierMatch !== bTierMatch) return aTierMatch - bTierMatch;

    const tierOrder: Record<CostTier, number> = { premium: 0, middle: 1, budget: 2, local: 3 };
    const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
    if (tierDiff !== 0) return tierDiff;

    if (preference === 'local' && a.providerId === 'ollama' && b.providerId === 'ollama') {
      const aSize = extractModelSize(a.model.id);
      const bSize = extractModelSize(b.model.id);
      if (aSize !== bSize) return aSize - bSize;
      return a.model.id.localeCompare(b.model.id);
    }

    return a.priority - b.priority;
  });
}

export function getTierLabel(tier: CostTier): string {
  switch (tier) {
    case 'local':
      return 'Free (Local Models)';
    case 'budget':
      return 'Lowest Cost (Budget)';
    case 'middle':
      return 'Medium Cost (Balanced)';
    case 'premium':
      return 'Highest Cost (Premium)';
  }
}

export function getTierEmoji(tier: CostTier): string {
  switch (tier) {
    case 'local':
      return '🏠';
    case 'premium':
      return '👑';
    case 'middle':
      return '⚖️';
    case 'budget':
      return '💰';
  }
}

/**
 * Get the recommended history window (message count) for a given cost tier.
 * Budget/local models get fewer messages to reduce costs; premium get more for richer context.
 */
export function getTierHistoryWindow(tier: CostTier): number {
  switch (tier) {
    case 'budget':
    case 'local':
      return 10;
    case 'middle':
      return 20;
    case 'premium':
      return 40;
  }
}

/**
 * Get the recommended token budget for history windowing per tier.
 * Used by trimMessages when maxHistoryMessages is not set.
 */
export function getTierTokenBudget(tier: CostTier): number {
  switch (tier) {
    case 'budget':
    case 'local':
      return 4096;
    case 'middle':
      return 8192;
    case 'premium':
      return 16384;
  }
}

/**
 * Rough token estimate: ~4 characters per token (ceiling).
 * Used for lightweight token counting without a full tokenizer.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}
