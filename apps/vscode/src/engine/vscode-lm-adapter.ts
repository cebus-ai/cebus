/**
 * VS Code Language Model adapter — uses the native `vscode.lm` API
 * to access Copilot models without spawning external processes.
 *
 * Registered as provider `id: 'vscode-lm'` in the extension host.
 * Coexists with the CLI-based `copilot` provider.
 */

import * as vscode from 'vscode';
import type {
  ProviderAdapter,
  ContextMessage,
  CompletionOptions,
  CompletionResult,
  ModelInfo,
  ModelCapabilities,
} from '@cebus/engine';
import { ProviderErrorImpl } from '@cebus/engine';

export class VscodeLmAdapter implements ProviderAdapter {
  readonly id = 'vscode-lm';
  readonly displayName = 'VS Code Language Models';

  private models: vscode.LanguageModelChat[] = [];
  private disposable: vscode.Disposable | undefined;
  private activeCts = new Map<string, vscode.CancellationTokenSource>();
  private initialized = false;

  async isAvailable(): Promise<boolean> {
    if (typeof vscode.lm?.selectChatModels !== 'function') return false;
    try {
      const models = await vscode.lm.selectChatModels({});
      return models.length > 0;
    } catch {
      return false;
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.models = await vscode.lm.selectChatModels({});

    this.disposable = vscode.lm.onDidChangeChatModels(async () => {
      try {
        this.models = await vscode.lm.selectChatModels({});
      } catch {
        // Model refresh failed — keep existing list
      }
    });

    this.initialized = true;
  }

  async dispose(): Promise<void> {
    this.disposable?.dispose();
    this.disposable = undefined;
    for (const cts of this.activeCts.values()) {
      cts.cancel();
      cts.dispose();
    }
    this.activeCts.clear();
    this.models = [];
    this.initialized = false;
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.initialized) await this.initialize();
    return this.models.map(m => toModelInfo(m));
  }

  async isModelAvailable(modelId: string): Promise<boolean> {
    if (!this.initialized) await this.initialize();
    return this.models.some(m => m.id === modelId);
  }

  async streamCompletion(
    modelId: string,
    messages: ContextMessage[],
    onToken: (token: string) => void,
    options?: CompletionOptions
  ): Promise<CompletionResult> {
    const model = this.findModel(modelId);
    const lmMessages = convertMessages(messages);

    const cts = new vscode.CancellationTokenSource();
    const requestId = `${modelId}-${Date.now()}`;
    this.activeCts.set(requestId, cts);

    // Bridge external AbortSignal → CancellationTokenSource
    if (options?.signal) {
      const signal = options.signal;
      if (signal.aborted) {
        cts.cancel();
      } else if (typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', () => cts.cancel(), { once: true });
      } else if (typeof signal.onabort !== 'undefined') {
        signal.onabort = (): void => cts.cancel();
      }
    }

    try {
      const response = await model.sendRequest(lmMessages, {}, cts.token);
      let fullContent = '';

      for await (const fragment of response.text) {
        fullContent += fragment;
        onToken(fragment);
      }

      // Count tokens if the API supports it
      let promptTokens = 0;
      let completionTokens = 0;
      try {
        promptTokens = await model.countTokens(lmMessages.map(m => m).join('\n'));
      } catch {
        // Token counting not available
      }
      try {
        completionTokens = await model.countTokens(fullContent);
      } catch {
        // Token counting not available
      }

      return {
        content: fullContent,
        finishReason: 'stop',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        model: modelId,
        estimatedCostUSD: 0,
      };
    } catch (err) {
      throw mapVscodeLmError(err);
    } finally {
      this.activeCts.delete(requestId);
      cts.dispose();
    }
  }

  async complete(
    modelId: string,
    messages: ContextMessage[],
    options?: CompletionOptions
  ): Promise<CompletionResult> {
    let fullContent = '';
    const result = await this.streamCompletion(
      modelId,
      messages,
      (token) => {
        fullContent += token;
      },
      options
    );
    return { ...result, content: fullContent || result.content };
  }

