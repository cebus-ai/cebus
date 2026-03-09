/**
 * Worker Factory
 *
 * T010: Worker contract definitions.
 * T017: Factory function routing to LangChain or Copilot worker.
 *
 * Default: LangChainWorker (LangChain chat models — integrates with LangGraph memory).
 * Fallback: CEBUS_USE_PROVIDER_ADAPTER=true → ProviderAdapterWorker (our provider adapters).
 */

import type { AgentProfile, WorkerExecutor, OrchestrationLogger } from '../types.js';
import { OrchestrationError } from '../types.js';

/**
 * Create a worker executor based on the agent's provider type.
 *
 * - openai, anthropic, gemini, ollama → LangChainWorker (default) or ProviderAdapterWorker (env flag)
 * - copilot → CopilotWorker (dynamic import, optional peer dependency)
 */
export async function createWorker(
  profile: AgentProfile,
  logger?: OrchestrationLogger
): Promise<WorkerExecutor> {
  const providerType = profile.provider?.type ?? 'openai';
  const useProviderAdapter = process.env['CEBUS_USE_PROVIDER_ADAPTER'] === 'true';

  switch (providerType) {
    case 'openai':
    case 'anthropic':
    case 'gemini':
    case 'ollama':
    case 'openrouter': {
      if (useProviderAdapter) {
        const { ProviderAdapterWorker } = await import('./provider-adapter-worker.js');
        const worker = new ProviderAdapterWorker(profile, logger);
        if (profile.providerSessionState) {
          worker.setProviderSessionState(profile.providerSessionState);
        }
        return worker;
      }

      const { LangChainWorker } = await import('./langchain-worker.js');
      const worker = new LangChainWorker(profile, logger);
      if (profile.providerSessionState) {
        worker.setProviderSessionState(profile.providerSessionState);
      }
      return worker;
    }

    case 'copilot': {
      try {
        const { CopilotWorker } = await import('./copilot-worker.js');
        const worker = new CopilotWorker(profile, logger);
        // Restore saved session ID for zero-cost SDK resume
        if (profile.copilotSessionId !== undefined && profile.copilotSessionId.length > 0) {
          worker.setSessionId(profile.copilotSessionId);
        }
        return worker;
      } catch {
        throw new OrchestrationError(
          'CONFIG_VALIDATION',
          `Copilot provider requires @github/copilot-sdk. Install it with: npm install @github/copilot-sdk`
        );
      }
    }

    case 'vscode-lm': {
      const { ProviderAdapterWorker } = await import('./provider-adapter-worker.js');
      const worker = new ProviderAdapterWorker(profile, logger);
      if (profile.providerSessionState) {
        worker.setProviderSessionState(profile.providerSessionState);
      }
      return worker;
    }

    default:
      throw new OrchestrationError(
        'CONFIG_VALIDATION',
        `Unknown provider type: ${providerType}. Valid types: openai, anthropic, gemini, ollama, copilot, openrouter, vscode-lm`
      );
  }
}
