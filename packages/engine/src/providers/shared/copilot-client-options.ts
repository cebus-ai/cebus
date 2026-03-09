import * as path from 'node:path';

type LoggerFn = (message: string) => void;

function isLikelyServerUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;

  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^\d+$/.test(trimmed)) return true;

  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return false;
  if (trimmed.includes('\\') || trimmed.includes('/')) return false;

  return /^[A-Za-z0-9.-]+:\d+$/.test(trimmed);
}

function isLikelyCliPath(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (path.isAbsolute(trimmed)) return true;
  if (trimmed.includes('\\') || trimmed.includes('/')) return true;
  return /\.(?:mjs|cjs|js|exe|cmd|bat|ps1)$/i.test(trimmed);
}

export function resolveCopilotClientConnectionOptions(
  env: NodeJS.ProcessEnv,
  logger?: LoggerFn
): Record<string, unknown> {
  const options: Record<string, unknown> = {};

  const explicitCliPath = env['CEBUS_COPILOT_CLI_PATH']?.trim();
  if (explicitCliPath !== undefined && explicitCliPath.length > 0) {
    options['cliPath'] = explicitCliPath;
    return options;
  }

  const explicitServerUrl = env['CEBUS_COPILOT_SERVER_URL']?.trim();
  if (explicitServerUrl !== undefined && explicitServerUrl.length > 0) {
    options['cliUrl'] = explicitServerUrl;
    return options;
  }

  const legacyCliUrl = env['CEBUS_COPILOT_CLI_URL']?.trim();
  if (legacyCliUrl === undefined || legacyCliUrl.length === 0) {
    return options;
  }

  if (isLikelyServerUrl(legacyCliUrl)) {
    options['cliUrl'] = legacyCliUrl;
    return options;
  }

  if (isLikelyCliPath(legacyCliUrl)) {
    options['cliPath'] = legacyCliUrl;
    logger?.(
      'CEBUS_COPILOT_CLI_URL is being treated as a CLI path. Prefer CEBUS_COPILOT_CLI_PATH for path overrides.'
    );
    return options;
  }

  options['cliPath'] = legacyCliUrl;
  logger?.(
    'CEBUS_COPILOT_CLI_URL format is ambiguous. Treating it as a CLI path. Prefer CEBUS_COPILOT_CLI_PATH or CEBUS_COPILOT_SERVER_URL.'
  );

  return options;
}
