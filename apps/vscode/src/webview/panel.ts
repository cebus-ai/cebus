/**
 * Editor-tab WebviewPanel for Cebus — full-width chat experience.
 *
 * Reuses the same Vite-built React app as the sidebar. Sends
 * `config { viewMode: 'tab' }` so the webview can adapt layout.
 * Shares SessionManager + EventBus with the sidebar provider.
 */

import * as vscode from 'vscode';
import type { EngineBridge } from '../engine/bridge.js';
import type { SessionManager } from '../engine/session-manager.js';
import type { CopilotCliManager } from '../copilot/cli-manager.js';
import type { SessionEventBus } from './event-bus.js';
import type { WebviewMessage, ExtensionMessage } from './protocol.js';
import { handleWebviewMessage, getWebviewHtml } from './shared-handler.js';
import { debugLog } from '../extension.js';

export class CebusWebviewPanel implements vscode.Disposable {
  static readonly viewType = 'cebus.chatTab';

  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private bridge: EngineBridge;
  private sessionManager: SessionManager;
  private copilotManager: CopilotCliManager;
  private eventBus: SessionEventBus;
  private extensionUri: vscode.Uri;

  private onDisposeCallback?: () => void;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    bridge: EngineBridge,
    sessionManager: SessionManager,
    copilotManager: CopilotCliManager,
    eventBus: SessionEventBus
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.bridge = bridge;
    this.sessionManager = sessionManager;
    this.copilotManager = copilotManager;
    this.eventBus = eventBus;

    const resourceRoot = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [resourceRoot, vscode.Uri.joinPath(extensionUri, 'media')],
    };

    panel.webview.html = getWebviewHtml(panel.webview, extensionUri);

    this.disposables.push(
      panel.webview.onDidReceiveMessage((msg: WebviewMessage) => {
        void handleWebviewMessage(msg, {
          postMessage: m => this.postMessage(m),
          bridge: this.bridge,
          sessionManager: this.sessionManager,
          copilotManager: this.copilotManager,
          eventBus: this.eventBus,
          extensionUri: this.extensionUri,
          viewMode: 'tab',
          getWebview: () => panel.webview,
        });
      })
    );

    this.disposables.push(
      this.copilotManager.onStateChange(state => {
        this.postMessage({ type: 'copilotStatus', state });
      })
    );

    this.disposables.push(
      this.eventBus.onEvent(event => {
        if (event.kind === 'conversationDeleted') {
          this.postMessage({ type: 'conversationDeleted', conversationId: event.conversationId });
        }
      })
    );

    panel.onDidDispose(() => this.dispose());
  }

  static create(
    extensionUri: vscode.Uri,
    bridge: EngineBridge,
    sessionManager: SessionManager,
    copilotManager: CopilotCliManager,
    eventBus: SessionEventBus
  ): CebusWebviewPanel {
    debugLog('Creating editor tab panel');
    const panel = vscode.window.createWebviewPanel(
      CebusWebviewPanel.viewType,
      'Cebus Chat',
      vscode.ViewColumn.One,
      {}
    );

    // Set tab icon
    const iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'mascot-64.png');
    panel.iconPath = iconPath;

    return new CebusWebviewPanel(panel, extensionUri, bridge, sessionManager, copilotManager, eventBus);
  }

  onDidDispose(callback: () => void): void {
    this.onDisposeCallback = callback;
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.One);
  }

  private postMessage(msg: ExtensionMessage): void {
    void this.panel.webview.postMessage(msg);
  }

  dispose(): void {
    this.onDisposeCallback?.();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this.panel.dispose();
  }
}
