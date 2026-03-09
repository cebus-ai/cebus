/**
 * Orchestrator LLM Discovery
 *
 * Discovers models suitable for orchestrator middleware duty.
 * Includes: ALL Ollama chat models (free, local), all cloud tiers, and Copilot models.
 * Excludes: Embedding/non-chat models.
 */

import { getProviderRegistry, initializeProviders } from '../providers/index.js';
import { getModelTier, getModelPriority, getDisplayGroup, type CostTier } from './model-tiers.js';

export interface OrchestratorLLMOption {
  spec: string; // "providerId:modelId"
  displayName: string;
  nickname: string;
  provider: string;
  providerName: string;
  tier: CostTier;
  isDefault: boolean; // true for ollama:llama3.2
}

const DEFAULT_SPEC = 'ollama:llama3.2';

/**
 * Keywords that indicate a model is NOT a chat model (embedding, reranking, etc.).
 * These are filtered out from orchestrator options.
 */
const NON_CHAT_KEYWORDS = [
  'embed',
  'minilm',
  'bge-',
  'rerank',
  'snowflake-arctic-embed',
  'dall-e',
  'whisper',
  'tts',
  'moderation',
  'deep-research',
  'computer-use',
  'realtime',
  'audio',
  'chatgpt-image',
  'search-preview',
] as const;

/**
 * Discover models eligible for orchestrator duty.
 * Returns sorted list: premium → middle → budget → local, grouped by provider.
 */
export async function discoverOrchestratorLLMOptions(): Promise<OrchestratorLLMOption[]> {
  await initializeProviders();
  const registry = getProviderRegistry();
  const providers = await registry.getAvailable();

  const options: OrchestratorLLMOption[] = [];

  for (const provider of providers) {
    const models = await provider.listModels();

    for (const model of models) {
      // Filter out non-chat models (embeddings, image gen, etc.)
      const lowerModelId = model.id.toLowerCase();
      if (NON_CHAT_KEYWORDS.some(kw => lowerModelId.includes(kw))) continue;

      const isLocal = provider.id === 'ollama';
      const tier = isLocal ? 'local' : getModelTier(model.id);

      const spec = `${provider.id}:${model.id}`;
      const { displayGroup, displayGroupName } = getDisplayGroup(provider.id, model.id);
      options.push({
        spec,
        displayName: model.displayName,
        nickname: model.defaultNickname,
        provider: displayGroup,
        providerName: displayGroupName || provider.displayName,
        tier: isLocal ? 'local' : tier,
        isDefault: spec === DEFAULT_SPEC,
      });
    }
  }

  // Sort: provider group first, then tier within group, then best model first
  const tierOrder: Record<CostTier, number> = { premium: 0, middle: 1, budget: 2, local: 3 };
  const providerGroupOrder: Record<string, number> = {
    openai: 0,
    'openrouter-openai': 1,
    anthropic: 2,
    'openrouter-anthropic': 3,
    google: 4,
    'openrouter-google': 5,
    copilot: 6,
    'openrouter-x-ai': 7,
    'openrouter-meta-llama': 8,
    ollama: 20,
  };
  // eslint-disable-next-line security/detect-object-injection -- provider from known provider list
  const getProviderOrder = (provider: string): number => providerGroupOrder[provider] ?? 10;

  options.sort((a, b) => {
    const provDiff = getProviderOrder(a.provider) - getProviderOrder(b.provider);
    if (provDiff !== 0) return provDiff;
    const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
    if (tierDiff !== 0) return tierDiff;
    const aModelId = a.spec.substring(a.spec.indexOf(':') + 1);
    const bModelId = b.spec.substring(b.spec.indexOf(':') + 1);
    const aPrio = getModelPriority(aModelId);
    const bPrio = getModelPriority(bModelId);
    if (aPrio !== bPrio) return aPrio - bPrio;
    // Reverse alphabetical so higher version numbers appear first (e.g., "4.1" before "3")
    return b.displayName.localeCompare(a.displayName);
  });

  return options;
}
