import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type {
  RoutingStrategy,
  RoutingState,
  RoutingResult,
  AgentProfile,
  AIRoutingConfig,
  TeamConfig,
} from '../types.js';
import { OrchestrationError } from '../types.js';
import { getOpenRouterConfig, createBYOKFetch } from '../../providers/openrouter.js';
// Orchestrator responses need enough output space for JSON with plans/agent lists
const ORCHESTRATOR_MAX_TOKENS = 4096;

export async function createRoutingLLM(config?: AIRoutingConfig): Promise<BaseChatModel> {
  const providerType = config?.provider?.type ?? 'ollama';
  const model = config?.model ?? 'llama3.2';
  const apiKey = config?.provider?.apiKey;
  const baseUrl = config?.provider?.baseUrl;

  switch (providerType) {
    case 'openai': {
      const { ChatOpenAI } = await import('@langchain/openai');
      const opts: Record<string, unknown> = { model, maxTokens: ORCHESTRATOR_MAX_TOKENS };
      const key = apiKey ?? process.env['OPENAI_API_KEY'];
      if (key !== undefined && key.length > 0) opts['apiKey'] = key;
      if (baseUrl !== undefined && baseUrl.length > 0) opts['configuration'] = { baseURL: baseUrl };
      return new ChatOpenAI(opts);
    }

    case 'anthropic': {
      const { ChatAnthropic } = await import('@langchain/anthropic');
      const opts: Record<string, unknown> = { model, maxTokens: ORCHESTRATOR_MAX_TOKENS };
      const key = apiKey ?? process.env['ANTHROPIC_API_KEY'];
      if (key !== undefined && key.length > 0) opts['apiKey'] = key;
      return new ChatAnthropic(opts);
    }

    case 'gemini': {
      const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
      const key = apiKey ?? process.env['GOOGLE_API_KEY'];
      if (key === undefined || key.length === 0) {
        throw new OrchestrationError(
          'CONFIG_VALIDATION',
          'Google API key required for Gemini routing LLM. Set GOOGLE_API_KEY or provide apiKey in aiRouting config.'
        );
      }
      return new ChatGoogleGenerativeAI({ model, apiKey: key, maxOutputTokens: ORCHESTRATOR_MAX_TOKENS });
    }

    case 'openrouter': {
      const { ChatOpenAI } = await import('@langchain/openai');
      const resolved = getOpenRouterConfig({ apiKey, baseUrl });
      if ((resolved.apiKey === undefined || resolved.apiKey.length === 0) && !resolved.isBYOK) {
        throw new OrchestrationError(
          'CONFIG_VALIDATION',
          'OpenRouter not configured. Set OPENROUTER_API_KEY, or CLOUDFLARE_AI_GATEWAY_URL + CLOUDFLARE_GATEWAY_API_KEY for gateway BYOK.'
        );
      }
      return new ChatOpenAI({
        model,
        maxTokens: ORCHESTRATOR_MAX_TOKENS,
        apiKey: resolved.apiKey ?? 'byok',
        configuration: {
          baseURL: resolved.baseUrl,
          defaultHeaders: resolved.headers,
          ...(resolved.isBYOK ? { fetch: createBYOKFetch() } : {}),
        },
      });
    }

    case 'ollama': {
      const { ChatOllama } = await import('@langchain/ollama');
      return new ChatOllama({
        model,
        numPredict: ORCHESTRATOR_MAX_TOKENS,
        baseUrl: baseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434',
      });
    }

    default:
      throw new OrchestrationError(
        'CONFIG_VALIDATION',
        `Unsupported routing LLM provider: ${providerType}`
      );
  }
}
export class DynamicRoutingStrategy implements RoutingStrategy {
  private llm: BaseChatModel | null = null;

  constructor(
    private readonly teamConfig: TeamConfig,
    private readonly routingConfig?: AIRoutingConfig
  ) {}

