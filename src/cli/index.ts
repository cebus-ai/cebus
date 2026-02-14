import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ quiet: true });

// Set terminal window/tab title (ANSI OSC sequence + process name)
process.title = 'Cebus';
process.stdout.write('\x1b]0;Cebus\x07');

/**
 * Check runtime compatibility
 * Bun does not support better-sqlite3, which is required for session persistence
 */
if (typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined') {
  console.error('\n\x1b[31m╭────────────────────────────────────────────────────────╮\x1b[0m');
  console.error('\x1b[31m│  ⚠️  Cebus cannot run under Bun                       │\x1b[0m');
  console.error('\x1b[31m│                                                        │\x1b[0m');
  console.error('\x1b[31m│  Bun does not support better-sqlite3, which is         │\x1b[0m');
  console.error('\x1b[31m│  required for session persistence and LangGraph        │\x1b[0m');
  console.error('\x1b[31m│  checkpointing.                                        │\x1b[0m');
  console.error('\x1b[31m│                                                        │\x1b[0m');
  console.error('\x1b[31m│  Please install and use Node.js instead:               │\x1b[0m');
  console.error(
    '\x1b[31m│    \x1b[36mbrew install node\x1b[31m                                 │\x1b[0m'
  );
  console.error(
    '\x1b[31m│    \x1b[36mnpm run dev\x1b[31m                                      │\x1b[0m'
  );
  console.error('\x1b[31m│                                                        │\x1b[0m');
  console.error(
    '\x1b[31m│  Track Bun support: \x1b[2mhttps://github.com/oven-sh/bun/issues/4290\x1b[0m\x1b[31m │\x1b[0m'
  );
  console.error('\x1b[31m╰────────────────────────────────────────────────────────╯\x1b[0m\n');
  process.exit(1);
}

/**
 * Suppress Node.js ExperimentalWarning (e.g. SQLite) from polluting the CLI output.
 * Once a 'warning' listener exists, Node stops printing warnings to stderr itself.
 */
process.on('warning', (warning: Error) => {
  if (warning.name === 'ExperimentalWarning') return;
  console.warn(`${warning.name}: ${warning.message}`);
});

/**
 * SDKs (Anthropic, LangChain) emit noisy deprecation warnings via console.warn/error.
 * Reformat them as dim gray text with a leading newline so they don't pollute output.
 */

const _originalWarn = console.warn;
const _originalError = console.error;

function isDeprecationMessage(args: unknown[]): boolean {
  const msg = String(args[0] ?? '');
  return msg.includes('deprecated') || msg.includes('end-of-life') || msg.includes('end of life');
}

console.warn = (...args: unknown[]): void => {
  if (isDeprecationMessage(args)) {
    const msg = args.map(a => String(a)).join(' ');
    _originalWarn(`\n\x1b[2m${msg}\x1b[0m`);
    return;
  }
  _originalWarn(...args);
};

console.error = (...args: unknown[]): void => {
  if (isDeprecationMessage(args)) {
    const msg = args.map(a => String(a)).join(' ');
    _originalError(`\n\x1b[2m${msg}\x1b[0m`);
    return;
  }
  _originalError(...args);
};

import React from 'react';
import { render } from 'ink';
import { chatCommand, listModelsCommand } from './commands/chat';
import { interactiveCommand } from './commands/interactive';
import { ChatApp } from './app';
import { printBanner, printStatusLine, printHelp } from './banner';
import { loadConfig } from '../config';
import { registerBuiltInProviders, getProviderRegistry, initializeProviders } from '../providers';
import { enableDebugLogging, logSession } from '../core/debug-logger';
import { loadSession } from '../core/session-persistence';
import { getMessages, getParticipants } from '../core/session';
import { summarizeSession } from '../core/summarize-session';
import { createInterface } from 'readline';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

let isShuttingDown = false;

