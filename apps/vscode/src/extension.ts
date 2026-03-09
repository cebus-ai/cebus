/**
 * Cebus VS Code Extension — Entry Point
 *
 * Lifecycle:
 *  1. Create CopilotCliManager (reads cebus.copilot.* settings)
 *  2. Create SecretStore (wraps VS Code Secrets API)
 *  3. Create EngineBridge (wraps @cebus/engine)
 *  4. Create SessionManager (conversation persistence)
 *  5. Create SessionEventBus (cross-panel sync)
 *  6. Initialize bridge (starts Copilot server + registers providers)
 *  7. Register Chat Participant (@cebus) with follow-ups and feedback
 *  8. Register WebView Provider (sidebar)
 *  9. Register commands
 * 10. Register IDE actions as LanguageModelTools
 * 11. Register MCP server definition provider
 * 12. Create status bar item
 * 13. Move sidebar to secondary (right) sidebar on first activation
 */

// Polyfill AbortSignal.any for Node < 20.3 (LangChain requires it for signal composition).
// Without this, LangChain falls back to signal.addEventListener which may fail
// on non-standard AbortSignal-like objects in the VS Code extension host.
if (!('any' in AbortSignal)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (AbortSignal as any).any = (signals: AbortSignal[]): AbortSignal => {
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort(signal.reason);
        return controller.signal;
      }
      if (typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
      }
    }
    return controller.signal;
  };
}

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CopilotCliManager } from './copilot/cli-manager.js';
import { SecretStore } from './engine/secret-store.js';
import { EngineBridge } from './engine/bridge.js';
import { SessionManager } from './engine/session-manager.js';
import { SessionEventBus } from './webview/event-bus.js';
import { registerChatParticipant } from './chat/participant.js';
import { CebusWebviewProvider } from './webview/provider.js';
import { registerCommands } from './commands.js';
import { registerIdeTools } from './tools/ide-tools.js';
import { registerMcpServer } from './mcp/cebus-mcp-server.js';

// Debug log file — written to extension's globalStorage
let logFile: string | undefined;
export function debugLog(msg: string): void {
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // ignore
  }
}

let copilotManager: CopilotCliManager | undefined;
let bridge: EngineBridge | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Setup debug log
  const storageDir = context.globalStorageUri.fsPath;
  try { fs.mkdirSync(storageDir, { recursive: true }); } catch { /* */ }
  logFile = path.join(storageDir, 'debug.log');
  try { fs.writeFileSync(logFile, ''); } catch { /* */ }
  debugLog('activate() called');
  debugLog(`extensionUri: ${context.extensionUri.toString()}`);
  debugLog(`extensionPath: ${context.extensionPath}`);

  // 1. Create CopilotCliManager
  copilotManager = new CopilotCliManager();
  context.subscriptions.push(copilotManager);

  // 2. Create SecretStore
  const secretStore = new SecretStore(context);
  context.subscriptions.push(secretStore);

  // 3. Create EngineBridge
  bridge = new EngineBridge(copilotManager, secretStore);
  context.subscriptions.push(bridge);

  // 4. Create SessionManager (workspace root preferred, fallback to globalStorage)
  const storageRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? storageDir;
  const sessionManager = new SessionManager(storageRoot);
  context.subscriptions.push(sessionManager);

  // 5. Create SessionEventBus
  const eventBus = new SessionEventBus();
  context.subscriptions.push(eventBus);

  // 6. Initialize bridge (async — don't block activation)
  bridge.initialize().catch(err => {
    const msg = err instanceof Error ? err.message : String(err);
    debugLog(`bridge.initialize() FAILED: ${msg}`);
    void vscode.window.showErrorMessage(`Cebus initialization failed: ${msg}`);
  });

  // 7. Register Chat Participant
  registerChatParticipant(context, bridge);

  // 8. Register WebView Provider
  debugLog('Registering webview provider...');
  const webviewProvider = new CebusWebviewProvider(
    context.extensionUri, bridge, sessionManager, copilotManager, eventBus
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CebusWebviewProvider.viewType, webviewProvider)
  );
  debugLog('Webview provider registered');

  // 9. Register commands
  registerCommands(context, bridge, secretStore, copilotManager, sessionManager, eventBus);

  // 10. Register IDE actions as LanguageModelTools (feature-detected)
  try {
    registerIdeTools(context);
    debugLog('IDE tools registered as LanguageModelTools');
  } catch {
    debugLog('LanguageModelTools registration not available — skipping');
  }

  // 11. Register MCP server definition provider (feature-detected)
  try {
    registerMcpServer(context);
  } catch {
    debugLog('MCP server registration not available — skipping');
  }

  // 12. Create status bar item — Cebus icon that opens the chat editor tab
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'cebus.openInTab';
  statusBarItem.text = '$(comment-discussion) Cebus';
  statusBarItem.tooltip = 'Open Cebus Chat in Editor Tab';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // 13. Move sidebar to secondary (right) sidebar on first activation
  const movedKey = 'cebus.movedToSecondary.v2';
  if (!context.globalState.get(movedKey)) {
    setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          await vscode.commands.executeCommand('cebus.groupChat.focus');
          await vscode.commands.executeCommand('workbench.action.moveViewToSecondarySideBar');
          debugLog('Moved Cebus view to secondary sidebar');
        } catch {
          debugLog('Could not move view to secondary sidebar');
        }
        await context.globalState.update(movedKey, true);
      })();
    }, 2000);
  }

  debugLog('activate() complete');
}

export function deactivate(): void {
  // Disposal happens via context.subscriptions in reverse order
  // CopilotCliManager.dispose() stops server + releases lockfile
  // EngineBridge.dispose() clears sessions
  bridge = undefined;
  copilotManager = undefined;
}
