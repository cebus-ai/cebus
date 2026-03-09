/**
 * VS Code command registrations for Cebus extension.
 */

import * as vscode from 'vscode';
import type { EngineBridge } from './engine/bridge.js';
import type { SecretStore } from './engine/secret-store.js';
import type { CopilotCliManager } from './copilot/cli-manager.js';
import type { SessionManager } from './engine/session-manager.js';
import type { SessionEventBus } from './webview/event-bus.js';
import { CebusWebviewPanel } from './webview/panel.js';
import {
  showModelPicker,
  showChatModePicker,
  showContextLevelPicker,
} from './engine/model-picker.js';

let activeTabPanel: CebusWebviewPanel | undefined;

export function registerCommands(
  context: vscode.ExtensionContext,
  bridge: EngineBridge,
  secretStore: SecretStore,
  copilotManager: CopilotCliManager,
  sessionManager: SessionManager,
  eventBus: SessionEventBus
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('cebus.configureApiKeys', () => {
      void secretStore.promptForApiKeys();
    }),

    vscode.commands.registerCommand('cebus.selectModels', () => {
      void showModelPicker(bridge);
    }),

    vscode.commands.registerCommand('cebus.newSession', () => {
      void vscode.window.showInformationMessage(
        'Use @cebus in the chat panel or open the sidebar to start a new session.'
      );
    }),

    vscode.commands.registerCommand('cebus.setChatMode', () => {
      void (async (): Promise<void> => {
        const mode = await showChatModePicker();
        if (mode !== undefined) {
          const config = vscode.workspace.getConfiguration('cebus');
          await config.update('chatMode', mode, vscode.ConfigurationTarget.Global);
          void vscode.window.showInformationMessage(`Chat mode set to: ${mode}`);
        }
      })();
    }),

    vscode.commands.registerCommand('cebus.openGroupChat', () => {
      void vscode.commands.executeCommand('cebus.groupChat.focus');
    }),

    vscode.commands.registerCommand('cebus.openInTab', () => {
      if (activeTabPanel) {
        activeTabPanel.reveal();
      } else {
        activeTabPanel = CebusWebviewPanel.create(
          context.extensionUri,
          bridge,
          sessionManager,
          copilotManager,
          eventBus
        );
        activeTabPanel.onDidDispose(() => {
          activeTabPanel = undefined;
        });
      }
    }),

    vscode.commands.registerCommand('cebus.copilotStatus', () => {
      const state = copilotManager.getState();
      const port = copilotManager.getPort();
      const discovery = copilotManager.getCliDiscovery();

      const lines = [
        `**Copilot CLI Status**: ${state}`,
        port !== null ? `**Port**: ${port}` : null,
        discovery !== null ? `**Binary**: ${discovery.cliPath} (${discovery.source})` : null,
        discovery !== null ? `**Version**: ${discovery.version}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      void vscode.window.showInformationMessage(lines);
    }),

    vscode.commands.registerCommand('cebus.setContextLevel', () => {
      void (async (): Promise<void> => {
        const level = await showContextLevelPicker();
        if (level !== undefined) {
          const config = vscode.workspace.getConfiguration('cebus');
          await config.update('contextLevel', level, vscode.ConfigurationTarget.Global);
          void vscode.window.showInformationMessage(`Context level set to: ${level}`);
        }
      })();
    }),

    vscode.commands.registerCommand('cebus.approveToolUse', (approvalId: string, approved: boolean) => {
      void bridge.respondToApprovalGlobal(approvalId, approved);
    })
  );
}
