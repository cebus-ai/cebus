export const PROVIDER_STYLES: Record<string, { color: string; icon: string }> = {
  anthropic: { color: '#d77b5c', icon: '✨' },
  openai: { color: '#0f9d7d', icon: '🟢' },
  copilot: { color: '#ca76cd', icon: '🤖' },
  gemini: { color: '#4285F4', icon: '💎' },
  google: { color: '#4285F4', icon: '💎' },
  ollama: { color: '#888888', icon: '🏠' },
  'meta-llama': { color: '#0467DF', icon: '🦙' },
  'x-ai': { color: '#EF4444', icon: '⚡' },
  'z-ai': { color: '#00B4D8', icon: '🧠' },
  moonshotai: { color: '#FF6B35', icon: '🌙' },
  minimax: { color: '#7C3AED', icon: '🔶' },
  'ollama-llama': { color: '#0467DF', icon: '🦙' },
  'ollama-codellama': { color: '#0467DF', icon: '🦙' },
  'ollama-tinyllama': { color: '#0467DF', icon: '🦙' },
  'ollama-gemma': { color: '#4285F4', icon: '💎' },
  'ollama-phi': { color: '#00BCF2', icon: '🔬' },
  'ollama-mistral': { color: '#FF7000', icon: '🌀' },
  'ollama-mixtral': { color: '#FF7000', icon: '🌀' },
  'ollama-qwen': { color: '#6236FF', icon: '🌐' },
  'ollama-deepseek': { color: '#4D6BFE', icon: '🔍' },
  openrouter: { color: '#6366f1', icon: '🔀' },
  default: { color: '#8b5cf6', icon: '🔵' },
};

const OLLAMA_FAMILY_PREFIXES: string[] = [
  'codellama',
  'tinyllama',
  'llama',
  'gemma',
  'phi',
  'mistral',
  'mixtral',
  'qwen',
  'deepseek',
];

export function resolveProviderStyle(
  providerId: string,
  modelId?: string | null
): { color: string; icon: string } {
  if (providerId === 'openrouter' && modelId) {
    const slashIdx = modelId.indexOf('/');
    if (slashIdx > 0) {
      const company = modelId.substring(0, slashIdx);
      if (PROVIDER_STYLES[company]) return PROVIDER_STYLES[company];
    }
  }
  if (providerId === 'ollama' && modelId) {
    const lower = modelId.toLowerCase();
    for (const prefix of OLLAMA_FAMILY_PREFIXES) {
      if (lower.startsWith(prefix)) {
        return PROVIDER_STYLES[`ollama-${prefix}`] ?? PROVIDER_STYLES['ollama']!;
      }
    }
  }
  return PROVIDER_STYLES[providerId] ?? PROVIDER_STYLES['default']!;
}
