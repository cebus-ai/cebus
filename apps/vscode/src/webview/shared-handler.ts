/**
 * Shared message handling logic for both sidebar and editor tab webviews.
 *
 * Both CebusWebviewProvider and CebusWebviewPanel delegate to these functions
 * so the protocol handling stays DRY.
 */

import * as vscode from 'vscode';
import type { ChatMode } from '@cebus/engine';
import type { EngineBridge } from '../engine/bridge.js';
import { SessionManager } from '../engine/session-manager.js';
import type { PersistedConversation, PersistedMessage } from '../engine/session-manager.js';
import type { CopilotCliManager } from '../copilot/cli-manager.js';
import type { SessionEventBus } from './event-bus.js';
import type { WebviewMessage, ExtensionMessage } from './protocol.js';
import {
  readFileForContext,
  readActiveEditorContext,
  formatAttachmentsForEngine,
  toMeta,
  type FileAttachment,
} from '../engine/file-context.js';
import { executeIdeAction } from '../engine/ide-actions.js';

export interface WebviewHost {
  postMessage: (msg: ExtensionMessage) => void;
  bridge: EngineBridge;
  sessionManager: SessionManager;
  copilotManager: CopilotCliManager;
  eventBus: SessionEventBus;
  extensionUri: vscode.Uri;
  viewMode: 'sidebar' | 'tab';
  getWebview: () => vscode.Webview;
}

// Track active conversation per webview session
const activeConversations = new Map<string, string>(); // sessionId → conversationId

