/**
 * Singleton lifecycle manager for Copilot CLI availability.
 *
 * With the ACP shim, each engine consumer (CopilotAdapter, CopilotWorker)
 * spawns its own CLI process on demand. This manager just:
 *   1. Discovers the CLI binary
 *   2. Shows status bar indicator
 *   3. Validates the CLI is available
 *
 * The engine picks up `CEBUS_COPILOT_CLI_PATH` (or legacy `CEBUS_COPILOT_CLI_URL`)
 * as a CLI path override if set; otherwise
 * the ACP shim resolves the bundled CLI from dist/node_modules/@github/copilot/.
 */

import * as vscode from 'vscode';
import { discoverCopilotCli, type CliDiscoveryResult } from './cli-discovery.js';

export type CopilotServerState = 'stopped' | 'starting' | 'running' | 'adopted' | 'error';

export class CopilotCliManager implements vscode.Disposable {
  private state: CopilotServerState = 'stopped';
  private cliDiscovery: CliDiscoveryResult | null = null;
  private statusBarItem: vscode.StatusBarItem;

  private readonly onStateChangeEmitter = new vscode.EventEmitter<CopilotServerState>();
  readonly onStateChange = this.onStateChangeEmitter.event;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.statusBarItem.command = 'cebus.copilotStatus';
    this.updateStatusBar();
  }

  getState(): CopilotServerState {
    return this.state;
  }

  getPort(): number | null {
    return null;
  }

  getCliDiscovery(): CliDiscoveryResult | null {
    return this.cliDiscovery;
  }

  async start(): Promise<void> {
    const config = vscode.workspace.getConfiguration('cebus.copilot');
    if (!config.get<boolean>('autoStart', true)) {
      return;
    }

    this.setState('starting');

    // Discover CLI binary (for status display and validation)
    this.cliDiscovery = await discoverCopilotCli();
    if (!this.cliDiscovery) {
      // CLI not found on PATH — the bundled CLI in dist/node_modules/@github/copilot/
      // may still work (the ACP shim resolves it). Show a softer status.
      this.setState('running');
      return;
    }

    // CLI found — mark as available
    this.setState('running');
  }

  async stop(): Promise<void> {
    this.setState('stopped');
  }

  dispose(): void {
    void this.stop();
    this.statusBarItem.dispose();
    this.onStateChangeEmitter.dispose();
  }

  private setState(state: CopilotServerState): void {
    this.state = state;
    this.updateStatusBar();
    this.onStateChangeEmitter.fire(state);
  }

  private updateStatusBar(): void {
    switch (this.state) {
      case 'running':
        this.statusBarItem.text = '$(check) Copilot CLI';
        this.statusBarItem.tooltip = this.cliDiscovery
          ? `Copilot CLI available (${this.cliDiscovery.source}: ${this.cliDiscovery.version})`
          : 'Copilot CLI available (bundled)';
        this.statusBarItem.show();
        break;
      case 'adopted':
        this.statusBarItem.text = '$(link) Copilot CLI';
        this.statusBarItem.tooltip = 'Copilot CLI available';
        this.statusBarItem.show();
        break;
      case 'starting':
        this.statusBarItem.text = '$(sync~spin) Copilot CLI';
        this.statusBarItem.tooltip = 'Checking Copilot CLI...';
        this.statusBarItem.show();
        break;
      case 'error':
        this.statusBarItem.text = '$(error) Copilot CLI';
        this.statusBarItem.tooltip = 'Copilot CLI not available';
        this.statusBarItem.show();
        break;
      case 'stopped':
        this.statusBarItem.hide();
        break;
    }
  }
}
