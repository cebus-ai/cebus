import type React from 'react';
import { useEffect } from 'react';
import type { Message, Participant } from '@cebus/engine';
import { getMessages, getParticipants, logStream, debug } from '@cebus/engine';

interface UseMessageRefreshParams {
  sessionId: string;
  streamingParticipants: string[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setParticipants: React.Dispatch<React.SetStateAction<Participant[]>>;
}

export function useMessageRefresh({
  sessionId,
  streamingParticipants,
  setMessages,
  setParticipants,
}: UseMessageRefreshParams): void {
  useEffect(() => {
    if (streamingParticipants.length === 0) return;

    logStream('app', 'start', { streamingParticipants });
    setParticipants(getParticipants(sessionId));

    const interval = setInterval(() => {
      const msgs = getMessages(sessionId);
      debug('app', 'Refresh interval', {
        messageCount: msgs.length,
        streamingCount: msgs.filter(m => m.status === 'streaming').length,
      });
      setMessages([...msgs]);
    }, 100);

    return (): void => {
      logStream('app', 'complete', { streamingParticipants });
      clearInterval(interval);
      setParticipants(getParticipants(sessionId));
    };
  }, [sessionId, streamingParticipants, setMessages]);
}
