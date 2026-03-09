/**
 * Type-safe postMessage protocol between extension host and WebView.
 */

import type { OrchestrationStreamEvent, ChatMode } from '@cebus/engine';
import type { CopilotServerState } from '../copilot/cli-manager.js';

// ── WebView → Extension ──────────────────────────────────────────────────────

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'createSession'; models: ModelSelectionMsg[]; chatMode: ChatMode }
  | { type: 'sendMessage'; sessionId: string; content: string; attachments?: FileAttachmentMsg[] | undefined }
  | { type: 'cancelAll'; sessionId: string }
  | { type: 'getModels' }
  | { type: 'resolveApproval'; approvalId: string; approved: boolean; budget: number }
  | { type: 'resetSession'; sessionId: string }
  | { type: 'openInTab' }
  | { type: 'listConversations' }
  | { type: 'loadConversation'; conversationId: string }
  | { type: 'deleteConversation'; conversationId: string }
  | { type: 'requestFilePicker' }
  | { type: 'attachActiveFile' }
  | { type: 'ideAction'; action: string; params?: Record<string, unknown> | undefined }
  | { type: 'attachByUri'; uri: string }
  | { type: 'attachSelection' }
  | { type: 'pasteImage'; dataUrl: string; fileName: string };

export interface ModelSelectionMsg {
  providerId: string;
  modelId: string;
  displayName: string;
}

export interface FileAttachmentMsg {
  uri: string;
  fileName: string;
  language: string;
  lineCount: number;
  lineRange?: { start: number; end: number } | undefined;
  isImage?: boolean | undefined;
}

// ── Extension → WebView ──────────────────────────────────────────────────────

export type ExtensionMessage =
  | { type: 'sessionCreated'; sessionId: string; participants: ParticipantInfo[]; conversationId: string }
  | { type: 'streamEvent'; event: OrchestrationStreamEvent }
  | { type: 'streamEnd'; sessionId: string }
  | { type: 'models'; available: ProviderModelsMsg[] }
  | { type: 'copilotStatus'; state: CopilotServerState }
  | { type: 'error'; message: string }
  | { type: 'sessionReset' }
  | { type: 'config'; viewMode: 'sidebar' | 'tab'; mascotUri: string | null }
  | { type: 'conversationList'; conversations: ConversationSummaryMsg[] }
  | { type: 'conversationLoaded'; conversation: ConversationLoadedMsg }
  | { type: 'fileAttached'; attachment: FileAttachmentMsg }
  | { type: 'conversationDeleted'; conversationId: string }
  | { type: 'ideActionResult'; action: string; success: boolean; data?: unknown; error?: string };

export interface ParticipantInfo {
  id: string;
  displayName: string;
  providerId?: string | undefined;
  modelId?: string | undefined;
}

export interface ProviderModelsMsg {
  providerId: string;
  providerName: string;
  models: Array<{ modelId: string; displayName: string }>;
}

export interface ConversationSummaryMsg {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  chatMode: string;
  modelCount: number;
  messageCount: number;
}

export interface ConversationLoadedMsg {
  id: string;
  sessionId: string;
  title: string;
  chatMode: string;
  models: Array<{ providerId: string; modelId: string; displayName: string }>;
  messages: Array<{
    id: string;
    agentId: string;
    displayName: string;
    content: string;
    senderType: 'user' | 'agent';
    timestamp: number;
    providerId?: string | undefined;
    modelId?: string | undefined;
  }>;
  participants: ParticipantInfo[];
}
