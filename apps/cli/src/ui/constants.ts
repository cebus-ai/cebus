import type { ChatMode } from '@cebus/engine';

/** Maximum icon width across all providers (for alignment). */
export const MAX_ICON_WIDTH = 2;

/** Provider-specific colors and icons for message rendering. */
export const PROVIDER_STYLES: Record<string, { color: string; icon: string; iconWidth: number }> = {
  anthropic: { color: '#d77b5c', icon: '✨', iconWidth: 2 },
  openai: { color: '#0f9d7d', icon: '🟢', iconWidth: 2 },
  copilot: { color: '#ca76cd', icon: '🤖', iconWidth: 2 },
  gemini: { color: '#4285F4', icon: '💎', iconWidth: 2 },
  google: { color: '#4285F4', icon: '💎', iconWidth: 2 },
  ollama: { color: '#888888', icon: '🏠', iconWidth: 2 },
  'meta-llama': { color: '#0467DF', icon: '🦙', iconWidth: 2 },
  'x-ai': { color: '#EF4444', icon: '⚡', iconWidth: 2 },
  'z-ai': { color: '#00B4D8', icon: '🧠', iconWidth: 2 },
  moonshotai: { color: '#FF6B35', icon: '🌙', iconWidth: 2 },
  minimax: { color: '#7C3AED', icon: '🔶', iconWidth: 2 },
  // Ollama model families
  'ollama-llama': { color: '#0467DF', icon: '🦙', iconWidth: 2 },
  'ollama-codellama': { color: '#0467DF', icon: '🦙', iconWidth: 2 },
  'ollama-tinyllama': { color: '#0467DF', icon: '🦙', iconWidth: 2 },
  'ollama-gemma': { color: '#4285F4', icon: '💎', iconWidth: 2 },
  'ollama-phi': { color: '#00BCF2', icon: '🔬', iconWidth: 2 },
  'ollama-mistral': { color: '#FF7000', icon: '🌀', iconWidth: 2 },
  'ollama-mixtral': { color: '#FF7000', icon: '🌀', iconWidth: 2 },
  'ollama-qwen': { color: '#6236FF', icon: '🌐', iconWidth: 2 },
  'ollama-deepseek': { color: '#4D6BFE', icon: '🔍', iconWidth: 2 },
  default: { color: 'cyan', icon: '🔵', iconWidth: 2 },
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

/** Resolve a provider style from a displayGroup key (e.g. 'openrouter-openai' → openai style). */
export function getProviderStyle(displayGroup: string): {
  color: string;
  icon: string;
  iconWidth: number;
} {
  // eslint-disable-next-line security/detect-object-injection -- key from known provider set
  if (PROVIDER_STYLES[displayGroup] !== undefined) return PROVIDER_STYLES[displayGroup];
  const prefix = displayGroup.replace(/^openrouter-/, '');
  // eslint-disable-next-line security/detect-object-injection -- key from known provider set
  return PROVIDER_STYLES[prefix] ?? PROVIDER_STYLES['default']!;
}

/** Resolve style for a participant, with gateway/Ollama model-family awareness. */
export function resolveProviderStyle(
  providerId: string,
  modelId?: string | null
): { color: string; icon: string; iconWidth: number } {
  if (
    providerId === 'openrouter' &&
    modelId !== undefined &&
    modelId !== null &&
    modelId.length > 0
  ) {
    const slashIdx = modelId.indexOf('/');
    if (slashIdx > 0) {
      const company = modelId.substring(0, slashIdx);
      // eslint-disable-next-line security/detect-object-injection -- key from parsed model ID
      if (PROVIDER_STYLES[company] !== undefined) return PROVIDER_STYLES[company];
    }
  }
  if (providerId === 'ollama' && modelId !== undefined && modelId !== null && modelId.length > 0) {
    const lower = modelId.toLowerCase();
    for (const prefix of OLLAMA_FAMILY_PREFIXES) {
      if (lower.startsWith(prefix)) {
        return PROVIDER_STYLES[`ollama-${prefix}`] ?? PROVIDER_STYLES['ollama']!;
      }
    }
  }
  // eslint-disable-next-line security/detect-object-injection -- key from provider ID
  return PROVIDER_STYLES[providerId] ?? PROVIDER_STYLES['default']!;
}

export const USER_COLOR = 'blue';
export const USER_ICON = '👤';
export const USER_ICON_WIDTH = 2;

/** Padding for content: max icon width + 1 space between icon and name. */
export const CONTENT_PADDING = MAX_ICON_WIDTH + 1;

/** Orchestrator style — magenta diamond icon. */
export const ORCHESTRATOR_STYLE = { color: 'magenta', icon: '🔮', iconWidth: 2 };

/** Team Leader style — magenta target icon. */
export const TEAM_LEADER_STYLE = { color: 'magenta', icon: '🎯', iconWidth: 2 };

/** Chat mode display labels. */
export const CHAT_MODE_LABELS: Record<ChatMode, string> = {
  free_chat: 'All at Once',
  sequential: 'One by One',
  tag_only: 'Mention Only',
  role_based: 'Role-Based',
  raw: 'Raw',
};

/** Clear screen and re-assert terminal window title. */
export function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[H\x1b]0;Cebus\x07');
}

/** Format token count for compact display (e.g. 1.5K, 2.3M). */
export function formatTokens(tokens: number): string {
  if (tokens === 0) return '0';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toLocaleString();
}
