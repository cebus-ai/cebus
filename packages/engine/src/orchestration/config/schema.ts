import { z } from 'zod';

const alphanumericHyphen = (maxLen: number): z.ZodString =>
  z
    .string()
    .min(1)
    .max(maxLen)
    .regex(/^[a-zA-Z0-9-]+$/, 'Must contain only alphanumeric characters and hyphens');

export const MCPServerConfigSchema = z
  .object({
    id: alphanumericHyphen(64),
    type: z.enum(['local', 'http']),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    url: z.string().url().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    tools: z.array(z.string()).default(['*']),
    timeout: z.number().int().positive().max(300000).default(30000),
    env: z.record(z.string(), z.string()).optional(),
  })
  .refine(
    data => {
      if (data.type === 'local') return data.command !== undefined;
      return true;
    },
    { message: 'command is required when type is "local"', path: ['command'] }
  )
  .refine(
    data => {
      if (data.type === 'http') return data.url !== undefined;
      return true;
    },
    { message: 'url is required when type is "http"', path: ['url'] }
  );

export const ProviderConfigSchema = z.object({
  type: z.enum(['openai', 'anthropic', 'gemini', 'ollama', 'copilot', 'openrouter', 'vscode-lm']),
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
});

export const AIRoutingConfigSchema = z.object({
  provider: ProviderConfigSchema.default({ type: 'ollama' }),
  model: z.string().min(1).default('llama3.2'),
});

export const ToolApprovalConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    readOnly: z.array(z.string().min(1)).default([]),
    write: z.array(z.string().min(1)).default([]),
    dangerous: z.array(z.string().min(1)).default([]),
  })
  .refine(
    data => {
      if (!data.enabled) return true;
      const readOnlySet = new Set(data.readOnly);
      return !data.dangerous.some(pattern => readOnlySet.has(pattern));
    },
    {
      message: 'dangerous tool patterns must not overlap with readOnly patterns',
      path: ['dangerous'],
    }
  );

export const BudgetConfigSchema = z.object({
  maxTokensPerAgentPerSession: z.number().int().positive().nullable().default(null),
  maxTokensPerSession: z.number().int().positive().nullable().default(null),
  maxInvocationsPerMinute: z.number().int().positive().nullable().default(null),
});

export const CompactionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  checkpointInterval: z.number().int().positive().default(20),
  anchorRefreshThreshold: z.number().int().positive().optional(),
});

export const PersistenceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  directory: z.string().min(1).default('~/.cebus/sessions'),
});

export const OrchestratorMiddlewareConfigSchema = z.object({
  model: z.string().min(1).optional(),
  provider: ProviderConfigSchema.optional(),
  maxRounds: z.number().int().min(1).max(10).optional(),
});

export const TeamLeaderConfigSchema = z.object({
  enabled: z.boolean(),
  model: z.string().min(1).optional(),
  provider: ProviderConfigSchema.optional(),
  verbosity: z.enum(['minimal', 'normal', 'verbose']).optional(),
  timeout: z.number().int().positive().max(120000).optional(),
});

export const AgentProfileSchema = z.object({
  id: alphanumericHyphen(32),
  name: z.string().min(1).max(100),
  role: z.string().min(1).max(500),
  instructions: z
    .array(z.string().min(1))
    .default([]),
  skills: z.array(z.string().min(1)).default([]),
  mcpServers: z.array(MCPServerConfigSchema).default([]),
  model: z.string().min(1).optional(),
  provider: ProviderConfigSchema.optional(),
  availableTools: z.array(z.string()).optional(),
  allowedPaths: z.array(z.string()).optional(),
  copilotSessionId: z.string().optional(),
  providerSessionState: z.record(z.string(), z.unknown()).optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  customAgents: z.array(z.object({
    name: z.string(),
    displayName: z.string(),
    description: z.string(),
    prompt: z.string(),
  })).optional(),
});

export const TeamConfigSchema = z
  .object({
    teamId: alphanumericHyphen(64),
    mission: z.string().min(1).max(2000),
    orchestrationMode: z.enum(['ai', 'deterministic']).default('deterministic'),
    conversationMode: z
      .enum(['dynamic', 'tag_only', 'sequential', 'free_chat'])
      .default('tag_only'),
    agents: z
      .array(AgentProfileSchema)
      .min(1, 'At least one agent is required')
      .max(10, 'Maximum 10 agents allowed'),
    defaultAgentId: z.string().optional(),
    orchestratorInstructions: z.array(z.string().min(1)).optional(),
    orchestratorContext: z.array(z.string().min(1)).optional(),
    aiRouting: AIRoutingConfigSchema.optional(),
    orchestrator: OrchestratorMiddlewareConfigSchema.optional(),
    teamLeader: TeamLeaderConfigSchema.optional(),
    toolApproval: ToolApprovalConfigSchema.optional(),
    budgets: BudgetConfigSchema.optional(),
    compaction: CompactionConfigSchema.default({ enabled: true, checkpointInterval: 20 }),
    sessionPersistence: PersistenceConfigSchema.default({
      enabled: true,
      directory: '~/.cebus/sessions',
    }),
  })
  .refine(
    data => {
      const ids = data.agents.map(a => a.id);
      return new Set(ids).size === ids.length;
    },
    { message: 'Agent IDs must be unique within the team', path: ['agents'] }
  )
  .refine(
    data => {
      if (data.defaultAgentId === undefined) return true;
      return data.agents.some(a => a.id === data.defaultAgentId);
    },
    {
      message: 'defaultAgentId must reference a valid agent in the agents array',
      path: ['defaultAgentId'],
    }
  )
  .refine(
    data => {
      if (data.orchestrationMode === 'ai' && data.conversationMode === 'dynamic') {
        return data.agents.some(a => a.skills !== undefined && a.skills.length > 0);
      }
      return true;
    },
    {
      message:
        'At least one agent must have non-empty skills when using AI orchestration with dynamic conversation mode',
      path: ['agents'],
    }
  );
