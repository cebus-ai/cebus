import type React from 'react';
import { useCallback } from 'react';
import { existsSync } from 'fs';
import { resolve } from 'path';
import type { Participant, ContextLevel, Message, Attachment } from '@cebus/engine';
import {
  getParticipants,
  addModelParticipant,
  removeParticipant,
  renameParticipant,
  setContextLevel,
  markContextStale,
  getContextConfig,
  invalidateGraph,
  setReasoningEffort,
  clearMessages,
  clearThread,
  resetChatTranscript,
} from '@cebus/engine';
import type { StaticEntry } from '../chat-types';
import { clearScreen } from '../ui';

interface UseCommandsParams {
  sessionId: string;
  participants: Participant[];
  handleExit: () => void;
  setCurrentView: React.Dispatch<React.SetStateAction<'chat' | 'help' | 'participants'>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setParticipants: React.Dispatch<React.SetStateAction<Participant[]>>;
  setStaticEntries: React.Dispatch<React.SetStateAction<StaticEntry[]>>;
  staticIds: React.MutableRefObject<Set<string>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setContextLevelState: React.Dispatch<React.SetStateAction<ContextLevel>>;
  threadIdRef: React.MutableRefObject<string | undefined>;
  addAttachment: (attachment: string | Attachment) => void;
  clearAttachments: () => void;
  pendingAttachments: Array<string | Attachment>;
}

/**
 * Returns a handleCommand callback for slash commands (/help, /add, /remove, etc.).
 */