  cancelRequest(requestId: string): void {
    const cts = this.activeCts.get(requestId);
    if (cts) {
      cts.cancel();
      cts.dispose();
      this.activeCts.delete(requestId);
    }
  }

  private findModel(modelId: string): vscode.LanguageModelChat {
    const model = this.models.find(m => m.id === modelId);
    if (!model) {
      throw new ProviderErrorImpl({
        code: 'MODEL_UNAVAILABLE',
        message: `Model '${modelId}' not found in VS Code language models`,
        retryable: false,
      });
    }
    return model;
  }
}

/**
 * Convert engine ContextMessage[] to vscode LanguageModelChatMessage[].
 * The vscode.lm API only supports User and Assistant roles — no system role.
 * System messages are prepended to the first user message as a tagged block.
 */
function convertMessages(messages: ContextMessage[]): vscode.LanguageModelChatMessage[] {
  const systemParts: string[] = [];
  const result: vscode.LanguageModelChatMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(msg.content);
      continue;
    }

    if (msg.role === 'user') {
      if (systemParts.length > 0) {
        const systemBlock = systemParts.join('\n\n');
        systemParts.length = 0;
        result.push(
          vscode.LanguageModelChatMessage.User(`[System]\n${systemBlock}\n[/System]\n\n${msg.content}`)
        );
      } else {
        result.push(vscode.LanguageModelChatMessage.User(msg.content));
      }
    } else if (msg.role === 'assistant') {
      // Flush any remaining system parts before assistant message
      if (systemParts.length > 0) {
        const systemBlock = systemParts.join('\n\n');
        systemParts.length = 0;
        result.push(
          vscode.LanguageModelChatMessage.User(`[System]\n${systemBlock}\n[/System]`)
        );
      }
      result.push(vscode.LanguageModelChatMessage.Assistant(msg.content));
    }
  }

  // If there are trailing system messages with no user message after them
  if (systemParts.length > 0) {
    const systemBlock = systemParts.join('\n\n');
    result.push(
      vscode.LanguageModelChatMessage.User(`[System]\n${systemBlock}\n[/System]`)
    );
  }

  return result;
}

function toModelInfo(model: vscode.LanguageModelChat): ModelInfo {
  const caps: ModelCapabilities = {
    streaming: true,
    maxContextTokens: model.maxInputTokens,
    maxOutputTokens: 4096,
    functionCalling: false,
  };

  return {
    id: model.id,
    displayName: model.name,
    defaultNickname: model.family,
    capabilities: caps,
  };
}

function mapVscodeLmError(err: unknown): ProviderErrorImpl {
  if (err instanceof vscode.LanguageModelError) {
    if (err.code === 'NoPermissions' || err.message.includes('NoPermissions')) {
      return new ProviderErrorImpl({
        code: 'AUTH_FAILED',
        message: `VS Code LM permission denied: ${err.message}`,
        retryable: false,
        cause: err,
      });
    }
    if (err.code === 'NotFound' || err.message.includes('NotFound')) {
      return new ProviderErrorImpl({
        code: 'MODEL_UNAVAILABLE',
        message: `VS Code LM model not found: ${err.message}`,
        retryable: false,
        cause: err,
      });
    }
    if (err.code === 'Blocked' || err.message.includes('Blocked')) {
      return new ProviderErrorImpl({
        code: 'QUOTA_EXCEEDED',
        message: `VS Code LM request blocked: ${err.message}`,
        retryable: true,
        cause: err,
      });
    }
    return new ProviderErrorImpl({
      code: 'PROVIDER_ERROR',
      message: `VS Code LM error: ${err.message}`,
      retryable: false,
      cause: err,
    });
  }

  const error = err instanceof Error ? err : new Error(String(err));
  if (error.name === 'CancellationError' || error.message.includes('cancelled')) {
    return new ProviderErrorImpl({
      code: 'CANCELLED',
      message: 'Request was cancelled',
      retryable: false,
      cause: error,
    });
  }

  return new ProviderErrorImpl({
    code: 'PROVIDER_ERROR',
    message: `VS Code LM error: ${error.message}`,
    retryable: false,
    cause: error,
  });
}
