#!/usr/bin/env npx tsx
/**
 * Fetches current model pricing from OpenRouter's public API
 * and updates pricing.json with the latest prices.
 *
 * Usage:
 *   npx tsx scripts/update-pricing.ts          # dry-run (prints diff)
 *   npx tsx scripts/update-pricing.ts --write  # write changes to pricing.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRICING_PATH = join(__dirname, '..', 'pricing.json');

const OPENROUTER_API = 'https://openrouter.ai/api/v1/models';

/** Prefixes we care about (matches SUPPORTED_OPENROUTER_PREFIXES). */
const SUPPORTED_PREFIXES = [
  'openai/',
  'anthropic/',
  'google/',
  'meta-llama/',
  'x-ai/',
];

/**
 * Only add NEW models that match these patterns.
 * Existing entries are always updated regardless.
 * This keeps pricing.json curated — no legacy/niche models.
 */
const AUTO_ADD_PATTERNS = [
  // Anthropic current gen (e.g. claude-sonnet-4.6, claude-opus-4-6)
  /^claude-(opus|sonnet|haiku)-[45]/,
  // OpenAI current gen (e.g. gpt-5.3-codex, gpt-4.1, gpt-4o)
  /^gpt-(5|4\.1|4o)/,
  // OpenAI reasoning (o3, o4-mini)
  /^o[34]-/,
  // Google current gen
  /^gemini-(3|2\.5|2\.0)-/,
  // Meta current gen
  /^llama-4-/,
  // xAI current gen
  /^grok-(4|3)/,
];

/** Exclude dated snapshots, betas, extended variants, and search/audio previews. */
const EXCLUDE_PATTERNS = [
  /\d{4}-\d{2}-\d{2}/,     // dated snapshots (gpt-4o-2024-08-06)
  /-beta$/,                  // beta suffixes
  /:extended$/,              // extended variants
  /-search-preview$/,        // search previews
  /-audio-preview$/,         // audio previews
  /-image(-preview)?$/,      // image generation models
  /-image-mini$/,
  /-preview-\d{2}-\d{4}$/,  // dated previews (gemini-2.5-flash-lite-preview-09-2025)
  /-deep-research$/,         // deep research variants
];

/** Map OpenRouter model IDs to our pricing.json model IDs (strip provider prefix). */
function toBareModelId(orId: string): string {
  const slashIdx = orId.indexOf('/');
  return slashIdx > 0 ? orId.substring(slashIdx + 1) : orId;
}

