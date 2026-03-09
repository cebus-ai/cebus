import type { ModelInfo } from '../types';

/**
 * Hardcoded fallback model list for OpenRouter.
 * Used when the OpenRouter /api/v1/models endpoint is unreachable.
 */
export const OPENROUTER_FALLBACK_MODELS: ModelInfo[] = [
  // Anthropic
  {
    id: 'anthropic/claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    defaultNickname: 'Claude Opus 4.6',
    capabilities: { streaming: true, maxContextTokens: 200000, maxOutputTokens: 32000, functionCalling: true },
  },
  {
    id: 'anthropic/claude-sonnet-4-5',
    displayName: 'Claude Sonnet 4.5',
    defaultNickname: 'Claude Sonnet 4.5',
    capabilities: { streaming: true, maxContextTokens: 200000, maxOutputTokens: 16384, functionCalling: true },
  },
  {
    id: 'anthropic/claude-haiku-4-5',
    displayName: 'Claude Haiku 4.5',
    defaultNickname: 'Claude Haiku 4.5',
    capabilities: { streaming: true, maxContextTokens: 200000, maxOutputTokens: 8192, functionCalling: true },
  },
  // OpenAI
  {
    id: 'openai/gpt-5.3-codex',
    displayName: 'GPT-5.3 Codex',
    defaultNickname: 'GPT-5.3 Codex',
    capabilities: { streaming: true, maxContextTokens: 256000, maxOutputTokens: 16384, functionCalling: true },
  },
  {
    id: 'openai/gpt-5.2',
    displayName: 'GPT-5.2',
    defaultNickname: 'GPT-5.2',
    capabilities: { streaming: true, maxContextTokens: 256000, maxOutputTokens: 16384, functionCalling: true },
  },
  {
    id: 'openai/gpt-5.1',
    displayName: 'GPT-5.1',
    defaultNickname: 'GPT-5.1',
    capabilities: { streaming: true, maxContextTokens: 256000, maxOutputTokens: 16384, functionCalling: true },
  },
  {
    id: 'openai/gpt-4.1',
    displayName: 'GPT-4.1',
    defaultNickname: 'GPT-4.1',
    capabilities: { streaming: true, maxContextTokens: 128000, maxOutputTokens: 8192, functionCalling: true },
  },
  {
    id: 'openai/gpt-4o',
    displayName: 'GPT-4o',
    defaultNickname: 'GPT-4o',
    capabilities: { streaming: true, maxContextTokens: 128000, maxOutputTokens: 4096, functionCalling: true },
  },
  // Google
  {
    id: 'google/gemini-3.1-pro-preview',
    displayName: 'Gemini 3.1 Pro Preview',
    defaultNickname: 'Gemini 3.1 Pro',
    capabilities: { streaming: true, maxContextTokens: 1000000, maxOutputTokens: 65536, functionCalling: true },
  },
  {
    id: 'google/gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    defaultNickname: 'Gemini 2.5 Pro',
    capabilities: { streaming: true, maxContextTokens: 1000000, maxOutputTokens: 65536, functionCalling: true },
  },
  {
    id: 'google/gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    defaultNickname: 'Gemini 2.5 Flash',
    capabilities: { streaming: true, maxContextTokens: 1000000, maxOutputTokens: 65536, functionCalling: true },
  },
  {
    id: 'google/gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash',
    defaultNickname: 'Gemini 2.0 Flash',
    capabilities: { streaming: true, maxContextTokens: 1000000, maxOutputTokens: 8192, functionCalling: true },
  },
  // Meta
  {
    id: 'meta-llama/llama-4-maverick',
    displayName: 'Llama 4 Maverick',
    defaultNickname: 'Llama 4 Maverick',
    capabilities: { streaming: true, maxContextTokens: 1000000, maxOutputTokens: 32768, functionCalling: false },
  },
  {
    id: 'meta-llama/llama-4-scout',
    displayName: 'Llama 4 Scout',
    defaultNickname: 'Llama 4 Scout',
    capabilities: { streaming: true, maxContextTokens: 512000, maxOutputTokens: 16384, functionCalling: false },
  },
  // xAI (Grok)
  {
    id: 'x-ai/grok-3',
    displayName: 'Grok 3',
    defaultNickname: 'Grok 3',
    capabilities: { streaming: true, maxContextTokens: 131072, maxOutputTokens: 16384, functionCalling: true },
  },
  {
    id: 'x-ai/grok-3-mini',
    displayName: 'Grok 3 Mini',
    defaultNickname: 'Grok 3 Mini',
    capabilities: { streaming: true, maxContextTokens: 131072, maxOutputTokens: 16384, functionCalling: true },
  },
];

/** Provider prefixes that we include from OpenRouter's model list. */
export const SUPPORTED_OPENROUTER_PREFIXES = [
  'openai/',
  'anthropic/',
  'google/',
  'meta-llama/',
  'x-ai/',
  'moonshotai/',
  'minimax/',
  'z-ai/',
] as const;
