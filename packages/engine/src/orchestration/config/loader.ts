/**
 * Configuration Loader
 *
 * T007: Reads JSON file, validates with Zod, applies defaults,
 * resolves orchestratorContext file paths and loads their contents.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { TeamConfigSchema } from './schema.js';
import type { TeamConfig } from '../types.js';
import { OrchestrationError } from '../types.js';

/**
 * Load and validate a team configuration from a JSON file.
 * Resolves orchestratorContext file paths relative to the config file location.
 */
export function loadTeamConfig(path: string): TeamConfig {
  let rawContent: string;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from caller-provided config file
    rawContent = readFileSync(resolve(path), 'utf-8');
  } catch (err) {
    throw new OrchestrationError(
      'CONFIG_VALIDATION',
      `Failed to read config file: ${path}`,
      undefined,
      err instanceof Error ? err : undefined
    );
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawContent);
  } catch (err) {
    throw new OrchestrationError(
      'CONFIG_VALIDATION',
      `Invalid JSON in config file: ${path}`,
      undefined,
      err instanceof Error ? err : undefined
    );
  }

  const result = TeamConfigSchema.safeParse(rawJson);
  if (!result.success) {
    const issues = result.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new OrchestrationError('CONFIG_VALIDATION', `Config validation failed:\n${issues}`);
  }

  const config = result.data as TeamConfig;

  // Resolve orchestratorContext file paths and load contents
  if (config.orchestratorContext && config.orchestratorContext.length > 0) {
    const configDir = dirname(resolve(path));
    const resolvedContexts: string[] = [];

    for (const contextPath of config.orchestratorContext) {
      // Reject paths with traversal segments to prevent reading arbitrary files
      if (contextPath.includes('..')) {
        throw new OrchestrationError(
          'CONFIG_VALIDATION',
          `orchestratorContext path must not contain '..': ${contextPath}`
        );
      }

      const fullPath = resolve(configDir, contextPath);

      // Verify resolved path stays within config directory
      // On Windows, paths are case-insensitive so normalize before comparison
      const normFull = process.platform === 'win32' ? fullPath.toLowerCase() : fullPath;
      const normDir = process.platform === 'win32' ? configDir.toLowerCase() : configDir;
      if (!normFull.startsWith(normDir)) {
        throw new OrchestrationError(
          'CONFIG_VALIDATION',
          `orchestratorContext path escapes config directory: ${contextPath}`
        );
      }

      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- fullPath validated against configDir above
        const content = readFileSync(fullPath, 'utf-8');
        resolvedContexts.push(content);
      } catch {
        throw new OrchestrationError(
          'CONFIG_VALIDATION',
          `Failed to load orchestratorContext file: ${contextPath} (resolved to: ${fullPath})`
        );
      }
    }

    // Return config with resolved context contents replacing file paths
    return {
      ...config,
      orchestratorContext: resolvedContexts,
    };
  }

  return config;
}

/**
 * Validate a TeamConfig object directly (not from file).
 * Useful when config is provided programmatically.
 */
export function validateTeamConfig(config: unknown): TeamConfig {
  const result = TeamConfigSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new OrchestrationError('CONFIG_VALIDATION', `Config validation failed:\n${issues}`);
  }
  return result.data as TeamConfig;
}
