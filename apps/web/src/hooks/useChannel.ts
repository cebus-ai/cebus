import { useState, useCallback } from 'react';
import { trpc } from '../lib/trpc';

export function useChannel() {
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const channelsQuery = trpc.channel.list.useQuery();
  const channelQuery = trpc.channel.get.useQuery(
    { channelId: selectedChannelId! },
    { enabled: !!selectedChannelId },
  );

  const createMutation = trpc.channel.create.useMutation({
    onSuccess: (channel) => {
      channelsQuery.refetch();
      setSelectedChannelId(channel.id);
    },
  });

  const addAgentMutation = trpc.channel.addAgent.useMutation({
    onSuccess: () => {
      channelQuery.refetch();
    },
  });

  const removeAgentMutation = trpc.channel.removeAgent.useMutation({
    onSuccess: () => {
      channelQuery.refetch();
    },
  });

  const archiveMutation = trpc.channel.archive.useMutation({
    onSuccess: () => {
      channelsQuery.refetch();
      if (selectedChannelId) {
        setSelectedChannelId(null);
      }
    },
  });

  const deleteMutation = trpc.channel.delete.useMutation({
    onSuccess: () => {
      channelsQuery.refetch();
      if (selectedChannelId) {
        setSelectedChannelId(null);
      }
    },
  });

  const reorderMutation = trpc.channel.reorder.useMutation({
    onMutate: async ({ orderedIds }) => {
      await utils.channel.list.cancel();
      const previous = utils.channel.list.getData();
      if (previous) {
        const byId = new Map(previous.map((ch) => [ch.id, ch]));
        const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean) as typeof previous;
        utils.channel.list.setData(undefined, reordered);
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        utils.channel.list.setData(undefined, context.previous);
      }
    },
    onSettled: () => {
      utils.channel.list.invalidate();
    },
  });

  const unreadQuery = trpc.channel.unreadCounts.useQuery(undefined, {
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });

  const markSeenMutation = trpc.channel.markSeen.useMutation({
    onSuccess: () => {
      unreadQuery.refetch();
    },
  });

  const selectChannel = useCallback((id: string) => {
    setSelectedChannelId(id);
    markSeenMutation.mutate({ channelId: id });
  }, [markSeenMutation]);

  const reorderChannels = useCallback(
    (orderedIds: string[]) => {
      reorderMutation.mutate({ orderedIds });
    },
    [reorderMutation],
  );

  return {
    channels: channelsQuery.data ?? [],
    selectedChannel: channelQuery.data ?? null,
    selectedChannelId,
    isLoading: channelsQuery.isLoading,
    selectChannel,
    createChannel: createMutation.mutateAsync,
    addAgent: addAgentMutation.mutateAsync,
    removeAgent: removeAgentMutation.mutateAsync,
    archiveChannel: archiveMutation.mutate,
    deleteChannel: deleteMutation.mutate,
    reorderChannels,
    isCreating: createMutation.isPending,
    unreadCounts: unreadQuery.data ?? {},
  };
}
