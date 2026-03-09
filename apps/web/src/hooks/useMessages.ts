import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { trpc } from '../lib/trpc';

interface Message {
  id: string;
  channelId: string;
  senderType: string;
  senderId: string;
  content: string;
  formatType: string;
  createdAt: string;
  replyToId: string | null;
  branchId: string | null;
}

export function useMessages(channelId: string | null) {
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);

  // Reset state when channelId changes
  useEffect(() => {
    setOptimisticMessages([]);
  }, [channelId]);

  const messagesQuery = trpc.message.list.useQuery(
    { channelId: channelId! },
    { enabled: !!channelId, refetchOnWindowFocus: false },
  );

  const clearContextMutation = trpc.channel.clearContext.useMutation({
    onSuccess: () => {
      messagesQuery.refetch();
    },
  });

  const pendingOptimisticIdRef = useRef<string | null>(null);

  const sendMutation = trpc.message.send.useMutation({
    onSuccess: () => {
      void messagesQuery.refetch();
    },
  });

  const sendMessage = useCallback(
    async (
      content: string,
      contextSize?: number | undefined,
      directedTo?: string[] | undefined,
      attachments?: Array<{ type: 'file' | 'directory' | 'selection'; path: string; displayName?: string | undefined }> | undefined
    ) => {
      if (!channelId) return;

      const tempId = `optimistic-${Date.now()}`;
      pendingOptimisticIdRef.current = tempId;
      const optimistic: Message = {
        id: tempId,
        channelId,
        senderType: 'user',
        senderId: 'me',
        content,
        formatType: 'text',
        createdAt: new Date().toISOString(),
        replyToId: null,
        branchId: null,
      };
      setOptimisticMessages((prev) => [...prev, optimistic]);

      const result = await sendMutation.mutateAsync({
        channelId,
        content,
        contextSize,
        directedTo,
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
      });

      // Replace temp optimistic with real server message; dedup will handle cleanup
      if (result) {
        const realMsg: Message = {
          id: result.id as string,
          channelId,
          senderType: 'user',
          senderId: result.senderId as string,
          content: result.content as string,
          formatType: (result.formatType as string) ?? 'text',
          createdAt: result.createdAt as string,
          replyToId: (result.replyToId as string) ?? null,
          branchId: (result.branchId as string) ?? null,
        };
        setOptimisticMessages((prev) => prev.map((m) => (m.id === tempId ? realMsg : m)));
        pendingOptimisticIdRef.current = null;
      }
    },
    [channelId, sendMutation],
  );

  const serverMessages = messagesQuery.data?.messages ?? [];
  const contextWindowSize = messagesQuery.data?.contextWindowSize ?? 10;
  const totalMessages = messagesQuery.data?.totalMessages ?? 0;
  const contextStartAt = messagesQuery.data?.contextStartAt ?? null;
  const replyCounts = messagesQuery.data?.replyCounts ?? {};

  // Deduplicate and sort: merge server + optimistic, remove dupes, sort by time
  const serverIds = new Set(serverMessages.map((m) => m.id));
  const uniqueOptimistic = optimisticMessages.filter((m) => !serverIds.has(m.id));
  const allMessages = [...serverMessages, ...uniqueOptimistic]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const appendStreamMessage = useCallback((msg: Message) => {
    setOptimisticMessages((prev) => {
      const exists = prev.some((m) => m.id === msg.id);
      return exists ? prev.map((m) => (m.id === msg.id ? msg : m)) : [...prev, msg];
    });
  }, []);

  // Clear context — persists to DB via server, AI only sees messages after this point
  const clearChat = useCallback(() => {
    if (!channelId) return;
    clearContextMutation.mutate({ channelId });
  }, [channelId, clearContextMutation]);

  const clearOptimistic = useCallback(() => {
    setOptimisticMessages([]);
  }, []);

  // Calculate context boundary index based on server-side contextStartAt timestamp
  // Messages at index >= contextBoundaryIndex are "in context" for AI
  const contextBoundaryIndex = useMemo(() => {
    if (!contextStartAt) return 0; // No context boundary — all messages are in context
    const idx = allMessages.findIndex((m) => m.createdAt > contextStartAt);
    return idx === -1 ? allMessages.length : idx;
  }, [allMessages, contextStartAt]);

  return {
    messages: allMessages,
    isLoading: messagesQuery.isLoading,
    sendMessage,
    isSending: sendMutation.isPending,
    refetch: messagesQuery.refetch,
    appendStreamMessage,
    clearChat,
    clearOptimistic,
    contextBoundaryIndex,
    contextWindowSize,
    contextStartAt,
    totalMessages,
    replyCounts,
  };
}