export function useCommands({
  sessionId,
  participants,
  handleExit,
  setCurrentView,
  setMessages,
  setParticipants,
  setStaticEntries,
  staticIds,
  setError,
  setContextLevelState,
  threadIdRef,
  addAttachment,
  clearAttachments,
  pendingAttachments,
}: UseCommandsParams): (command: string, args: string[]) => void {
  return useCallback(
    (command: string, args: string[]) => {
      switch (command.toLowerCase()) {
        case 'help':
          setCurrentView('help');
          break;

        case 'exit':
        case 'quit':
          handleExit();
          break;

        case 'clear':
          clearMessages(sessionId);
          setMessages([]);
          setStaticEntries([]);
          staticIds.current.clear();
          // Delete old checkpoint + start fresh thread so models have zero history
          void clearThread(threadIdRef.current ?? sessionId);
          threadIdRef.current = `${sessionId}-c${Date.now()}`;
          invalidateGraph(sessionId);
          resetChatTranscript();
          clearScreen();
          break;

        case 'list':
        case 'participants':
          setCurrentView('participants');
          break;

        case 'back':
          setCurrentView('chat');
          break;

        case 'add':
          if (args.length >= 1 && args[0] !== undefined && args[0].length > 0) {
            void (async (): Promise<void> => {
              try {
                const parts = args[0]!.split(':');
                const providerId = parts[0];
                const modelId = parts[1];
                const nickname = parts[2];
                if (
                  providerId === undefined ||
                  providerId.length === 0 ||
                  modelId === undefined ||
                  modelId.length === 0
                ) {
                  setError('Usage: /add provider:model[:nickname]');
                  return;
                }
                const { getProviderRegistry } = await import('@cebus/engine');
                const registry = getProviderRegistry();
                const provider = registry.get(providerId);

                if (provider) {
                  const available = await provider.isModelAvailable(modelId);

                  if (!available) {
                    setError(
                      `Model '${modelId}' is not available from ${providerId}. Use /models to see available models.`
                    );
                    return;
                  }
                }
                addModelParticipant(sessionId, providerId, modelId, { nickname });
                setParticipants(getParticipants(sessionId));
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to add model');
              }
            })();
          } else {
            setError('Usage: /add provider:model[:nickname]');
          }
          break;

        case 'remove':
          if (args.length >= 1 && args[0] !== undefined && args[0].length > 0) {
            const target = participants.find(
              p => p.nickname.toLowerCase() === args[0]!.toLowerCase()
            );

            if (target && target.type === 'model') {
              removeParticipant(sessionId, target.id);
              setParticipants(getParticipants(sessionId));
            } else {
              setError('Model not found');
            }
          } else {
            setError('Usage: /remove <nickname>');
          }
          break;

        case 'rename':
          if (
            args.length >= 2 &&
            args[0] !== undefined &&
            args[0].length > 0 &&
            args[1] !== undefined &&
            args[1].length > 0
          ) {
            const target = participants.find(
              p => p.nickname.toLowerCase() === args[0]!.toLowerCase()
            );

            if (target) {
              try {
                renameParticipant(sessionId, target.id, args[1]!);
                setParticipants(getParticipants(sessionId));
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to rename');
              }
            } else {
              setError('Participant not found');
            }
          } else {
            setError('Usage: /rename <old-nickname> <new-nickname>');
          }
          break;

        case 'context': {
          if (args.length === 0 || args[0] === undefined || args[0].length === 0) {
            const config = getContextConfig(sessionId);
            setError(
              `Current context level: ${config.level}. Use /context [none|minimal|full] to change.`
            );
            break;
          }
          const level = args[0].toLowerCase();
          if (level !== 'none' && level !== 'minimal' && level !== 'full') {
            setError('Invalid context level. Use: /context [none|minimal|full]');
            break;
          }
          setContextLevel(sessionId, level as ContextLevel);
          setContextLevelState(level as ContextLevel);
          invalidateGraph(sessionId);
          setError(`Context level set to: ${level}. Will apply on next message.`);
          break;
        }

        case 'refresh': {
          markContextStale(sessionId);
          setError('Context marked as stale. Will refresh on next message.');
          break;
        }

        case 'effort': {
          const level = args[0]?.toLowerCase();
          if (level !== 'low' && level !== 'medium' && level !== 'high') {
            setError('Usage: /effort [low|medium|high]');
            break;
          }
          setReasoningEffort(sessionId, level);
          invalidateGraph(sessionId);
          setError(`Reasoning effort set to: ${level}`);
          break;
        }

        case 'image': {
          if (args[0] === undefined || args[0].length === 0) {
            setError('Usage: /image <image-path>');
            break;
          }
          const imgPath = resolve(args.join(' '));
          const imgExt = imgPath.split('.').pop()?.toLowerCase();
          const validImageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
          if (!validImageExts.includes(imgExt ?? '')) {
            setError(
              `Not a supported image format. Supported: ${validImageExts.join(', ')}`
            );
            break;
          }
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- user-provided path for attachment
          if (!existsSync(imgPath)) {
            setError(`Image not found: ${imgPath}`);
            break;
          }
          addAttachment(imgPath);
          setError(`Image attached: ${imgPath}`);
          break;
        }

        case 'attach': {
          if (args[0] === undefined || args[0].length === 0) {
            setError('Usage: /attach <file-path>');
            break;
          }
          const filePath = resolve(args.join(' '));
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- user-provided path for attachment
          if (!existsSync(filePath)) {
            setError(`File not found: ${filePath}`);
            break;
          }
          addAttachment(filePath);
          setError(`Attached: ${filePath}`);
          break;
        }

        case 'attachments': {
          if (pendingAttachments.length === 0) {
            setError('No pending attachments.');
          } else {
            setError(`Pending attachments:\n${pendingAttachments.map(p => `  • ${typeof p === 'string' ? p : `[pasted ${p.type}]`}`).join('\n')}`);
          }
          break;
        }

        case 'clear-attachments': {
          clearAttachments();
          setError('Attachments cleared.');
          break;
        }

        case 'model': {
          if (args[0] === undefined || args[0].length === 0) {
            // List current models
            const models = participants
              .filter(p => p.type === 'model')
              .map(p => `  ${p.nickname}: ${p.providerId}:${p.modelId}`)
              .join('\n');
            setError(`Current models:\n${models}\n\nUsage: /model <provider:model> to switch a participant's model.\n  e.g. /model copilot:claude-sonnet-4.5`);
            break;
          }
          const modelArg = args[0];
          const colonIdx = modelArg.indexOf(':');
          if (colonIdx === -1) {
            setError('Usage: /model <provider:model>\n  e.g. /model copilot:claude-sonnet-4.5');
            break;
          }
          // Invalidate the compiled graph so next message creates a fresh session with the new model
          invalidateGraph(sessionId);
          setError(
            `Model switch requested: ${modelArg}\nGraph invalidated — next message will create a fresh session.`
          );
          break;
        }

        default:
          setError(`Unknown command: /${command}`);
      }
    },
    [sessionId, participants, handleExit, addAttachment, clearAttachments, pendingAttachments]
  );
}
