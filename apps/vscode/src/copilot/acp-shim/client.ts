/**
 * ACP protocol shim for @github/copilot-sdk.
 *
 * Provides a CopilotClient API-compatible class that spawns the Copilot CLI
 * with `--acp` and communicates over the ACP (Agent Client Protocol)
 * via stdin/stdout JSON-RPC instead of the `--headless` protocol.
 *
 * The engine code (`copilot.ts`, `copilot-worker.ts`) does
 *   `await import('@github/copilot-sdk')`
 * and gets this shim instead — working unchanged.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from 'vscode-jsonrpc/node';
import { AcpSession, type AcpSessionConfig } from './session.js';

interface AcpModelInfo {
  id: string;
  name: string;
  capabilities: {
    supports: { vision: boolean; reasoningEffort: boolean };
    limits: {
      max_prompt_tokens?: number;
      max_context_window_tokens: number;
      max_output_tokens?: number;
    };
  };
  billing?: { multiplier?: number };
  policy?: { state: string };
}

interface CopilotClientOptions {
  clientName?: string;
  cliPath?: string;
  cliArgs?: string[];
  cliUrl?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  useStdio?: boolean;
  port?: number;
}

export class CopilotClient {
  private process: ChildProcess | null = null;
  private connection: MessageConnection | null = null;
  private models: AcpModelInfo[] = [];
  private started = false;
  private cwd: string;
  private env: Record<string, string | undefined>;
  private clientName: string;
  private cliPath: string | undefined;
  private cliArgs: string[];
  private legacyCliUrl: string | undefined;

  /** Exposed for the legacy cli-manager port-check pattern */
  port = 0;

  rpc = {
    account: {
      getQuota: (): Promise<null> => Promise.resolve(null),
    },
  };

  constructor(options: CopilotClientOptions = {}) {
    this.clientName = options.clientName ?? 'cebus';
    this.cwd = options.cwd ?? process.cwd();
    this.env = options.env ?? (process.env as Record<string, string | undefined>);
    this.cliPath = options.cliPath;
    this.cliArgs = options.cliArgs ?? [];
    this.legacyCliUrl = options.cliUrl;
  }

  async start(): Promise<void> {
    if (this.started) return;

    const cliPath = this.resolveCliPath();
    if (!cliPath) {
      throw new Error('Copilot CLI not found. Install it with: npm install -g @github/copilot-cli');
    }

    // Build a clean environment — strip NODE_OPTIONS and inspector flags
    // that VS Code extension host injects, which would cause the CLI to hang.
    const cleanEnv: Record<string, string | undefined> = { ...this.env };
    cleanEnv['NODE_OPTIONS'] = '--no-warnings';
    delete cleanEnv['NODE_INSPECT'];
    delete cleanEnv['NODE_INSPECT_RESUME_ON_START'];

    // Spawn: node <cli-path> [cliArgs...] --acp
    // The --acp flag already implies stdio-based JSON-RPC communication.
    const spawnArgs = [cliPath, ...this.cliArgs, '--acp'];
    this.process = spawn(process.execPath, spawnArgs, {
      cwd: this.cwd,
      env: cleanEnv as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    // Collect stderr for diagnostics (don't let it buffer indefinitely)
    let stderrChunks: string[] = [];
    this.process.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
      if (stderrChunks.length > 50) stderrChunks = stderrChunks.slice(-20);
    });

    // Track early exit — if the CLI crashes before handshake completes
    let earlyExit = false;
    let earlyExitCode: number | null = null;
    this.process.on('exit', (code) => {
      if (!this.started) {
        earlyExit = true;
        earlyExitCode = code;
      }
    });

    this.process.on('error', err => {
      throw new Error(`Copilot CLI process error: ${err.message}`);
    });

    // Setup JSON-RPC connection over stdin/stdout
    const reader = new StreamMessageReader(this.process.stdout!);
    const writer = new StreamMessageWriter(this.process.stdin!);
    this.connection = createMessageConnection(reader, writer);
    this.connection.listen();

    const STEP_TIMEOUT = 15_000;
    const getStderrContext = (): string => {
      const stderr = stderrChunks.join('').trim();
      const exitInfo = earlyExit ? ` (CLI exited with code ${earlyExitCode})` : '';
      return stderr ? `\nstderr: ${stderr}${exitInfo}` : exitInfo;
    };

    const sendWithTimeout = async <T>(method: string, params: object): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          this.connection!.sendRequest<T>(method, params),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`ACP ${method} timed out after ${STEP_TIMEOUT / 1000}s${getStderrContext()}`)),
              STEP_TIMEOUT
            );
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    };

    // Step 1: Initialize (ACP handshake)
    try {
      await sendWithTimeout('initialize', {
        protocolVersion: 1,
        clientName: this.clientName,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`ACP initialize failed: ${msg}${getStderrContext()}`);
    }

    // Step 2: Authenticate
    try {
      await sendWithTimeout('authenticate', { methodId: 'copilot-login' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('auth') || msg.includes('401') || msg.includes('Authentication')) {
        throw new Error(
          `Copilot authentication failed: ${msg}. Run 'gh auth login' to authenticate.`
        );
      }
      throw new Error(`ACP authenticate failed: ${msg}`);
    }

    // Step 3: Create an initial session to discover models
    try {
      const result = await sendWithTimeout<{
        sessionId: string;
        models: AcpModelInfo[];
      }>('session/new', { cwd: this.cwd, mcpServers: [] });
      this.models = result.models ?? [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`ACP session/new failed: ${msg}`);
    }

    this.started = true;
  }

  async stop(): Promise<void> {
    if (this.connection) {
      this.connection.end();
      this.connection.dispose();
      this.connection = null;
    }
    if (this.process) {
      this.process.kill('SIGTERM');
      // Give it a moment to exit gracefully
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => {
          this.process?.kill('SIGKILL');
          resolve();
        }, 3000);
        this.process?.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      this.process = null;
    }
    this.started = false;
  }

  forceStop(): void {
    if (this.connection) {
      try {
        this.connection.end();
        this.connection.dispose();
      } catch {
        // ignore
      }
      this.connection = null;
    }
    if (this.process) {
      this.process.kill('SIGKILL');
      this.process = null;
    }
    this.started = false;
  }

  async listModels(): Promise<AcpModelInfo[]> {
    return this.models;
  }

  getState(): string {
    if (!this.started) return 'stopped';
    if (this.connection === null) return 'disconnected';
    return 'running';
  }

  getStatus(): { state: string; models: number } {
    return { state: this.getState(), models: this.models.length };
  }

  getAuthStatus(): { authenticated: boolean } {
    return { authenticated: this.started };
  }

  async createSession(config: AcpSessionConfig): Promise<AcpSession> {
    if (!this.connection) {
      throw new Error('CopilotClient not started. Call start() first.');
    }

    // Create a new ACP session for this config
    const result = await this.connection.sendRequest<{
      sessionId: string;
      models?: AcpModelInfo[];
    }>('session/new', { cwd: this.cwd, mcpServers: config.mcpServers ?? [] });

    // Update model cache if we get fresh data
    if (result.models && result.models.length > 0) {
      this.models = result.models;
    }

    return new AcpSession(this.connection, result.sessionId, config);
  }

  async resumeSession(sessionId: string): Promise<AcpSession> {
    if (!this.connection) {
      throw new Error('CopilotClient not started. Call start() first.');
    }

    try {
      await this.connection.sendRequest('session/load', { sessionId });
      return new AcpSession(this.connection, sessionId, {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to resume session ${sessionId}: ${msg}`);
    }
  }

  async listSessions(_filter?: {
    cwd?: string;
    gitRoot?: string;
    branch?: string;
  }): Promise<never[]> {
    return [];
  }

  async deleteSession(_sessionId: string): Promise<boolean> {
    return false;
  }

  private resolveCliPath(): string | null {
    // 0. Explicit SDK override.
    if (this.cliPath !== undefined && this.cliPath.length > 0) {
      try {
        if (fs.existsSync(this.cliPath)) return this.cliPath;
      } catch {
        // ignore
      }
    }

    // 0b. Legacy compatibility: older code passed path overrides via cliUrl.
    if (this.legacyCliUrl !== undefined && this.legacyCliUrl.length > 0) {
      try {
        if (fs.existsSync(this.legacyCliUrl)) return this.legacyCliUrl;
      } catch {
        // ignore
      }
    }

    // 1. Bundled sibling package in extension dist:
    //    dist/node_modules/@github/copilot-sdk -> dist/node_modules/@github/copilot
    const bundledCandidates = [
      path.resolve(__dirname, '..', 'copilot', 'index.js'),
      path.resolve(__dirname, '..', 'copilot', 'npm-loader.js'),
    ];

    for (const candidate of bundledCandidates) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        // ignore
      }
    }

    // 2. Monorepo/node_modules fallback (development)
    try {
      const monoCandidate = path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        'node_modules',
        '@github',
        'copilot',
        'index.js'
      );
      if (fs.existsSync(monoCandidate)) return monoCandidate;

      const monoLoaderCandidate = path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        'node_modules',
        '@github',
        'copilot',
        'npm-loader.js'
      );
      if (fs.existsSync(monoLoaderCandidate)) return monoLoaderCandidate;
    } catch {
      // ignore
    }

    return null;
  }
}