  async route(
    message: string,
    agents: ReadonlyArray<AgentProfile>,
    state: RoutingState
  ): Promise<RoutingResult> {
    if (state.orchestrationMode === 'deterministic') {
      const defaultId = state.defaultAgentId ?? agents[0]?.id ?? '';
      return {
        targetAgentIds: [defaultId],
        reason: `Deterministic dynamic mode — routed to default agent: ${defaultId}`,
      };
    }

    try {
      const llm = await this.getOrCreateLLM();
      const systemPrompt = this.buildRoutingPrompt(agents);

      const response = await llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(message),
      ]);

      const content = typeof response.content === 'string' ? response.content : '';

      return this.parseRoutingResponse(content, agents);
    } catch (err) {
      const defaultId = state.defaultAgentId ?? agents[0]?.id ?? '';
      return {
        targetAgentIds: [defaultId],
        reason: `AI routing failed, falling back to default agent: ${defaultId}. Error: ${err instanceof Error ? err.message : 'unknown'}`,
        confidence: 0,
      };
    }
  }

  private async getOrCreateLLM(): Promise<BaseChatModel> {
    if (this.llm) return this.llm;
    this.llm = await createRoutingLLM(this.routingConfig);
    return this.llm;
  }

  private buildRoutingPrompt(agents: ReadonlyArray<AgentProfile>): string {
    const parts: string[] = [
      'You are a routing orchestrator. Your job is to select the best agent to handle the user message.',
      '',
      `Team Mission: ${this.teamConfig.mission}`,
      '',
      'Available Agents:',
    ];

    for (const agent of agents) {
      const skills =
        agent.skills && agent.skills.length > 0 ? ` [Skills: ${agent.skills.join(', ')}]` : '';
      parts.push(`- ${agent.id}: ${agent.name} — ${agent.role}${skills}`);
    }

    if (
      this.teamConfig.orchestratorInstructions &&
      this.teamConfig.orchestratorInstructions.length > 0
    ) {
      parts.push('', 'Routing Instructions:');
      for (const instruction of this.teamConfig.orchestratorInstructions) {
        parts.push(`- ${instruction}`);
      }
    }

    if (this.teamConfig.orchestratorContext && this.teamConfig.orchestratorContext.length > 0) {
      parts.push('', 'Additional Context:');
      for (const context of this.teamConfig.orchestratorContext) {
        parts.push(context);
      }
    }

    parts.push(
      '',
      'Respond with ONLY the agent ID (e.g., "backend") that should handle this message.',
      'If multiple agents are needed, separate with commas (e.g., "backend,reviewer").',
      'Add a brief reason after a pipe character (e.g., "backend|API design question").'
    );

    return parts.join('\n');
  }

  private parseRoutingResponse(
    response: string,
    agents: ReadonlyArray<AgentProfile>
  ): RoutingResult {
    const trimmed = response.trim();
    const [agentsPart, reason] = trimmed.split('|').map(s => s.trim());

    if (agentsPart === undefined || agentsPart.length === 0) {
      const defaultId = agents[0]?.id ?? '';
      return {
        targetAgentIds: [defaultId],
        reason: 'Could not parse routing response, using first agent',
        confidence: 0,
      };
    }

    const agentIds = agentsPart.split(',').map(s => s.trim().toLowerCase());
    const validIds = agentIds
      .map(id => agents.find(a => a.id.toLowerCase() === id))
      .filter((a): a is AgentProfile => a !== undefined)
      .map(a => a.id);

    if (validIds.length === 0) {
      const defaultId = agents[0]?.id ?? '';
      return {
        targetAgentIds: [defaultId],
        reason: `AI routing suggested unknown agents (${agentsPart}), falling back to: ${defaultId}`,
        confidence: 0,
      };
    }

    return {
      targetAgentIds: validIds,
      reason: reason ?? `AI routing selected: ${validIds.join(', ')}`,
      confidence: 0.8,
    };
  }
}
