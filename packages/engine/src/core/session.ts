import type {
  ChatSession,
  ChatMode,
  Participant,
  Message,
  ModelConfig,
  SessionStore,
  ContextConfig,
  OrchestratorConfig,
} from './types';
import { NicknameSchema } from '../config/schema';
import { getProviderRegistry } from '../providers/registry';
import { DEFAULT_CONTEXT_CONFIG, setContextLevel } from './context-config';
import { generateId } from './utils/id';

const DEFAULT_NICKNAMES: Record<string, Record<string, string>> = {
  openai: {
    'gpt-5.4': 'GPT 5.4',
    'gpt-5.3-codex': 'GPT 5.3 Codex',
    'gpt-5.2': 'GPT 5.2',
    'gpt-5.1': 'GPT 5.1',
    'gpt-4.1': 'GPT 4.1',
    'gpt-4.1-mini': 'GPT 4.1 Mini',
    'gpt-4.1-nano': 'GPT 4.1 Nano',
    'gpt-4o': 'GPT 4o',
    'gpt-4o-mini': 'GPT 4o Mini',
  },
  anthropic: {
    // Latest Claude 4.5 models
    'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5',
    'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
    'claude-opus-4-5-20251101': 'Claude Opus 4.5',
    // Legacy models
    'claude-sonnet-4-20250514': 'Claude Sonnet 4',
    'claude-3-haiku-20240307': 'Claude Haiku 3',
  },
  copilot: {
    'GPT-5.2-Codex': 'Copilot cli GPT-5.2',
    'gpt-5.1-codex': 'Copilot cli GPT 5.1',
    'gpt-5.1': 'Copilot cli GPT 5.1 Base',
    'claude-sonnet-4.5': 'Copilot cli Claude Sonnet',
    'claude-opus-4.5': 'Copilot cli Claude Opus',
    'gemini-3-flash': 'Copilot cli Gemini 3',
  },
};

const store: SessionStore = {
  sessions: new Map(),
  participantsBySession: new Map(),
  messagesBySession: new Map(),
  nicknameIndex: new Map(),
};

function getOrThrow<K, V>(map: Map<K, V>, key: K, label: string): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`${label} not found for key: ${String(key)}`);
  }
  return value;
}

export interface CreateSessionOptions {
  title?: string | undefined;
  contextConfig?: Partial<ContextConfig> | undefined;
  chatMode?: ChatMode | undefined;
  orchestratorConfig?: OrchestratorConfig | undefined;
}

/**
 * Create a new chat session.
 */
export function createSession(options: CreateSessionOptions = {}): ChatSession {
  const id = generateId();
  const session: ChatSession = {
    id,
    createdAt: new Date().toISOString(),
    participantIds: [],
    status: 'active',
    title: options.title,
    contextConfig: {
      ...DEFAULT_CONTEXT_CONFIG,
      ...options.contextConfig,
    },
    chatMode: options.chatMode,
    orchestratorConfig: options.orchestratorConfig,
  };

  store.sessions.set(id, session);
  store.participantsBySession.set(id, new Map());
  store.messagesBySession.set(id, []);
  store.nicknameIndex.set(id, new Map());

  setContextLevel(id, session.contextConfig!.level);

  return session;
}

/**
 * Get a session by ID.
 */
export function getSession(sessionId: string): ChatSession | undefined {
  return store.sessions.get(sessionId);
}

/**
 * End a session.
 */
export function endSession(sessionId: string): void {
  const session = store.sessions.get(sessionId);
  if (session) {
    session.status = 'ended';
  }
}

/**
 * Delete a session and all associated data.
 */
export function deleteSession(sessionId: string): void {
  store.sessions.delete(sessionId);
  store.participantsBySession.delete(sessionId);
  store.messagesBySession.delete(sessionId);
  store.nicknameIndex.delete(sessionId);
}

export interface AddParticipantOptions {
  displayName?: string | undefined;
  nickname?: string | undefined;
  config?: ModelConfig | undefined;
  role?: string | undefined;
}

export function getDefaultNickname(providerId: string, modelId: string): string {
  // eslint-disable-next-line security/detect-object-injection -- providerId from trusted provider data
  const providerNicknames = DEFAULT_NICKNAMES[providerId];
  // eslint-disable-next-line security/detect-object-injection -- modelId from trusted provider data
  if (
    providerNicknames !== undefined &&
    providerNicknames[modelId] !== undefined &&
    providerNicknames[modelId].length > 0
  ) {
    // eslint-disable-next-line security/detect-object-injection -- modelId from trusted provider data
    return providerNicknames[modelId];
  }

  return modelId
    .replace(/[^a-zA-Z0-9_\-. ]/g, '')
    .replace(/[-_]/g, '')
    .replace(/^gpt/i, 'GPT')
    .replace(/^./, c => c.toUpperCase())
    .substring(0, 20);
}

