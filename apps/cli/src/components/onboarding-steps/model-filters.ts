import { filterModelsByTier } from '@cebus/engine';
import type { CostTier, TieredModel, OrchestratorLLMOption } from '@cebus/engine';
import type { AvailableModel } from './types';

const DEFAULT_VISIBLE = 3;

/** Display order for provider groups in the AI Model selection step. */
const MODEL_PROVIDER_ORDER: Record<string, number> = {
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

function sortGroups(groups: string[]): string[] {
  return groups.sort((a, b) => {
    // eslint-disable-next-line security/detect-object-injection -- key from known provider set
    const aOrder = MODEL_PROVIDER_ORDER[a] ?? 10;
    // eslint-disable-next-line security/detect-object-injection -- key from known provider set
    const bOrder = MODEL_PROVIDER_ORDER[b] ?? 10;
    return aOrder - bOrder;
  });
}

const OLLAMA_FAMILIES = [
  'codellama',
  'tinyllama',
  'llama',
  'deepseek',
  'gemma',
  'phi',
  'mistral',
  'mixtral',
  'qwen',
];

function getOllamaFamily(modelId: string): string {
  const lower = modelId.toLowerCase();
  for (const family of OLLAMA_FAMILIES) {
    if (lower.startsWith(family)) return family;
  }
  return lower.split(/[:\d]/)[0] ?? lower;
}

/**
 * Get all models for a display group: tier-matched models first, then remaining
 * models from the full list. This ensures at least DEFAULT_VISIBLE and
 * allows M-key expansion to reveal the full catalog.
 */
function getGroupModels(allModels: TieredModel[], tier: CostTier, group: string): TieredModel[] {
  const filtered = filterModelsByTier(allModels, tier).filter(m => m.displayGroup === group);

  const sortFn = (a: TieredModel, b: TieredModel): number => {
    const aTierMatch = a.tier === tier ? 0 : 1;
    const bTierMatch = b.tier === tier ? 0 : 1;
    if (aTierMatch !== bTierMatch) return aTierMatch - bTierMatch;
    return tier === 'budget' ? b.priority - a.priority : a.priority - b.priority;
  };

  filtered.sort(sortFn);

  if (tier !== 'local') {
    const filteredIds = new Set(filtered.map(m => m.model.id));
    const extras = allModels
      .filter(m => m.displayGroup === group && !filteredIds.has(m.model.id))
      .sort(sortFn);
    filtered.push(...extras);
  }

  return filtered;
}

export interface ApplyTierFilterResult {
  models: AvailableModel[];
  defaultSelections: string[];
}

export function applyTierFilter(allModels: TieredModel[], tier: CostTier): ApplyTierFilterResult {
  const filtered = filterModelsByTier(allModels, tier);

  const seen = new Set<string>();
  const groups: string[] = [];
  for (const m of filtered) {
    if (!seen.has(m.displayGroup)) {
      seen.add(m.displayGroup);
      groups.push(m.displayGroup);
    }
  }
  for (const m of allModels) {
    if (!seen.has(m.displayGroup)) {
      seen.add(m.displayGroup);
      groups.push(m.displayGroup);
    }
  }
  sortGroups(groups);

  const models: AvailableModel[] = [];
  const defaultSelections: string[] = [];
  const seenSpecs = new Set<string>();

  for (const group of groups) {
    const groupModels = getGroupModels(allModels, tier, group);
    const limit = tier === 'local' ? groupModels.length : DEFAULT_VISIBLE;
    const visibleModels = groupModels.slice(0, limit);

    for (const tieredModel of visibleModels) {
      const spec = `${tieredModel.providerId}:${tieredModel.model.id}`;
      if (seenSpecs.has(spec)) continue;
      seenSpecs.add(spec);

      models.push({
        spec,
        displayName: tieredModel.model.displayName,
        provider: tieredModel.displayGroup,
        providerName: tieredModel.displayGroupName,
        nickname: tieredModel.model.defaultNickname,
        tier: tieredModel.tier,
      });
    }

    if (tier === 'local') {
      const seenFamilies = new Set<string>();
      for (const m of visibleModels) {
        const family = getOllamaFamily(m.model.id);
        if (!seenFamilies.has(family)) {
          seenFamilies.add(family);
          defaultSelections.push(`${m.providerId}:${m.model.id}`);
        }
      }
    } else {
      const firstModel = visibleModels[0];

      if (firstModel) {
        defaultSelections.push(`${firstModel.providerId}:${firstModel.model.id}`);
      }
    }
  }

  return { models, defaultSelections };
}

export function rebuildAvailableModels(
  allModels: TieredModel[],
  costPreference: CostTier,
  expanded: Map<string, number>
): AvailableModel[] {
  const filtered = filterModelsByTier(allModels, costPreference);

  const seen = new Set<string>();
  const groups: string[] = [];
  for (const m of filtered) {
    if (!seen.has(m.displayGroup)) {
      seen.add(m.displayGroup);
      groups.push(m.displayGroup);
    }
  }
  for (const m of allModels) {
    if (!seen.has(m.displayGroup)) {
      seen.add(m.displayGroup);
      groups.push(m.displayGroup);
    }
  }
  sortGroups(groups);

  const models: AvailableModel[] = [];
  const seenSpecs = new Set<string>();

  for (const group of groups) {
    const groupModels = getGroupModels(allModels, costPreference, group);
    const limit =
      costPreference === 'local' ? groupModels.length : (expanded.get(group) ?? DEFAULT_VISIBLE);
    const visibleModels = groupModels.slice(0, limit);

    for (const tieredModel of visibleModels) {
      const spec = `${tieredModel.providerId}:${tieredModel.model.id}`;
      if (seenSpecs.has(spec)) continue;
      seenSpecs.add(spec);

      models.push({
        spec,
        displayName: tieredModel.model.displayName,
        provider: tieredModel.displayGroup,
        providerName: tieredModel.displayGroupName,
        nickname: tieredModel.model.defaultNickname,
        tier: tieredModel.tier,
      });
    }
  }

  return models;
}

export function getTotalProviderModels(
  allModels: TieredModel[],
  costPreference: CostTier,
  group: string
): number {
  return getGroupModels(allModels, costPreference, group).length;
}

export function rebuildOrchestratorOptions(
  allOptions: OrchestratorLLMOption[],
  expanded: Set<string>
): OrchestratorLLMOption[] {
  const byProvider = new Map<string, OrchestratorLLMOption[]>();
  for (const option of allOptions) {
    if (!byProvider.has(option.provider)) {
      byProvider.set(option.provider, []);
    }
    byProvider.get(option.provider)!.push(option);
  }

  const visible: OrchestratorLLMOption[] = [];
  for (const [provider, providerOptions] of byProvider) {
    const limit = expanded.has(provider) ? providerOptions.length : 3;
    visible.push(...providerOptions.slice(0, limit));
  }

  return visible;
}

export function hasMoreOrchestratorModels(
  allOptions: OrchestratorLLMOption[],
  visibleOptions: OrchestratorLLMOption[],
  providerId: string
): boolean {
  const allCount = allOptions.filter(o => o.provider === providerId).length;
  const visibleCount = visibleOptions.filter(o => o.provider === providerId).length;
  return allCount > visibleCount;
}
