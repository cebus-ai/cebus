/**
 * WebviewViewProvider for the Cebus sidebar panel.
 *
 * Loads the Vite-built React app and delegates all message handling
 * to shared-handler.ts (shared with the editor tab panel).
 */

import * as vscode from 'vscode';
import type { EngineBridge } from '../engine/bridge.js';
import type { SessionManager } from '../engine/session-manager.js';
import type { CopilotCliManager } from '../copilot/cli-manager.js';
import type { SessionEventBus } from './event-bus.js';
import type { WebviewMessage, ExtensionMessage } from './protocol.js';
import { handleWebviewMessage, getWebviewHtml } from './shared-handler.js';
import { debugLog } from '../extension.js';

export class CebusWebviewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'cebus.groupChat';

  private webviewView?: vscode.WebviewView;
  private bridge: EngineBridge;
  private sessionManager: SessionManager;
  private copilotManager: CopilotCliManager;
  private eventBus: SessionEventBus;
  private extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  constructor(
    extensionUri: vscode.Uri,
    bridge: EngineBridge,
    sessionManager: SessionManager,
    copilotManager: CopilotCliManager,
    eventBus: SessionEventBus
  ) {
    this.extensionUri = extensionUri;
    this.bridge = bridge;
    this.sessionManager = sessionManager;
    this.copilotManager = copilotManager;
    this.eventBus = eventBus;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    debugLog('resolveWebviewView() called');
    this.webviewView = webviewView;

    const resourceRoot = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
    debugLog(`localResourceRoots: ${resourceRoot.toString()}, ${mediaRoot.toString()}`);

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [resourceRoot, mediaRoot],
    };

    webviewView.webview.html = getWebviewHtml(webviewView.webview, this.extensionUri);

    // Clean up previous disposables before registering new ones
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];

    // Handle messages from WebView
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
        void handleWebviewMessage(msg, {
          postMessage: m => this.postMessage(m),
          bridge: this.bridge,
          sessionManager: this.sessionManager,
          copilotManager: this.copilotManager,
          eventBus: this.eventBus,
          extensionUri: this.extensionUri,
          viewMode: 'sidebar',
          getWebview: () => webviewView.webview,
        });
      })
    );

    // Forward Copilot status changes to WebView
    this.disposables.push(
      this.copilotManager.onStateChange(state => {
        this.postMessage({ type: 'copilotStatus', state });
      })
    );

    // Sync conversation deletions from other panels
    this.disposables.push(
      this.eventBus.onEvent(event => {
        if (event.kind === 'conversationDeleted') {
          this.postMessage({ type: 'conversationDeleted', conversationId: event.conversationId });
        }
      })
    );

    webviewView.onDidDispose(() => {
      for (const d of this.disposables) {
        d.dispose();
      }
      this.disposables = [];
    });
  }

  private postMessage(msg: ExtensionMessage): void {
    void this.webviewView?.webview.postMessage(msg);
  }
}
