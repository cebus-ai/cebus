import type React from 'react';
import { useEffect } from 'react';
import type { Message, Participant } from '@cebus/engine';
import { getSession, getParticipants, getMessages, startChatTranscript } from '@cebus/engine';
import type { StaticEntry } from '../chat-types';

interface UseSessionDataParams {
  sessionId: string;
  title: string | undefined;
  staticIds: React.MutableRefObject<Set<string>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setParticipants: React.Dispatch<React.SetStateAction<Participant[]>>;
  setStaticEntries: React.Dispatch<React.SetStateAction<StaticEntry[]>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

/**
 * Loads initial session data (participants, messages) and starts the chat transcript.
 * On resume, populates the static scroll buffer with existing completed messages.
 */
export function useSessionData({
  sessionId,
  title,
  staticIds,
  setMessages,
  setParticipants,
  setStaticEntries,
  setError,
}: UseSessionDataParams): void {
  useEffect(() => {
    const session = getSession(sessionId);

    if (!session) {
      setError('Session not found');
      return;
    }

    startChatTranscript(title ?? 'Cebus Chat');

    setParticipants(getParticipants(sessionId));
    const loadedMessages = getMessages(sessionId);
    setMessages(loadedMessages);

    if (loadedMessages.length > 0 && staticIds.current.size === 0) {
      const completed = loadedMessages.filter(
        m => m.status === 'complete' || m.status === 'sent' || m.status === 'error'
      );
      for (const m of completed) {
        staticIds.current.add(m.id);
      }
      setStaticEntries(completed.map(m => ({ id: m.id, kind: 'message' as const, message: m })));
    }
  }, [sessionId, title, setError, setMessages, setParticipants, setStaticEntries, staticIds]);
}
