/**
 * Model Pricing Engine
 *
 * Provides cost estimation for all supported AI models.
 * Three-layer resolution (highest priority first):
 *   1. User override: .cebus/pricing.json
 *   2. Daily cache: .cebus/pricing-cache.json (auto-refreshed)
 *   3. Built-in defaults: hardcoded below
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { findProjectRoot } from './project-root.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelPricing {
  readonly modelId: string;
  readonly inputPricePerMTok: number;
  readonly outputPricePerMTok: number;
  readonly cachedInputPricePerMTok: number;
  readonly contextWindow: number;
}

export interface CostEstimate {
  readonly inputCost: number;
  readonly outputCost: number;
  readonly cacheSavings: number;
  readonly totalCost: number;
}

interface PricingCache {
  fetchedAt: string;
  models: ModelPricing[];
}

// ---------------------------------------------------------------------------
// Built-in defaults (Feb 2026 — official provider pricing pages)
// ---------------------------------------------------------------------------

const BUILT_IN_PRICING: readonly ModelPricing[] = [
  // ── Anthropic ──────────────────────────────────────────────────────────
  {
    modelId: 'claude-opus-4-6',
    inputPricePerMTok: 5,
    outputPricePerMTok: 25,
    cachedInputPricePerMTok: 0.5,
    contextWindow: 200_000,
  },
  {
    modelId: 'claude-opus-4.6',
    inputPricePerMTok: 5,
    outputPricePerMTok: 25,
    cachedInputPricePerMTok: 0.5,
    contextWindow: 200_000,
  },
  {
    modelId: 'claude-opus-4-5-20251101',
    inputPricePerMTok: 5,
    outputPricePerMTok: 25,
    cachedInputPricePerMTok: 0.5,
    contextWindow: 200_000,
  },
  {
    modelId: 'claude-opus-4.5',
    inputPricePerMTok: 5,
    outputPricePerMTok: 25,
    cachedInputPricePerMTok: 0.5,
    contextWindow: 200_000,
  },
  {
    modelId: 'claude-sonnet-4-5-20250929',
    inputPricePerMTok: 3,
    outputPricePerMTok: 15,
    cachedInputPricePerMTok: 0.3,
    contextWindow: 200_000,
  },
  {
    modelId: 'claude-sonnet-4.5',
    inputPricePerMTok: 3,
    outputPricePerMTok: 15,
    cachedInputPricePerMTok: 0.3,
    contextWindow: 200_000,
  },
  {
    modelId: 'claude-haiku-4-5-20251001',
    inputPricePerMTok: 1,
    outputPricePerMTok: 5,
    cachedInputPricePerMTok: 0.1,
    contextWindow: 200_000,
  },
  {
    modelId: 'claude-haiku-4.5',
    inputPricePerMTok: 1,
    outputPricePerMTok: 5,
    cachedInputPricePerMTok: 0.1,
    contextWindow: 200_000,
  },

  // ── OpenAI ─────────────────────────────────────────────────────────────
  {
    modelId: 'gpt-5.4',
    inputPricePerMTok: 2,
    outputPricePerMTok: 16,
    cachedInputPricePerMTok: 0.2,
    contextWindow: 256_000,
  },
  {
    modelId: 'gpt-5.3-codex',
    inputPricePerMTok: 2,
    outputPricePerMTok: 16,
    cachedInputPricePerMTok: 0.2,
    contextWindow: 256_000,
  },
  {
    modelId: 'gpt-5.2',
    inputPricePerMTok: 1.75,
    outputPricePerMTok: 14,
    cachedInputPricePerMTok: 0.175,
    contextWindow: 128_000,
  },
  {
    modelId: 'GPT-5.2-Codex',
    inputPricePerMTok: 1.75,
    outputPricePerMTok: 14,
    cachedInputPricePerMTok: 0.175,
    contextWindow: 128_000,
  },
  {
    modelId: 'gpt-5.1',
    inputPricePerMTok: 1.25,
    outputPricePerMTok: 10,
    cachedInputPricePerMTok: 0.125,
    contextWindow: 128_000,
  },
  {
    modelId: 'gpt-5.1-codex',
    inputPricePerMTok: 1.25,
    outputPricePerMTok: 10,
    cachedInputPricePerMTok: 0.125,
    contextWindow: 128_000,
  },
  {
    modelId: 'gpt-4.1',
    inputPricePerMTok: 2,
    outputPricePerMTok: 8,
    cachedInputPricePerMTok: 0.5,
    contextWindow: 1_000_000,
  },
  {
    modelId: 'gpt-4.1-mini',
    inputPricePerMTok: 0.4,
    outputPricePerMTok: 1.6,
    cachedInputPricePerMTok: 0.1,
    contextWindow: 1_000_000,
  },
  {
    modelId: 'gpt-4o',
    inputPricePerMTok: 2.5,
    outputPricePerMTok: 10,
    cachedInputPricePerMTok: 1.25,
    contextWindow: 128_000,
  },
  {
    modelId: 'gpt-4o-mini',
    inputPricePerMTok: 0.15,
    outputPricePerMTok: 0.6,
    cachedInputPricePerMTok: 0.075,
    contextWindow: 128_000,
  },

  // ── Gemini ─────────────────────────────────────────────────────────────
  {
    modelId: 'gemini-3.1-pro-preview',
    inputPricePerMTok: 2,
    outputPricePerMTok: 12,
    cachedInputPricePerMTok: 0.2,
    contextWindow: 1_000_000,
  },
  {
    modelId: 'gemini-3.1-flash-preview',
    inputPricePerMTok: 0.5,
    outputPricePerMTok: 3,
    cachedInputPricePerMTok: 0.05,
    contextWindow: 1_000_000,
  },
  {
    modelId: 'gemini-3-pro-preview',
    inputPricePerMTok: 2,
    outputPricePerMTok: 12,
    cachedInputPricePerMTok: 0.2,
    contextWindow: 1_000_000,
  },
  {
    modelId: 'gemini-3-flash-preview',
    inputPricePerMTok: 0.5,
    outputPricePerMTok: 3,
    cachedInputPricePerMTok: 0.05,
    contextWindow: 1_000_000,
  },
  {
    modelId: 'gemini-2.5-pro',
    inputPricePerMTok: 1.25,
    outputPricePerMTok: 10,
    cachedInputPricePerMTok: 0.125,
    contextWindow: 1_000_000,
  },
  {
    modelId: 'gemini-2.5-flash',
    inputPricePerMTok: 0.3,
    outputPricePerMTok: 2.5,
    cachedInputPricePerMTok: 0.03,
    contextWindow: 1_000_000,
  },
  {
    modelId: 'gemini-2.0-flash',
    inputPricePerMTok: 0.1,
    outputPricePerMTok: 0.4,
    cachedInputPricePerMTok: 0.025,
    contextWindow: 1_000_000,
  },
] as const;

// ---------------------------------------------------------------------------
// In-memory pricing table (merged from all 3 layers)
// ---------------------------------------------------------------------------

/** Merged pricing: built-in → daily cache → user override (last wins). */
const activePricing: Map<string, ModelPricing> = new Map(
  BUILT_IN_PRICING.map(p => [p.modelId.toLowerCase(), p])
);