interface OpenRouterModel {
  id: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

interface PricingEntry {
  modelId: string;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  cachedInputPricePerMTok: number;
  contextWindow: number;
}

interface PricingFile {
  version: string;
  models: PricingEntry[];
}

/** Convert per-token price string (e.g. "0.000003") to per-million-token price. */
function toPerMTok(perToken: string | undefined): number {
  if (!perToken) return 0;
  const val = parseFloat(perToken);
  if (isNaN(val) || val <= 0) return 0;
  return parseFloat((val * 1_000_000).toPrecision(6));
}

/** Estimate cached input price (providers typically charge 10% of input). */
function estimateCachedPrice(inputPerMTok: number): number {
  return parseFloat((inputPerMTok * 0.1).toPrecision(4));
}

async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  const res = await fetch(OPENROUTER_API, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OpenRouter API returned ${res.status}`);
  const data = (await res.json()) as { data?: OpenRouterModel[] };
  return data.data ?? [];
}

function loadPricingFile(): PricingFile {
  const raw = readFileSync(PRICING_PATH, 'utf-8');
  return JSON.parse(raw) as PricingFile;
}

async function main(): Promise<void> {
  const writeMode = process.argv.includes('--write');
  const pricing = loadPricingFile();
  const existingMap = new Map(pricing.models.map(m => [m.modelId.toLowerCase(), m]));

  console.log(`Fetching models from OpenRouter...`);
  const orModels = await fetchOpenRouterModels();
  console.log(`  Got ${orModels.length} models total`);

  const supported = orModels.filter(m =>
    SUPPORTED_PREFIXES.some(p => m.id.startsWith(p))
  );
  console.log(`  ${supported.length} match supported prefixes`);

  let updated = 0;
  let added = 0;

  for (const model of supported) {
    if (!model.pricing?.prompt || !model.pricing?.completion) continue;

    const bareId = toBareModelId(model.id);
    const inputPrice = toPerMTok(model.pricing.prompt);
    const outputPrice = toPerMTok(model.pricing.completion);
    if (inputPrice === 0 && outputPrice === 0) continue;

    const contextWindow = model.context_length ?? 0;
    const cachedPrice = estimateCachedPrice(inputPrice);

    const existing = existingMap.get(bareId.toLowerCase());
    if (existing) {
      // Always update existing entries
      const changed =
        existing.inputPricePerMTok !== inputPrice ||
        existing.outputPricePerMTok !== outputPrice ||
        existing.contextWindow !== contextWindow;

      if (changed) {
        console.log(`  ~ ${bareId}: $${existing.inputPricePerMTok}/$${existing.outputPricePerMTok} -> $${inputPrice}/$${outputPrice}${contextWindow !== existing.contextWindow ? ` (ctx: ${existing.contextWindow} -> ${contextWindow})` : ''}`);
        existing.inputPricePerMTok = inputPrice;
        existing.outputPricePerMTok = outputPrice;
        existing.cachedInputPricePerMTok = cachedPrice;
        existing.contextWindow = contextWindow;
        updated++;
      }
    } else if (AUTO_ADD_PATTERNS.some(p => p.test(bareId)) && !EXCLUDE_PATTERNS.some(p => p.test(bareId))) {
      // Only add new models matching curated patterns
      console.log(`  + ${bareId}: $${inputPrice}/$${outputPrice} (ctx: ${contextWindow})`);
      const entry: PricingEntry = {
        modelId: bareId,
        inputPricePerMTok: inputPrice,
        outputPricePerMTok: outputPrice,
        cachedInputPricePerMTok: cachedPrice,
        contextWindow,
      };
      pricing.models.push(entry);
      existingMap.set(bareId.toLowerCase(), entry);
      added++;
    }
  }

  console.log(`\nSummary: ${updated} updated, ${added} added, ${pricing.models.length} total`);

  if (updated === 0 && added === 0) {
    console.log('No changes needed.');
    return;
  }

  pricing.version = new Date().toISOString().slice(0, 10);

  if (writeMode) {
    const output = formatPricingJson(pricing);
    writeFileSync(PRICING_PATH, output, 'utf-8');
    console.log(`Written to ${PRICING_PATH}`);
  } else {
    console.log('\nDry run — pass --write to save changes.');
  }
}

/** Format pricing.json with aligned columns for readability. */
function formatPricingJson(pricing: PricingFile): string {
  const lines = [
    '{',
    `  "version": "${pricing.version}",`,
    '  "models": [',
  ];

  for (let i = 0; i < pricing.models.length; i++) {
    const m = pricing.models[i]!;
    const comma = i < pricing.models.length - 1 ? ',' : '';
    const id = JSON.stringify(m.modelId).padEnd(36);
    const inp = JSON.stringify(m.inputPricePerMTok).padStart(6);
    const out = JSON.stringify(m.outputPricePerMTok).padStart(6);
    const cached = JSON.stringify(m.cachedInputPricePerMTok).padStart(8);
    const ctx = JSON.stringify(m.contextWindow);
    lines.push(`    { "modelId": ${id} "inputPricePerMTok": ${inp}, "outputPricePerMTok": ${out}, "cachedInputPricePerMTok": ${cached}, "contextWindow": ${ctx} }${comma}`);
  }

  lines.push('  ]');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
