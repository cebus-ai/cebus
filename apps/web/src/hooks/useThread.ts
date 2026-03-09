import { useState, useCallback } from 'react';
import { trpc } from '../lib/trpc';

interface ThreadMessage {
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

export function useThread(parentMessageId: string | null, channelId?: string) {
  const [optimisticReplies, setOptimisticReplies] = useState<ThreadMessage[]>([]);

  const threadQuery = trpc.message.threadList.useQuery(
    { channelId: channelId!, parentMessageId: parentMessageId! },
    { enabled: !!parentMessageId && !!channelId, refetchOnWindowFocus: false },
  );

  const sendMutation = trpc.message.threadSend.useMutation({
    onSuccess: () => {
      threadQuery.refetch();
      setOptimisticReplies([]);
    },
  });

  const sendReply = useCallback(
    async (channelId: string, content: string, targetAgentIds?: string[]) => {
      if (!parentMessageId) return;
      await sendMutation.mutateAsync({
        channelId,
        parentMessageId,
        content,
        targetAgentIds,
      });
    },
    [parentMessageId, sendMutation],
  );

  const parentMessage = threadQuery.data?.parentMessage ?? null;
  const serverReplies = threadQuery.data?.replies ?? [];

  // Merge server + optimistic, deduplicate
  const serverIds = new Set(serverReplies.map((m) => m.id));
  const uniqueOptimistic = optimisticReplies.filter((m) => !serverIds.has(m.id));
  const replies = [...serverReplies, ...uniqueOptimistic]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const appendStreamReply = useCallback((msg: ThreadMessage) => {
    setOptimisticReplies((prev) => {
      const exists = prev.some((m) => m.id === msg.id);
      return exists ? prev.map((m) => (m.id === msg.id ? msg : m)) : [...prev, msg];
    });
  }, []);

  return {
    parentMessage,
    replies,
    isLoading: threadQuery.isLoading,
    sendReply,
    isSending: sendMutation.isPending,
    refetch: threadQuery.refetch,
    appendStreamReply,
  };
}