let initialized = false;
let refreshPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Initialization (load overrides + cached data)
// ---------------------------------------------------------------------------

function getCebusDir(): string {
  return join(findProjectRoot(), '.cebus');
}

async function loadJsonFile<T>(path: string): Promise<T | null> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from internal config
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function mergePricing(models: ModelPricing[]): void {
  for (const m of models) {
    activePricing.set(m.modelId.toLowerCase(), m);
  }
}

let initPromise: Promise<void> | null = null;

function initializePricing(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async (): Promise<void> => {
    const cebusDir = getCebusDir();

    // Layer 2: daily cache
    const cache = await loadJsonFile<PricingCache>(join(cebusDir, 'pricing-cache.json'));
    if (cache?.models) {
      mergePricing(cache.models);
    }

    // Layer 1: user override (highest priority — loaded last so it wins)
    const userOverride = await loadJsonFile<{ models: ModelPricing[] }>(
      join(cebusDir, 'pricing.json')
    );
    if (userOverride?.models) {
      mergePricing(userOverride.models);
    }

    initialized = true;
  })();

  return initPromise;
}

// ---------------------------------------------------------------------------
// Daily refresh from OpenRouter API
// ---------------------------------------------------------------------------

const OPENROUTER_API = 'https://openrouter.ai/api/v1/models';
const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

const SUPPORTED_PREFIXES = ['openai/', 'anthropic/', 'google/', 'meta-llama/', 'x-ai/'];

interface OpenRouterModel {
  id: string;
  context_length?: number | undefined;
  pricing?: { prompt?: string | undefined; completion?: string | undefined } | undefined;
}

function toPerMTok(perToken: string | undefined): number {
  if (perToken === undefined || perToken.length === 0) return 0;
  const val = parseFloat(perToken);
  if (isNaN(val) || val <= 0) return 0;
  return parseFloat((val * 1_000_000).toPrecision(6));
}

function toBareModelId(orId: string): string {
  const idx = orId.indexOf('/');
  return idx > 0 ? orId.substring(idx + 1) : orId;
}

/** Check whether the cached pricing data is older than 24 hours. */
export async function isPricingStale(): Promise<boolean> {
  const cachePath = join(getCebusDir(), 'pricing-cache.json');
  const existing = await loadJsonFile<PricingCache>(cachePath);
  if (existing?.fetchedAt === undefined || existing.fetchedAt.length === 0) return true;
  return Date.now() - new Date(existing.fetchedAt).getTime() >= STALE_MS;
}