export function validateNickname(nickname: string): boolean {
  const result = NicknameSchema.safeParse(nickname);
  return result.success;
}

export function isNicknameUnique(sessionId: string, nickname: string): boolean {
  const nicknameMap = store.nicknameIndex.get(sessionId);
  if (!nicknameMap) return true;
  return !nicknameMap.has(nickname.toLowerCase());
}

export function generateUniqueNickname(sessionId: string, baseNickname: string): string {
  let nickname = baseNickname;
  let counter = 2;

  while (!isNicknameUnique(sessionId, nickname)) {
    nickname = `${baseNickname} ${counter}`;
    counter++;
  }

  return nickname;
}

export function addUserParticipant(
  sessionId: string,
  options: AddParticipantOptions = {}
): Participant {
  const session = store.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const nickname = options.nickname ?? 'User';
  const uniqueNickname = generateUniqueNickname(sessionId, nickname);

  if (!validateNickname(uniqueNickname)) {
    throw new Error(`Invalid nickname format: ${uniqueNickname}`);
  }

  const participant: Participant = {
    id: generateId(),
    sessionId,
    type: 'user',
    displayName: options.displayName ?? 'You',
    nickname: uniqueNickname,
  };

  const participants = getOrThrow(store.participantsBySession, sessionId, 'Participants');
  participants.set(participant.id, participant);

  const nicknameMap = getOrThrow(store.nicknameIndex, sessionId, 'NicknameIndex');
  nicknameMap.set(uniqueNickname.toLowerCase(), participant.id);

  session.participantIds.push(participant.id);

  return participant;
}

/**
 * Add a model participant to a session.
 * The same provider/model can be added multiple times (e.g. with different roles).
 * Each instance gets a unique nickname via `generateUniqueNickname`.
 */
export function addModelParticipant(
  sessionId: string,
  providerId: string,
  modelId: string,
  options: AddParticipantOptions = {}
): Participant {
  const session = store.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const participants = getOrThrow(store.participantsBySession, sessionId, 'Participants');

  const defaultNickname = getDefaultNickname(providerId, modelId);
  const nickname = options.nickname ?? defaultNickname;
  const uniqueNickname = generateUniqueNickname(sessionId, nickname);

  if (!validateNickname(uniqueNickname)) {
    throw new Error(`Invalid nickname format: ${uniqueNickname}`);
  }

  let displayName = options.displayName;
  if (displayName === undefined || displayName.length === 0) {
    const registry = getProviderRegistry();
    const modelInfo = registry.getModelInfo(modelId);
    displayName = modelInfo?.displayName ?? modelId.replace(/^gpt/i, 'GPT');
  }

  const participant: Participant = {
    id: generateId(),
    sessionId,
    type: 'model',
    displayName,
    nickname: uniqueNickname,
    providerId,
    modelId,
    config: options.config,
    role: options.role,
  };

  participants.set(participant.id, participant);

  const nicknameMap = getOrThrow(store.nicknameIndex, sessionId, 'NicknameIndex');
  nicknameMap.set(uniqueNickname.toLowerCase(), participant.id);

  session.participantIds.push(participant.id);

  return participant;
}

/**
 * Add a orchestrator participant to a session.
 * Bypasses the duplicate model check — the same model can be both a regular agent and the orchestrator.
 * Uses fixed nickname 'Team Leader' and display name like "Team Leader (Llama 3.2)".
 */
export function addOrchestratorParticipant(
  sessionId: string,
  providerId: string,
  modelId: string
): Participant {
  const session = store.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const nickname = generateUniqueNickname(sessionId, 'Team Leader');

  let modelLabel = modelId;
  try {
    const registry = getProviderRegistry();
    const modelInfo = registry.getModelInfo(modelId);
    if (modelInfo?.displayName !== undefined && modelInfo.displayName.length > 0) {
      modelLabel = modelInfo.displayName;
    }
  } catch {
    // Expected: Registry not available — use modelId as-is
  }

  const participant: Participant = {
    id: generateId(),
    sessionId,
    type: 'model',
    displayName: `Team Leader (${modelLabel})`,
    nickname,
    providerId,
    modelId,
  };

  const participants = getOrThrow(store.participantsBySession, sessionId, 'Participants');
  participants.set(participant.id, participant);

  const nicknameMap = getOrThrow(store.nicknameIndex, sessionId, 'NicknameIndex');
  nicknameMap.set(nickname.toLowerCase(), participant.id);

  session.participantIds.push(participant.id);

  return participant;
}

