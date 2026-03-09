import { trpc } from '../lib/trpc';

export function useInboxConversations() {
  const query = trpc.inbox.conversations.useQuery(undefined, { refetchInterval: 30_000 });
  const markReadMutation = trpc.inbox.markReadForAgent.useMutation({
    onSuccess: () => query.refetch(),
  });
  const deleteForAgentMutation = trpc.inbox.deleteForAgent.useMutation({
    onSuccess: () => query.refetch(),
  });
  const clearAllMutation = trpc.inbox.clearAll.useMutation({
    onSuccess: () => query.refetch(),
  });

  return {
    conversations: query.data?.conversations ?? [],
    totalUnread: query.data?.totalUnread ?? 0,
    isLoading: query.isLoading,
    markReadForAgent: markReadMutation.mutateAsync,
    deleteForAgent: deleteForAgentMutation.mutateAsync,
    clearAll: clearAllMutation.mutateAsync,
    refetch: query.refetch,
  };
}
