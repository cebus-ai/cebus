import { readFile } from 'fs/promises';
import { ConfigSchema } from './schema';

const ENV_KEYS = {
  OPENAI_API_KEY: 'OPENAI_API_KEY',
  ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY',
  GITHUB_TOKEN: 'GITHUB_TOKEN',
  OPENAI_BASE_URL: 'OPENAI_BASE_URL',
  ANTHROPIC_BASE_URL: 'ANTHROPIC_BASE_URL',
  OPENROUTER_API_KEY: 'OPENROUTER_API_KEY',
  CLOUDFLARE_AI_GATEWAY_URL: 'CLOUDFLARE_AI_GATEWAY_URL',
  CLOUDFLARE_GATEWAY_API_KEY: 'CLOUDFLARE_GATEWAY_API_KEY',
  CLOUDFLARE_BYOK_ALIAS: 'CLOUDFLARE_BYOK_ALIAS',
} as const;

export interface ProviderConfig {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  timeout?: number | undefined;
}

export interface AppConfig {
  providers: {
    openai?: ProviderConfig | undefined;
    anthropic?: ProviderConfig | undefined;
    copilot?: ProviderConfig | undefined;
    openrouter?: ProviderConfig | undefined;
  };
  defaults: {
    maxTokens: number;
    temperature: number;
  };
}

const DEFAULT_CONFIG: AppConfig = {
  providers: {},
  defaults: {
    maxTokens: 4096,
    temperature: 0.7,
  },
};

function loadFromEnv(): Partial<AppConfig> {
  const config: Partial<AppConfig> = {
    providers: {},
  };

  const openaiKey = process.env[ENV_KEYS.OPENAI_API_KEY];
  if (openaiKey !== undefined && openaiKey.length > 0) {
    config.providers!.openai = {
      apiKey: openaiKey,
      baseUrl: process.env[ENV_KEYS.OPENAI_BASE_URL],
    };
  }

  const anthropicKey = process.env[ENV_KEYS.ANTHROPIC_API_KEY];
  if (anthropicKey !== undefined && anthropicKey.length > 0) {
    config.providers!.anthropic = {
      apiKey: anthropicKey,
      baseUrl: process.env[ENV_KEYS.ANTHROPIC_BASE_URL],
    };
  }

  const githubToken = process.env[ENV_KEYS.GITHUB_TOKEN];
  if (githubToken !== undefined && githubToken.length > 0) {
    config.providers!.copilot = {
      apiKey: githubToken,
    };
  }

  const openrouterKey = process.env[ENV_KEYS.OPENROUTER_API_KEY];
  const gatewayUrl = process.env[ENV_KEYS.CLOUDFLARE_AI_GATEWAY_URL];
  const gatewayKey = process.env[ENV_KEYS.CLOUDFLARE_GATEWAY_API_KEY];
  if (
    (openrouterKey !== undefined && openrouterKey.length > 0) ||
    (gatewayUrl !== undefined &&
      gatewayUrl.length > 0 &&
      gatewayKey !== undefined &&
      gatewayKey.length > 0)
  ) {
    config.providers!.openrouter = {
      ...(openrouterKey !== undefined && openrouterKey.length > 0 ? { apiKey: openrouterKey } : {}),
      ...(gatewayUrl !== undefined && gatewayUrl.length > 0 ? { baseUrl: gatewayUrl } : {}),
    };
  }

  return config;
}

async function loadFromFile(filePath: string): Promise<Partial<AppConfig>> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath from caller-controlled config
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as Partial<AppConfig>;
  } catch {
    // Expected: optional config file may not exist or may be malformed
    return {};
  }
}

function mergeConfigs(...configs: Partial<AppConfig>[]): AppConfig {
  const result: AppConfig = { ...DEFAULT_CONFIG };

  for (const config of configs) {
    if (config.providers) {
      result.providers = {
        ...result.providers,
        ...config.providers,
      };

      for (const key of ['openai', 'anthropic', 'copilot', 'openrouter'] as const) {
        // eslint-disable-next-line security/detect-object-injection -- key from known constant array
        if (config.providers[key] !== undefined) {
          // eslint-disable-next-line security/detect-object-injection -- key from known constant array
          result.providers[key] = {
            // eslint-disable-next-line security/detect-object-injection -- key from known constant array
            ...result.providers[key],
            // eslint-disable-next-line security/detect-object-injection -- key from known constant array
            ...config.providers[key],
          };
        }
      }
    }

    if (config.defaults) {
      result.defaults = {
        ...result.defaults,
        ...config.defaults,
      };
    }
  }

  return result;
}

let cachedConfig: AppConfig | null = null;

export async function loadConfig(configPath?: string): Promise<AppConfig> {
  const envConfig = loadFromEnv();
  const fileConfig =
    configPath !== undefined && configPath.length > 0 ? await loadFromFile(configPath) : {};

  const merged = mergeConfigs(DEFAULT_CONFIG, fileConfig, envConfig);

  const validatedPartial = ConfigSchema.safeParse({
    providers: merged.providers,
    defaults: merged.defaults,
  });

  if (!validatedPartial.success) {
    console.warn('Config validation warnings:', validatedPartial.error.issues);
  }

  cachedConfig = merged;
  return merged;
}

export function getConfig(): AppConfig | null {
  return cachedConfig;
}

export * from './schema';