export function setReasoningEffort(sessionId: string, level: 'low' | 'medium' | 'high'): void {
  const session = store.sessions.get(sessionId);
  if (session) {
    session.reasoningEffort = level;
  }
}

export function getReasoningEffort(sessionId: string): 'low' | 'medium' | 'high' | undefined {
  return store.sessions.get(sessionId)?.reasoningEffort;
}

export function updateOrchestratorConfig(
  sessionId: string,
  updates: Partial<OrchestratorConfig>
): void {
  const session = store.sessions.get(sessionId);
  if (!session || !session.orchestratorConfig) return;

  session.orchestratorConfig = { ...session.orchestratorConfig, ...updates };
}

export function getParticipants(sessionId: string): Participant[] {
  const participants = store.participantsBySession.get(sessionId);
  if (!participants) return [];
  return Array.from(participants.values());
}

export function getParticipant(sessionId: string, participantId: string): Participant | undefined {
  return store.participantsBySession.get(sessionId)?.get(participantId);
}

export function findParticipantByNickname(
  sessionId: string,
  nickname: string
): Participant | undefined {
  const nicknameMap = store.nicknameIndex.get(sessionId);
  if (!nicknameMap) return undefined;

  const participantId = nicknameMap.get(nickname.toLowerCase());
  if (participantId === undefined) return undefined;

  return getParticipant(sessionId, participantId);
}

export function getModelParticipants(sessionId: string): Participant[] {
  return getParticipants(sessionId).filter(p => p.type === 'model');
}

export function getUserParticipant(sessionId: string): Participant | undefined {
  return getParticipants(sessionId).find(p => p.type === 'user');
}

export function renameParticipant(
  sessionId: string,
  participantId: string,
  newNickname: string
): void {
  const participant = getParticipant(sessionId, participantId);
  if (!participant) {
    throw new Error(`Participant ${participantId} not found`);
  }

  if (!validateNickname(newNickname)) {
    throw new Error(`Invalid nickname format: ${newNickname}`);
  }

  if (!isNicknameUnique(sessionId, newNickname)) {
    throw new Error(`Nickname ${newNickname} is already in use`);
  }

  const nicknameMap = getOrThrow(store.nicknameIndex, sessionId, 'NicknameIndex');

  nicknameMap.delete(participant.nickname.toLowerCase());

  participant.nickname = newNickname;
  nicknameMap.set(newNickname.toLowerCase(), participantId);
}

export function removeParticipant(sessionId: string, participantId: string): void {
  const session = store.sessions.get(sessionId);
  if (!session) return;

  const participant = getParticipant(sessionId, participantId);
  if (!participant) return;

  const participants = getOrThrow(store.participantsBySession, sessionId, 'Participants');
  participants.delete(participantId);

  const nicknameMap = getOrThrow(store.nicknameIndex, sessionId, 'NicknameIndex');
  nicknameMap.delete(participant.nickname.toLowerCase());

  session.participantIds = session.participantIds.filter(id => id !== participantId);
}

export function addMessage(sessionId: string, message: Message): void {
  const messages = store.messagesBySession.get(sessionId);
  if (!messages) {
    throw new Error(`Session ${sessionId} not found`);
  }
  messages.push(message);
}

export function getMessages(sessionId: string): Message[] {
  return store.messagesBySession.get(sessionId) ?? [];
}

export function getMessagesBySender(sessionId: string, senderId: string): Message[] {
  return getMessages(sessionId).filter(m => m.senderId === senderId);
}

export function updateMessage(
  sessionId: string,
  messageId: string,
  updates: Partial<Message>
): void {
  const messages = store.messagesBySession.get(sessionId);
  if (!messages) return;

  const index = messages.findIndex(m => m.id === messageId);
  // eslint-disable-next-line security/detect-object-injection -- index is a numeric findIndex result
  if (index !== -1 && messages[index] !== undefined) {
    // eslint-disable-next-line security/detect-object-injection -- index is a numeric findIndex result
    messages[index] = { ...messages[index]!, ...updates } as Message;
  }
}

export function clearMessages(sessionId: string): void {
  const messages = store.messagesBySession.get(sessionId);
  if (messages) {
    messages.length = 0;
  }
}

export function getStore(): SessionStore {
  return store;
}

export function clearStore(): void {
  store.sessions.clear();
  store.participantsBySession.clear();
  store.messagesBySession.clear();
  store.nicknameIndex.clear();
}
