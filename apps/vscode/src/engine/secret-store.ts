/**
 * Wraps VS Code SecretStorage for provider API keys.
 *
 * Maps stored secret keys to environment variables that the engine reads:
 *   cebus.openai.apiKey    → OPENAI_API_KEY
 *   cebus.anthropic.apiKey → ANTHROPIC_API_KEY
 *   cebus.google.apiKey    → GOOGLE_API_KEY
 */

import * as vscode from 'vscode';

interface SecretEntry {
  readonly secretKey: string;
  readonly envVar: string;
  readonly label: string;
}

const SECRET_MAP: readonly SecretEntry[] = [
  { secretKey: 'cebus.openai.apiKey', envVar: 'OPENAI_API_KEY', label: 'OpenAI' },
  { secretKey: 'cebus.anthropic.apiKey', envVar: 'ANTHROPIC_API_KEY', label: 'Anthropic' },
  { secretKey: 'cebus.google.apiKey', envVar: 'GOOGLE_API_KEY', label: 'Google (Gemini)' },
];

export class SecretStore implements vscode.Disposable {
  private secrets: vscode.SecretStorage;
  private disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets;

    this.disposables.push(
      this.secrets.onDidChange(e => {
        const entry = SECRET_MAP.find(s => s.secretKey === e.key);
        if (entry !== undefined) {
          void this.syncSingleKey(entry.secretKey, entry.envVar);
        }
      })
    );
  }

  async syncToEnv(): Promise<void> {
    await Promise.all(
      SECRET_MAP.map(({ secretKey, envVar }) => this.syncSingleKey(secretKey, envVar))
    );
  }

  async getApiKeys(): Promise<Record<string, string>> {
    const keys: Record<string, string> = {};
    for (const { secretKey, envVar } of SECRET_MAP) {
      const value = await this.secrets.get(secretKey);
      if (value !== undefined) {
        // eslint-disable-next-line security/detect-object-injection -- envVar is from trusted constant SECRET_MAP
        keys[envVar] = value;
      }
    }
    return keys;
  }

  async promptForApiKeys(): Promise<void> {
    for (const { secretKey, label } of SECRET_MAP) {
      const existing = await this.secrets.get(secretKey);
      const value = await vscode.window.showInputBox({
        title: `${label} API Key`,
        prompt: `Enter your ${label} API key (leave empty to skip)`,
        password: true,
        value: existing !== undefined ? '••••••••' : '',
        placeHolder: existing !== undefined ? 'Key already set — press Enter to keep' : 'sk-...',
      });

      if (value === undefined) break; // User cancelled
      if (value.length > 0 && value !== '••••••••') {
        await this.secrets.store(secretKey, value);
      }
    }

    await this.syncToEnv();
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private async syncSingleKey(secretKey: string, envVar: string): Promise<void> {
    const value = await this.secrets.get(secretKey);
    if (value !== undefined) {
      // eslint-disable-next-line security/detect-object-injection -- envVar is from trusted constant SECRET_MAP
      process.env[envVar] = value;
    } else {
      // eslint-disable-next-line security/detect-object-injection -- envVar is from trusted constant SECRET_MAP
      delete process.env[envVar];
    }
  }
}
