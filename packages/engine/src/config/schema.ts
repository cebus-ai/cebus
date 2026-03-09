import { z } from 'zod';

export const NicknameSchema = z
  .string()
  .min(1, 'Nickname cannot be empty')
  .max(30, 'Nickname must be 30 characters or less')
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_\-. ]*$/,
    'Nickname must start with a letter and contain only letters, numbers, spaces, dots, underscores, or hyphens'
  );

export const CompletionMetaSchema = z.object({
  finishReason: z.enum(['stop', 'length', 'error', 'cancelled']),
  usage: z
    .object({
      promptTokens: z.number(),
      completionTokens: z.number(),
    })
    .optional(),
  timeToFirstToken: z.number().optional(),
  totalTime: z.number().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

export const MessageSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  senderId: z.string().uuid(),
  content: z.string(),
  timestamp: z.number().positive(),
  type: z.enum(['user', 'assistant', 'system']),
  status: z.enum(['sending', 'sent', 'streaming', 'complete', 'error', 'partial']),
  directedTo: z.array(z.string().uuid()).optional(),
  completionMeta: CompletionMetaSchema.optional(),
});

export const ProviderConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  timeout: z.number().positive().optional(),
});

export const ConfigSchema = z.object({
  providers: z
    .object({
      openai: ProviderConfigSchema.optional(),
      anthropic: ProviderConfigSchema.optional(),
      copilot: ProviderConfigSchema.optional(),
      openrouter: ProviderConfigSchema.optional(),
    })
    .optional(),
  defaults: z
    .object({
      maxTokens: z.number().positive().optional(),
      temperature: z.number().min(0).max(2).optional(),
    })
    .optional(),
});
