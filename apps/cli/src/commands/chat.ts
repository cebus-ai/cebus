import React from 'react';
import { render } from 'ink';
import { parseArgs } from 'util';
import {
  createSession,
  addUserParticipant,
  addModelParticipant,
  getProviderRegistry,
  initializeProviders,
  checkCopilotStatus,
  printProviderStatus,
} from '@cebus/engine';
import type { Participant } from '@cebus/engine';
import { ChatApp } from '../app';

export interface ChatCommandOptions {
  /** Model specifications in format provider:model (e.g., openai:gpt-4) */
  models?: string[] | undefined;

  /** Session title */
  title?: string | undefined;

  /** Interactive model selection mode */
  interactive?: boolean | undefined;
}

export interface ChatSession {
  sessionId: string;
  user: Participant;
  models: Participant[];
}

export function parseChatArgs(args: string[]): ChatCommandOptions {
  const { values } = parseArgs({
    args,
    options: {
      models: {
        type: 'string',
        short: 'm',
        multiple: true,
      },
      title: {
        type: 'string',
        short: 't',
      },
      interactive: {
        type: 'boolean',
        short: 'i',
      },
    },
    allowPositionals: true,
  });

  return {
    models: values.models as string[] | undefined,
    title: values.title as string | undefined,
    interactive: values.interactive as boolean | undefined,
  };
}

export interface ModelSpec {
  providerId: string;
  modelId: string;
  nickname?: string | undefined;
}

/**
 * Parse a model specification string.
 * Format: provider:model[:nickname]
 * Examples: "openai:gpt-4", "anthropic:claude-3-opus:Claude"
 */
export function parseModelSpec(spec: string): ModelSpec {
  const parts = spec.split(':');

  if (
    parts.length < 2 ||
    parts[0] === undefined ||
    parts[0].length === 0 ||
    parts[1] === undefined ||
    parts[1].length === 0
  ) {
    throw new Error(
      `Invalid model specification: ${spec}. Expected format: provider:model[:nickname]`
    );
  }

  return {
    providerId: parts[0],
    modelId: parts[1],
    nickname: parts[2],
  };
}

/**
 * Initialize a chat session with specified models.
 */
export async function initializeChat(options: ChatCommandOptions): Promise<ChatSession> {
  await initializeProviders();

  // Default to 'none' (no folder access) — interactive mode handles consent via Onboarding
  const session = createSession({
    title: options.title,
    contextConfig: { level: 'none' },
  });

  const user = addUserParticipant(session.id, {
    displayName: 'You',
    nickname: 'User',
  });

  const models: Participant[] = [];

  if (options.models && options.models.length > 0) {
    const hasCopilotModel = options.models.some(spec => spec.startsWith('copilot:'));
    if (hasCopilotModel) {
      // eslint-disable-next-line no-console
      console.log('Checking GitHub Copilot status...');
      const copilotStatus = await checkCopilotStatus();

      if (!copilotStatus.installed) {
        throw new Error(copilotStatus.error ?? 'GitHub Copilot SDK not installed');
      }

      if (!copilotStatus.authenticated) {
        throw new Error(
          copilotStatus.error ?? 'GitHub Copilot not authenticated. Run: github-copilot-cli auth'
        );
      }

      // eslint-disable-next-line no-console
      console.log('GitHub Copilot: Ready ✓');
    }

    for (const spec of options.models) {
      const { providerId, modelId, nickname } = parseModelSpec(spec);

      const registry = getProviderRegistry();
      const provider = registry.get(providerId);

      if (!provider) {
        throw new Error(`Unknown provider: ${providerId}`);
      }

      const isAvailable = await provider.isModelAvailable(modelId);

      if (!isAvailable) {
        throw new Error(`Model ${modelId} is not available from ${providerId}`);
      }

      const model = addModelParticipant(session.id, providerId, modelId, {
        nickname,
      });
      models.push(model);
    }
  }

  return {
    sessionId: session.id,
    user,
    models,
  };
}

/**
 * List available models.
 */
export async function listModelsCommand(): Promise<void> {
  await initializeProviders();

  const registry = getProviderRegistry();
  const providers = await registry.getAvailable();

  // eslint-disable-next-line no-console
  console.log('\nAvailable Models:\n');

  for (const provider of providers) {
    // eslint-disable-next-line no-console
    console.log(`${provider.displayName}:`);
    const models = await provider.listModels();

    for (const model of models) {
      // eslint-disable-next-line no-console
      console.log(`  - ${model.id} (${model.displayName})`);
      // eslint-disable-next-line no-console
      console.log(`    Nickname: @${model.defaultNickname}`);
    }
    // eslint-disable-next-line no-console
    console.log();
  }
}

/**
 * Show help for chat command.
 */
export function showChatHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`
Cebus - Multi-Model Chat

Usage:
  cebus chat [options]

Options:
  -m, --models <spec>    Add models to the chat (can be used multiple times)
                         Format: provider:model[:nickname]
                         Example: -m openai:gpt-4 -m anthropic:claude-3-opus:Claude

  -t, --title <title>    Set a title for the chat session

  -i, --interactive      Interactive model selection mode

  -r, --resume <id>      Resume a previous session (prefix match)

Commands in chat:
  /help                  Show available commands
  /exit                  Exit the chat session
  /clear                 Clear chat history display
  /add <spec>           Add a model to the session
  /remove <nickname>    Remove a model from the session
  /rename <old> <new>   Rename a participant's nickname
  /list                 List all participants

Context commands:
  /context               Show current context level
  /context <level>       Set context level (none|minimal|full)
  /refresh               Force project context refresh

Addressing models:
  @GPT4 Hello           Send message only to GPT4
  @Claude What do you   Send message only to Claude
  (no @mention)         Broadcast to all models

Context levels:
  none      CLAUDE.md only
  minimal   CLAUDE.md + project name + git branch (default)
  full      CLAUDE.md + README + directory + git status

Examples:
  cebus chat -m openai:gpt-4 -m anthropic:claude-3-opus
  cebus chat -m openai:gpt-4:GPT -t "Code Review"
`);
}

export async function chatCommand(args: string[]): Promise<void> {
  const options = parseChatArgs(args);

  if (args.includes('--help') || args.includes('-h')) {
    showChatHelp();
    return;
  }

  if (args.includes('--list-models')) {
    await listModelsCommand();
    return;
  }

  await printProviderStatus();

  if (options.models === undefined || options.models.length === 0) {
    if (options.interactive !== true) {
      console.error(
        'Error: No models specified. Use -m to specify models or -i for interactive selection.'
      );
      console.error('Example: cebus chat -m openai:gpt-4 -m anthropic:claude-3-opus');
      console.error('\nRun "cebus chat --help" for more information.');
      process.exit(1);
    }
  }

  try {
    const chat = await initializeChat(options);

    const { waitUntilExit } = render(
      React.createElement(ChatApp, {
        sessionId: chat.sessionId,
        title: options.title,
      })
    );

    await waitUntilExit();
  } catch (error) {
    console.error('Error starting chat:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
