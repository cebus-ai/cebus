import type { ProviderAdapter, ProviderRegistry, ModelInfo } from './types';
import { debug } from '../core/debug-logger';

class ProviderRegistryImpl implements ProviderRegistry {
  private adapters: Map<string, ProviderAdapter> = new Map();
  private modelCache: Map<string, { providerId: string; modelInfo: ModelInfo }> = new Map();
  private initialized: Set<string> = new Set();
  private initErrors: Map<string, string> = new Map();

  /**
   * Register a provider adapter.
   * @throws If provider with same ID already registered
   */
  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Provider '${adapter.id}' is already registered`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  /**
   * Unregister a provider adapter.
   */
  unregister(providerId: string): void {
    const adapter = this.adapters.get(providerId);
    if (adapter) {
      for (const [modelId, entry] of this.modelCache.entries()) {
        if (entry.providerId === providerId) {
          this.modelCache.delete(modelId);
        }
      }
      this.initialized.delete(providerId);
      this.adapters.delete(providerId);
    }
  }

  /**
   * Get a provider by ID.
   */
  get(providerId: string): ProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  /**
   * Get all registered providers.
   */
  getAll(): ProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Get all available providers (initialized and ready).
   */
  async getAvailable(): Promise<ProviderAdapter[]> {
    const available: ProviderAdapter[] = [];

    for (const adapter of this.adapters.values()) {
      try {
        const isAvailable = await adapter.isAvailable();
        if (isAvailable) {
          available.push(adapter);
        }
      } catch (error) {
        debug('registry', 'provider-availability-check-failed', {
          providerId: adapter.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return available;
  }

  /**
   * Initialize a specific provider.
   */
  async initializeProvider(providerId: string): Promise<void> {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new Error(`Provider '${providerId}' not found`);
    }

    if (this.initialized.has(providerId)) {
      return;
    }

    try {
      await adapter.initialize();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.initErrors.set(providerId, message);
      debug('registry', 'provider-initialization-failed', {
        providerId,
        error: message,
      });
      return;
    }

    this.initialized.add(providerId);
    this.initErrors.delete(providerId);

    try {
      const models = await adapter.listModels();
      for (const model of models) {
        this.modelCache.set(model.id, {
          providerId,
          modelInfo: model,
        });
      }
    } catch (error) {
      debug('registry', 'model-listing-failed', {
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Initialize all available providers.
   */
  async initializeAll(): Promise<void> {
    const available = await this.getAvailable();
    await Promise.all(available.map(adapter => this.initializeProvider(adapter.id)));
  }

  /**
   * Find a provider that has a specific model.
   */
  async findProviderForModel(modelId: string): Promise<ProviderAdapter | undefined> {
    const cached = this.modelCache.get(modelId);
    if (cached) {
      return this.adapters.get(cached.providerId);
    }

    for (const adapter of this.adapters.values()) {
      try {
        const hasModel = await adapter.isModelAvailable(modelId);
        if (hasModel) {
          return adapter;
        }
      } catch (error) {
        debug('registry', 'model-search-failed', {
          providerId: adapter.id,
          modelId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return undefined;
  }

  /**
   * Get model info by ID.
   */
  getModelInfo(modelId: string): ModelInfo | undefined {
    return this.modelCache.get(modelId)?.modelInfo;
  }

  /**
   * List all known models across all providers.
   */
  async listAllModels(): Promise<Array<ModelInfo & { providerId: string }>> {
    const models: Array<ModelInfo & { providerId: string }> = [];

    for (const adapter of this.adapters.values()) {
      try {
        const providerModels = await adapter.listModels();
        for (const model of providerModels) {
          models.push({
            ...model,
            providerId: adapter.id,
          });
        }
      } catch (error) {
        debug('registry', 'list-all-models-failed', {
          providerId: adapter.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return models;
  }

  /**
   * Dispose all providers.
   */
  async disposeAll(): Promise<void> {
    const disposals = Array.from(this.adapters.values()).map(async adapter => {
      try {
        await adapter.dispose();
      } catch (error) {
        debug('registry', 'provider-disposal-failed', {
          providerId: adapter.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await Promise.all(disposals);
    this.adapters.clear();
    this.modelCache.clear();
    this.initialized.clear();
    this.initErrors.clear();
  }

  /**
   * Check if a provider is initialized.
   */
  isInitialized(providerId: string): boolean {
    return this.initialized.has(providerId);
  }

  getInitError(providerId: string): string | undefined {
    return this.initErrors.get(providerId);
  }

  getInitErrors(): Map<string, string> {
    return new Map(this.initErrors);
  }
}

let registryInstance: ProviderRegistryImpl | null = null;

/**
 * Get the global provider registry instance.
 */
export function getProviderRegistry(): ProviderRegistryImpl {
  if (!registryInstance) {
    registryInstance = new ProviderRegistryImpl();
  }
  return registryInstance;
}

/**
 * Reset the provider registry (useful for testing).
 */
export async function resetProviderRegistry(): Promise<void> {
  if (registryInstance) {
    await registryInstance.disposeAll();
    registryInstance = null;
  }
}

export type { ProviderRegistry };
