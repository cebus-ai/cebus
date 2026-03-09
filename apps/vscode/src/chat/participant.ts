/**
 * VS Code Chat Participant registration for @cebus.
 *
 * Handles chat requests by routing through the engine bridge,
 * with slash commands for /models, /mode, and /context.
 * Includes follow-up suggestions, result metadata, and user feedback.
 */

import * as vscode from 'vscode';
import type { EngineBridge } from '../engine/bridge.js';
import type { ChatMode, ContextLevel } from '@cebus/engine';
import {
  showModelPicker,
  showChatModePicker,
  showContextLevelPicker,
} from '../engine/model-picker.js';
import { gatherWorkspaceContext, formatWorkspaceContext } from '../engine/workspace-context.js';
import { StreamRenderer } from './renderer.js';
import { debugLog } from '../extension.js';

interface CebusChatResultMetadata {
  sessionId: string | null;
  chatMode: string;
  respondingModels: string[];
  hasMultipleResponses: boolean;
}

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  bridge: EngineBridge
): vscode.Disposable {
  let activeSessionId: string | null = null;

  const participant = vscode.chat.createChatParticipant(
    'cebus.chat',
    async (
      request: vscode.ChatRequest,
      chatContext: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> => {
      // Recover session from previous turn metadata
      if (activeSessionId === null && chatContext.history.length > 0) {
        for (let i = chatContext.history.length - 1; i >= 0; i--) {
          const turn = chatContext.history[i];
          if (turn instanceof vscode.ChatResponseTurn) {
            const meta = turn.result?.metadata as CebusChatResultMetadata | undefined;
            if (meta?.sessionId) {
              activeSessionId = meta.sessionId;
              break;
            }
          }
        }
      }

      // Handle slash commands
      if (request.command === 'models') {
        const models = await showModelPicker(bridge);
        if (models !== undefined) {
          const config = vscode.workspace.getConfiguration('cebus');
          await config.update(
            'defaultModels',
            models.map(m => `${m.providerId}/${m.modelId}`),
            vscode.ConfigurationTarget.Global
          );
          stream.markdown(`Updated default models: ${models.map(m => m.displayName).join(', ')}`);
          activeSessionId = null;
        } else {
          stream.markdown('Model selection cancelled.');
        }
        return { metadata: { sessionId: null, chatMode: '', respondingModels: [], hasMultipleResponses: false } };
      }

      if (request.command === 'mode') {
        const mode = await showChatModePicker();
        if (mode !== undefined) {
          const config = vscode.workspace.getConfiguration('cebus');
          await config.update('chatMode', mode, vscode.ConfigurationTarget.Global);
          stream.markdown(`Chat mode set to: **${mode}**`);
          activeSessionId = null;
        } else {
          stream.markdown('Mode selection cancelled.');
        }
        return { metadata: { sessionId: null, chatMode: '', respondingModels: [], hasMultipleResponses: false } };
      }

      if (request.command === 'context') {
        const level = await showContextLevelPicker();
        if (level !== undefined) {
          const config = vscode.workspace.getConfiguration('cebus');
          await config.update('contextLevel', level, vscode.ConfigurationTarget.Global);
          stream.markdown(`Context level set to: **${level}**`);
          activeSessionId = null;
        } else {
          stream.markdown('Context level selection cancelled.');
        }
        return { metadata: { sessionId: null, chatMode: '', respondingModels: [], hasMultipleResponses: false } };
      }

      // Lazy-init session from settings
      const config = vscode.workspace.getConfiguration('cebus');
      const chatMode = config.get<ChatMode>('chatMode', 'free_chat');

      if (activeSessionId === null) {
        const defaultModels = config.get<string[]>('defaultModels', []);

        if (defaultModels.length === 0) {
          const models = await showModelPicker(bridge);
          if (models === undefined || models.length === 0) {
            stream.markdown('No models selected. Use `/models` to choose models.');
            return { metadata: { sessionId: null, chatMode, respondingModels: [], hasMultipleResponses: false } };
          }
          await config.update(
            'defaultModels',
            models.map(m => `${m.providerId}/${m.modelId}`),
            vscode.ConfigurationTarget.Global
          );
          defaultModels.push(...models.map(m => `${m.providerId}/${m.modelId}`));
        }

        const contextLevel = config.get<ContextLevel>('contextLevel', 'minimal');

        const modelSelections = defaultModels.map(spec => {
          const slashIdx = spec.indexOf('/');
          return {
            providerId: spec.slice(0, slashIdx),
            modelId: spec.slice(slashIdx + 1),
            displayName: spec.slice(slashIdx + 1),
          };
        });

        try {
          activeSessionId = await bridge.createSession({
            models: modelSelections,
            chatMode,
            contextLevel,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          stream.markdown(`Failed to create session: ${msg}`);
          return { metadata: { sessionId: null, chatMode, respondingModels: [], hasMultipleResponses: false } };
        }
      }

      // Build message with workspace context
      const wsContext = gatherWorkspaceContext();
      const contextStr = formatWorkspaceContext(wsContext);
      const fullMessage =
        contextStr.length > 0
          ? `${request.prompt}\n\n---\n**Workspace context:**\n${contextStr}`
          : request.prompt;

      // Build agent name map for renderer
      const participants = bridge.getSessionParticipants(activeSessionId);
      const agentNames = new Map(participants.map(p => [p.id, p.displayName]));

      const renderer = new StreamRenderer(stream, agentNames);

      // Handle cancellation
      token.onCancellationRequested(() => {
        if (activeSessionId !== null) {
          bridge.cancelAll(activeSessionId);
        }
      });

      // Stream the response
      const respondingModels: string[] = [];
      try {
        for await (const event of bridge.sendMessage(activeSessionId, fullMessage)) {
          if (token.isCancellationRequested) break;
          renderer.handleEvent(event);

          if (event.type === 'complete') {
            const name = agentNames.get(event.agentId) ?? event.agentId;
            if (!respondingModels.includes(name)) {
              respondingModels.push(name);
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stream.markdown(`\n\nError: ${msg}`);
      }

      return {
        metadata: {
          sessionId: activeSessionId,
          chatMode,
          respondingModels,
          hasMultipleResponses: respondingModels.length > 1,
        } satisfies CebusChatResultMetadata,
      };
    }
  );

  participant.iconPath = new vscode.ThemeIcon('comment-discussion');

  // Follow-up suggestions
  participant.followupProvider = {
    provideFollowups(
      result: vscode.ChatResult,
      _context: vscode.ChatContext,
      _token: vscode.CancellationToken
    ): vscode.ChatFollowup[] {
      const meta = result.metadata as CebusChatResultMetadata | undefined;
      const followups: vscode.ChatFollowup[] = [];

      if (meta?.hasMultipleResponses) {
        followups.push({
          prompt: 'Compare these responses and highlight the key differences',
          label: '$(diff) Compare responses',
        });
        followups.push({
          prompt: 'Which response is most accurate and why?',
          label: '$(star) Evaluate quality',
        });
      }

      if (meta?.respondingModels && meta.respondingModels.length > 0) {
        followups.push({
          prompt: 'Continue the discussion with a follow-up question',
          label: '$(comment) Continue discussion',
        });
      }

      followups.push({
        prompt: '/models',
        label: '$(settings-gear) Change models',
        command: 'models',
      });

      return followups;
    },
  };

  // User feedback telemetry
  participant.onDidReceiveFeedback((feedback: vscode.ChatResultFeedback) => {
    const meta = feedback.result.metadata as CebusChatResultMetadata | undefined;
    const kind = feedback.kind === vscode.ChatResultFeedbackKind.Helpful ? 'helpful' : 'unhelpful';
    debugLog(`Chat feedback: ${kind}, mode=${meta?.chatMode ?? 'unknown'}, models=${meta?.respondingModels?.join(',') ?? 'none'}`);
  });

  context.subscriptions.push(participant);
  return participant;
}