export async function handleWebviewMessage(msg: WebviewMessage, host: WebviewHost): Promise<void> {
  switch (msg.type) {
    case 'ready': {
      host.postMessage({
        type: 'copilotStatus',
        state: host.copilotManager.getState(),
      });
      const mascotUri = getMascotUri(host.getWebview(), host.extensionUri);
      host.postMessage({
        type: 'config',
        viewMode: host.viewMode,
        mascotUri,
      });
      break;
    }

    case 'getModels': {
      try {
        const modelsPromise = host.bridge.getAvailableModels();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Model discovery timed out. Check API key configuration.')), 15_000)
        );
        const models = await Promise.race([modelsPromise, timeoutPromise]);
        host.postMessage({ type: 'models', available: models });
      } catch (err) {
        host.postMessage({ type: 'models', available: [] });
        host.postMessage({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case 'createSession': {
      try {
        const sessionId = await host.bridge.createSession({
          models: msg.models,
          chatMode: msg.chatMode as ChatMode,
        });
        const participants = host.bridge.getSessionParticipants(sessionId);

        // Create persisted conversation
        const convId = host.sessionManager.generateId();
        const conversation: PersistedConversation = {
          id: convId,
          title: 'New Conversation',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          chatMode: msg.chatMode as ChatMode,
          contextLevel: 'minimal',
          models: msg.models,
          messages: [],
        };
        await host.sessionManager.save(conversation);
        activeConversations.set(sessionId, convId);

        host.eventBus.fire({ kind: 'conversationCreated', conversationId: convId, title: conversation.title });

        host.postMessage({
          type: 'sessionCreated',
          sessionId,
          participants,
          conversationId: convId,
        });
      } catch (err) {
        host.postMessage({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case 'sendMessage': {
      const convId = activeConversations.get(msg.sessionId);
      try {
        // Format file attachments into message content
        let content = msg.content;
        if (msg.attachments && msg.attachments.length > 0) {
          const attachments: FileAttachment[] = [];
          for (const meta of msg.attachments) {
            try {
              const fileUri = vscode.Uri.parse(meta.uri);
              const attachment = await readFileForContext(fileUri);
              attachments.push(attachment);
            } catch {
              // Skip unreadable files
            }
          }
          if (attachments.length > 0) {
            content = formatAttachmentsForEngine(attachments) + content;
          }
        }

        // Persist user message
        if (convId) {
          const conv = await host.sessionManager.load(convId);
          if (conv) {
            const userMsg: PersistedMessage = {
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              agentId: 'user',
              displayName: 'You',
              content: msg.content,
              senderType: 'user',
              timestamp: Date.now(),
            };
            conv.messages.push(userMsg);
            if (conv.title === 'New Conversation') {
              conv.title = SessionManager.titleFromMessage(msg.content);
            }
            conv.updatedAt = Date.now();
            await host.sessionManager.save(conv);
            host.eventBus.fire({ kind: 'messageAdded', conversationId: convId });
          }
        }

        // Collect agent responses to persist after streaming
        const agentResponses: PersistedMessage[] = [];

        for await (const event of host.bridge.sendMessage(msg.sessionId, content)) {
          host.postMessage({ type: 'streamEvent', event });

          if (event.type === 'complete' && event.content) {
            const participants = host.bridge.getSessionParticipants(msg.sessionId);
            const participant = participants.find(p => p.id === event.agentId);
            agentResponses.push({
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              agentId: event.agentId,
              displayName: participant?.displayName ?? event.agentId,
              content: event.content,
              senderType: 'agent',
              timestamp: Date.now(),
              providerId: participant?.providerId,
              modelId: participant?.modelId,
            });
          }
        }

        // Persist agent responses
        if (convId && agentResponses.length > 0) {
          const conv = await host.sessionManager.load(convId);
          if (conv) {
            conv.messages.push(...agentResponses);
            conv.updatedAt = Date.now();
            await host.sessionManager.save(conv);
            host.eventBus.fire({ kind: 'messageAdded', conversationId: convId });
          }
        }
      } catch (err) {
        host.postMessage({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        // Always send streamEnd so the webview exits streaming state,
        // even after cancellation or errors.
        host.postMessage({ type: 'streamEnd', sessionId: msg.sessionId });
      }
      break;
    }

    case 'cancelAll': {
      host.bridge.cancelAll(msg.sessionId);
      break;
    }

    case 'resolveApproval': {
      try {
        await host.bridge.respondToApprovalGlobal(msg.approvalId, msg.approved, msg.budget);
      } catch {
        // Approval may have expired
      }
      break;
    }

    case 'resetSession': {
      activeConversations.delete(msg.sessionId);
      host.bridge.deleteSession(msg.sessionId);
      host.postMessage({ type: 'sessionReset' });
      break;
    }

    case 'listConversations': {
      try {
        const conversations = await host.sessionManager.list();
        host.postMessage({ type: 'conversationList', conversations });
      } catch (err) {
        host.postMessage({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case 'loadConversation': {
      try {
        const conv = await host.sessionManager.load(msg.conversationId);
        if (!conv) {
          host.postMessage({ type: 'error', message: 'Conversation not found' });
          break;
        }

        // Create a new engine session from the persisted conversation
        const sessionId = await host.bridge.createSession({
          models: conv.models,
          chatMode: conv.chatMode as ChatMode,
        });
        activeConversations.set(sessionId, conv.id);

        const participants = host.bridge.getSessionParticipants(sessionId);

        // Rebuild conversation history in the engine
        host.bridge.restoreHistory(sessionId, conv.messages.map(m => ({
          role: m.senderType === 'user' ? 'user' as const : 'assistant' as const,
          content: m.content,
          ...(m.senderType === 'agent' ? { name: m.agentId } : {}),
        })));

        host.postMessage({
          type: 'conversationLoaded',
          conversation: {
            id: conv.id,
            sessionId,
            title: conv.title,
            chatMode: conv.chatMode,
            models: conv.models,
            messages: conv.messages,
            participants,
          },
        });

        host.eventBus.fire({ kind: 'activeChanged', conversationId: conv.id });
      } catch (err) {
        host.postMessage({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case 'deleteConversation': {
      try {
        await host.sessionManager.delete(msg.conversationId);
        host.postMessage({ type: 'conversationDeleted', conversationId: msg.conversationId });
        host.eventBus.fire({ kind: 'conversationDeleted', conversationId: msg.conversationId });
      } catch (err) {
        host.postMessage({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case 'requestFilePicker': {
      try {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'Attach File',
          filters: { 'All Files': ['*'] },
        });
        if (uris && uris[0]) {
          const attachment = await readFileForContext(uris[0]);
          host.postMessage({ type: 'fileAttached', attachment: toMeta(attachment) });
        }
      } catch (err) {
        host.postMessage({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case 'attachActiveFile': {
      const attachment = readActiveEditorContext();
      if (attachment) {
        host.postMessage({ type: 'fileAttached', attachment: toMeta(attachment) });
      } else {
        host.postMessage({ type: 'error', message: 'No active editor to attach' });
      }
      break;
    }

    case 'openInTab': {
      void vscode.commands.executeCommand('cebus.openInTab');
      break;
    }

    case 'ideAction': {
      try {
        const result = await executeIdeAction(msg.action, msg.params);
        host.postMessage({
          type: 'ideActionResult',
          action: msg.action,
          success: result.success,
          ...(result.data !== undefined ? { data: result.data } : {}),
          ...(result.error !== undefined ? { error: result.error } : {}),
        });
      } catch (err) {
        host.postMessage({
          type: 'ideActionResult',
          action: msg.action,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case 'attachByUri': {
      try {
        const fileUri = vscode.Uri.parse(msg.uri);
        const attachment = await readFileForContext(fileUri);
        host.postMessage({ type: 'fileAttached', attachment: toMeta(attachment) });
      } catch (err) {
        host.postMessage({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case 'attachSelection': {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        host.postMessage({ type: 'error', message: 'No active selection in editor' });
        break;
      }
      const attachment = readActiveEditorContext();
      if (attachment) {
        host.postMessage({ type: 'fileAttached', attachment: toMeta(attachment) });
      }
      break;
    }

    case 'pasteImage': {
      try {
        // Save base64 data URL to a temp file, then attach as image
        const base64Match = /^data:image\/(\w+);base64,(.+)$/.exec(msg.dataUrl);
        if (!base64Match) {
          host.postMessage({ type: 'error', message: 'Invalid image data' });
          break;
        }
        const ext = base64Match[1];
        const data = Buffer.from(base64Match[2]!, 'base64');
        const tmpDir = vscode.Uri.joinPath(host.extensionUri, '.cebus-tmp');
        await vscode.workspace.fs.createDirectory(tmpDir);
        const fileName = msg.fileName || `paste-${Date.now()}.${ext}`;
        const tmpFile = vscode.Uri.joinPath(tmpDir, fileName);
        await vscode.workspace.fs.writeFile(tmpFile, data);
        host.postMessage({
          type: 'fileAttached',
          attachment: {
            uri: tmpFile.toString(),
            fileName,
            language: 'image',
            lineCount: 0,
            isImage: true,
          },
        });
      } catch (err) {
        host.postMessage({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }
  }
}

export function getMascotUri(webview: vscode.Webview, extensionUri: vscode.Uri): string | null {
  try {
    const mascotPath = vscode.Uri.joinPath(extensionUri, 'media', 'mascot-64.png');
    return webview.asWebviewUri(mascotPath).toString();
  } catch {
    return null;
  }
}

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const jsPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'index.js');
  const cssPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'index.css');

  const scriptUri = webview.asWebviewUri(jsPath);
  const styleUri = webview.asWebviewUri(cssPath);

  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en" style="height:100%">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}' ${webview.cspSource};
             img-src ${webview.cspSource} data:;
             font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>Cebus Group Chat</title>
</head>
<body style="height:100%;margin:0">
  <div id="root" style="height:100%"></div>
  <script nonce="${nonce}">
    window.onerror = function(msg, src, line, col, err) {
      document.getElementById('root').innerHTML =
        '<pre style="color:#f48771;padding:8px;font-size:12px;white-space:pre-wrap">'
        + msg + '\\n' + (src || '') + ':' + line + ':' + col
        + '\\n' + (err && err.stack ? err.stack : '') + '</pre>';
    };
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