/** Refresh pricing from OpenRouter API. Returns count of updated + added entries. */
export async function refreshPricing(): Promise<{ updated: number; added: number }> {
  let updated = 0;
  let added = 0;

  const res = await fetch(OPENROUTER_API, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return { updated, added };

  const data = (await res.json()) as { data?: OpenRouterModel[] };
  const models = data.data ?? [];

  const supported = models.filter(m => SUPPORTED_PREFIXES.some(p => m.id.startsWith(p)));

  const updatedModels: ModelPricing[] = [];

  for (const model of supported) {
    if (
      model.pricing?.prompt === undefined ||
      model.pricing.prompt.length === 0 ||
      model.pricing?.completion === undefined ||
      model.pricing.completion.length === 0
    )
      continue;
    const bareId = toBareModelId(model.id);
    const inputPrice = toPerMTok(model.pricing.prompt);
    const outputPrice = toPerMTok(model.pricing.completion);
    if (inputPrice === 0 && outputPrice === 0) continue;

    const contextWindow = model.context_length ?? 0;
    const cachedPrice = parseFloat((inputPrice * 0.1).toPrecision(4));
    const key = bareId.toLowerCase();

    const entry: ModelPricing = {
      modelId: bareId,
      inputPricePerMTok: inputPrice,
      outputPricePerMTok: outputPrice,
      cachedInputPricePerMTok: cachedPrice,
      contextWindow,
    };

    if (activePricing.has(key)) {
      const existing = activePricing.get(key)!;
      if (
        existing.inputPricePerMTok !== inputPrice ||
        existing.outputPricePerMTok !== outputPrice ||
        existing.contextWindow !== contextWindow
      ) {
        activePricing.set(key, entry);
        updated++;
      }
    } else {
      activePricing.set(key, entry);
      added++;
    }
    updatedModels.push(entry);
  }

  // Persist cache
  const cebusDir = getCebusDir();
  const cache: PricingCache = {
    fetchedAt: new Date().toISOString(),
    models: updatedModels,
  };
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- cebusDir from project root
  await mkdir(cebusDir, { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from project root
  await writeFile(join(cebusDir, 'pricing-cache.json'), JSON.stringify(cache, null, 2), 'utf-8');

  return { updated, added };
}

/** Non-blocking background refresh. Kept for backward compatibility. */
export function refreshPricingIfStale(): void {
  if (refreshPromise) return;
  refreshPromise = (async (): Promise<void> => {
    const stale = await isPricingStale();
    if (stale) await refreshPricing();
  })().finally(() => {
    refreshPromise = null;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Register runtime-discovered pricing (e.g. from OpenRouter API). */
export function registerModelPricing(models: ModelPricing[]): void {
  for (const m of models) {
    const key = m.modelId.toLowerCase();
    if (!activePricing.has(key)) {
      activePricing.set(key, m);
    }
  }
}

/** Fuzzy-match a model ID to its pricing entry. */
export function getModelPricing(modelId: string): ModelPricing | undefined {
  if (!initialized) {
    // Synchronous init won't block — just ensures layers are loaded on first call
    void initializePricing();
  }

  const lower = modelId.toLowerCase();

  // Exact match
  const exact = activePricing.get(lower);
  if (exact) return exact;

  // Single-pass fuzzy match: check both directions in one loop
  let best: ModelPricing | undefined;
  let bestLen = 0;
  let reverseBest: ModelPricing | undefined;
  let reverseBestLen = 0;
  for (const [key, pricing] of activePricing) {
    if (lower.includes(key) && key.length > bestLen) {
      best = pricing;
      bestLen = key.length;
    } else if (key.includes(lower) && key.length > reverseBestLen) {
      reverseBest = pricing;
      reverseBestLen = key.length;
    }
  }

  return best ?? reverseBest;
}

/** Calculate estimated cost from token usage. */
export function calculateCost(
  modelId: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number | undefined }
): CostEstimate {
  const pricing = getModelPricing(modelId);
  if (!pricing) {
    return { inputCost: 0, outputCost: 0, cacheSavings: 0, totalCost: 0 };
  }

  const cachedTokens = usage.cacheReadTokens ?? 0;
  const uncachedInput = Math.max(0, usage.inputTokens - cachedTokens);

  const inputCost =
    (uncachedInput / 1_000_000) * pricing.inputPricePerMTok +
    (cachedTokens / 1_000_000) * pricing.cachedInputPricePerMTok;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPricePerMTok;

  // What it would have cost without caching
  const fullInputCost = (usage.inputTokens / 1_000_000) * pricing.inputPricePerMTok;
  const cacheSavings = fullInputCost + outputCost - (inputCost + outputCost);

  return {
    inputCost,
    outputCost,
    cacheSavings: Math.max(0, cacheSavings),
    totalCost: inputCost + outputCost,
  };
}

/** Get context window size for a model. Returns 0 if unknown. */
export function getContextWindow(modelId: string): number {
  return getModelPricing(modelId)?.contextWindow ?? 0;
}

/** Format a USD cost for display. */
export function formatCostUSD(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(5)}`;
  if (cost < 0.1) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}