function handleShutdown(signal: string): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n\x1b[2mReceived ${signal}, shutting down gracefully...\x1b[0m`);
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

if (process.platform === 'win32') {
  process.on('SIGHUP', () => handleShutdown('SIGHUP'));
}

const VERSION = '0.1.0';
const NAME = 'cebus';

async function handleVersion(): Promise<void> {
  console.log(`${NAME} v${VERSION}`);
}

async function handleProviders(): Promise<void> {
  printBanner(VERSION);
  await listModelsCommand();
}

export async function handleConfig(skipBanner = false): Promise<void> {
  if (!skipBanner) {
    printBanner(VERSION);
  }
  console.log('\nConfiguration Status:\n');

  const openaiAvailable = Boolean(process.env.OPENAI_API_KEY);
  console.log(
    `  ${openaiAvailable ? '\x1b[32m●\x1b[0m OpenAI: Configured' : '\x1b[2m○ OpenAI: Not configured\x1b[0m'}`
  );

  const anthropicAvailable = Boolean(process.env.ANTHROPIC_API_KEY);
  console.log(
    `  ${anthropicAvailable ? '\x1b[32m●\x1b[0m Anthropic: Configured' : '\x1b[2m○ Anthropic: Not configured\x1b[0m'}`
  );

  const geminiAvailable = Boolean(process.env.GOOGLE_API_KEY);
  console.log(
    `  ${geminiAvailable ? '\x1b[32m●\x1b[0m Google Gemini: Configured' : '\x1b[2m○ Google Gemini: Not configured\x1b[0m'}`
  );

  // Check if Ollama is running
  let ollamaAvailable = false;
  try {
    await execFileAsync('ollama', ['list'], { timeout: 3000 });
    ollamaAvailable = true;
  } catch {
    // Ollama not running or not installed
  }
  console.log(
    `  ${ollamaAvailable ? '\x1b[32m●\x1b[0m Ollama: Running' : '\x1b[2m○ Ollama: Not running\x1b[0m'}`
  );

  // Check GitHub Copilot setup
  let ghCliInstalled = false;
  let ghCopilotInstalled = false;
  let copilotSdkAvailable = false;

  try {
    await execFileAsync('gh', ['--version'], { timeout: 5000 });
    ghCliInstalled = true;
  } catch {
    // gh CLI not found
  }

  try {
    await execFileAsync('gh', ['copilot', '--version'], { timeout: 5000 });
    ghCopilotInstalled = true;
  } catch {
    // gh copilot extension not found
  }

  try {
    await import('@github/copilot-sdk');
    copilotSdkAvailable = true;
  } catch {
    // SDK not found
  }

  const copilotFullyConfigured = ghCliInstalled && ghCopilotInstalled && copilotSdkAvailable;

  console.log(
    `  ${copilotFullyConfigured ? '\x1b[32m●\x1b[0m GitHub Copilot: Fully Configured' : '\x1b[2m○ GitHub Copilot: Not Configured\x1b[0m'}`
  );

  if (!copilotFullyConfigured) {
    console.log('    \x1b[2m├─ gh CLI:', ghCliInstalled ? '✓' : '✗ (brew install gh)\x1b[0m');
    console.log(
      '    \x1b[2m├─ gh copilot:',
      ghCopilotInstalled ? '✓' : '✗ (gh auth refresh --scopes copilot)\x1b[0m'
    );
    console.log(
      '    \x1b[2m└─ Copilot SDK:',
      copilotSdkAvailable ? '✓' : '✗ (npm install @github/copilot-sdk)\x1b[0m'
    );
  }

  console.log('\n\x1b[2m💡 Provider tip:\x1b[0m');
  console.log(
    '  \x1b[36mGitHub Copilot\x1b[0m — Worker tools built-in + multi-provider (GPT-5.2, Claude Opus, Sonnet)'
  );
  console.log(
    '  \x1b[2mAPI keys\x1b[0m       — Single provider, need to configure MCP servers for tools'
  );
  console.log(
    '  \x1b[2mOllama\x1b[0m         — Free & local, need to configure MCP servers for tools'
  );

  console.log('\n\x1b[2mTo configure API keys (create .env file):\x1b[0m');
  console.log('  cp .env.example .env');
  console.log('  # Then edit .env and add your API keys');
  console.log('\n\x1b[2mFor detailed setup, see README.md\x1b[0m');

  if (!copilotFullyConfigured) {
    console.log('  \x1b[33mGitHub Copilot setup:\x1b[0m');
    if (!ghCliInstalled) {
      console.log('    1. brew install gh');
      console.log('    2. gh auth login');
      console.log('    3. gh auth refresh --hostname github.com --scopes copilot');
      console.log('    4. npm install @github/copilot-sdk');
    } else if (!ghCopilotInstalled || !copilotSdkAvailable) {
      if (!ghCopilotInstalled) {
        console.log('    1. gh auth login (if not already)');
        console.log('    2. gh auth refresh --hostname github.com --scopes copilot');
      }
      if (!copilotSdkAvailable) {
        console.log(
          '    ' + (ghCopilotInstalled ? '1' : '3') + '. npm install @github/copilot-sdk'
        );
      }
    }
  }
  console.log('');

  // Check if at least one provider is available
  const hasAnyProvider =
    openaiAvailable ||
    anthropicAvailable ||
    geminiAvailable ||
    ollamaAvailable ||
    copilotFullyConfigured;

  if (!hasAnyProvider) {
    console.log('\x1b[31m╭──────────────────────────────────────────────────╮\x1b[0m');
    console.log('\x1b[31m│                                                  │\x1b[0m');
    console.log('\x1b[31m│  WARNING: No AI providers are configured!        │\x1b[0m');
    console.log('\x1b[31m│                                                  │\x1b[0m');
    console.log('\x1b[31m│  You must configure at least one provider        │\x1b[0m');
    console.log('\x1b[31m│  to use Cebus.                                   │\x1b[0m');
    console.log('\x1b[31m│                                                  │\x1b[0m');
    console.log('\x1b[31m╰──────────────────────────────────────────────────╯\x1b[0m\n');
    console.log('\x1b[33mQuick setup options:\x1b[0m');
    console.log('  1. \x1b[36mGitHub Copilot\x1b[0m \x1b[32m(recommended)\x1b[0m:');
    console.log(
      '     \x1b[2m• Built-in worker tools + multi-provider access (GPT-5.2, Claude, etc.)\x1b[0m'
    );
    console.log('     brew install gh');
    console.log('     gh auth login');
    console.log('     gh auth refresh --hostname github.com --scopes copilot');
    console.log('     npm install @github/copilot-sdk');
    console.log('');
    console.log('  2. \x1b[36mAPI Keys\x1b[0m (OpenAI, Anthropic, Gemini):');
    console.log('     \x1b[2m• Single provider, need MCP for tools\x1b[0m');
    console.log('     cp .env.example .env');
    console.log('     # Edit .env and add your API keys');
    console.log('');
    console.log('  3. \x1b[36mOllama\x1b[0m (free, local):');
    console.log('     \x1b[2m• Runs locally, need MCP for tools\x1b[0m');
    console.log('     brew install ollama');
    console.log('     ollama serve');
    console.log('');
    console.log('\x1b[2mSee README.md for detailed configuration and troubleshooting\x1b[0m');
    console.log('');
  }
}

function promptResumeMode(): Promise<'full' | 'summary' | 'none'> {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    console.log('How should models receive prior context?');
    console.log('  \x1b[1m[F]\x1b[0m Full    \x1b[2m— send all prior messages (default)\x1b[0m');
    console.log('  \x1b[1m[S]\x1b[0m Summary \x1b[2m— compress into a brief summary\x1b[0m');
    console.log('  \x1b[1m[N]\x1b[0m None    \x1b[2m— models start fresh\x1b[0m');
    console.log('');

    rl.question('Choice [F/S/N]: ', answer => {
      rl.close();
      const ch = answer.trim().toLowerCase();
      if (ch === 's') {
        resolve('summary');
      } else if (ch === 'n') {
        resolve('none');
      } else {
        resolve('full');
      }
    });
  });
}

async function handleResume(prefix: string): Promise<void> {
  printBanner(VERSION);

  const sessionId = loadSession(prefix);
  if (!sessionId) {
    console.error(`\x1b[31mSession not found for prefix: ${prefix}\x1b[0m`);
    console.error('Run a chat session first, then resume with the session ID shown on exit.');
    process.exit(1);
  }

  registerBuiltInProviders();
  await initializeProviders();

  const messages = getMessages(sessionId);
  const participants = getParticipants(sessionId);
  const modelCount = participants.filter(p => p.type === 'model').length;
  const modelNames = participants
    .filter(p => p.type === 'model')
    .map(p => p.displayName)
    .join(', ');

  console.log(
    `\x1b[2mResuming session ${sessionId.slice(0, 8)} (${messages.length} messages, ${modelCount} model${modelCount !== 1 ? 's' : ''}: ${modelNames})\x1b[0m\n`
  );

  const resumeMode = await promptResumeMode();
  console.log('');

  let resumeSummary: string | undefined;
  let resumeThreadId: string | undefined;

  if (resumeMode === 'summary') {
    if (messages.length === 0) {
      console.log('\x1b[33mNo message history for summary. Using Full mode instead.\x1b[0m\n');
    } else {
      console.log('\x1b[2mGenerating conversation summary...\x1b[0m');
      const nameMap = new Map<string, string>();
      for (const p of participants) {
        nameMap.set(p.id, p.displayName);
      }
      resumeSummary = await summarizeSession(messages, nameMap);
      console.log(`\x1b[36m${resumeSummary}\x1b[0m\n`);
      resumeThreadId = `${sessionId}-r${Date.now()}`;
    }
  } else if (resumeMode === 'none') {
    resumeThreadId = `${sessionId}-r${Date.now()}`;
  }

  const { waitUntilExit } = render(
    React.createElement(ChatApp, {
      sessionId,
      resumeMode,
      resumeSummary,
      resumeThreadId,
    })
  );

  await waitUntilExit();
}

async function handleChat(args: string[]): Promise<void> {
  registerBuiltInProviders();
  const registry = getProviderRegistry();
  const providers = registry.getAll();

  const statusList = await Promise.all(
    providers.map(async p => ({
      name: p.displayName,
      available: await p.isAvailable(),
    }))
  );

  printStatusLine(statusList);

  // Check if at least one provider is available
  const hasAvailableProvider = statusList.some(p => p.available);
  if (!hasAvailableProvider) {
    console.error('\n\x1b[31m⚠️  Cannot start chat: No AI providers are available!\x1b[0m');
    console.error('\x1b[31mShowing configuration status...\x1b[0m\n');

    // Show config and exit (skip banner - already printed above)
    await handleConfig(true);
    process.exit(1);
  }

  await chatCommand(args);
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const debugIndex = args.findIndex(arg => arg === '--debug' || arg === '-d');
  if (debugIndex !== -1 || process.env.CEBUS_DEBUG === '1') {
    enableDebugLogging();
    if (debugIndex !== -1) {
      args.splice(debugIndex, 1);
    }
    logSession('CLI started', { args, platform: process.platform, nodeVersion: process.version });
  }

  await loadConfig();

  const resumeIndex = args.findIndex(arg => arg === '--resume' || arg === '-r');
  if (resumeIndex !== -1) {
    const resumeId = args[resumeIndex + 1];
    if (!resumeId) {
      console.error('Error: --resume requires a session ID prefix.');
      console.error('Usage: cebus --resume <session-id-prefix>');
      process.exit(1);
    }
    await handleResume(resumeId);
    return;
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case 'chat':
      await handleChat(commandArgs);
      break;

    case 'providers':
    case 'models':
      await handleProviders();
      break;

    case 'config':
      await handleConfig();
      break;

    case 'version':
    case '-v':
    case '--version':
      await handleVersion();
      break;

    case 'help':
    case '-h':
    case '--help':
      printBanner(VERSION);
      printHelp();
      break;

    case undefined:
      // If no command but has -m flags, treat as chat
      if (args.some(arg => arg === '-m' || arg === '--models')) {
        await handleChat(args);
      } else {
        // Default: interactive mode
        printBanner(VERSION);
        await interactiveCommand();
      }
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error(`Run '${NAME} help' for usage information.`);
      process.exit(1);
  }
}

if ((import.meta as { main?: boolean }).main) {
  main().catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}
