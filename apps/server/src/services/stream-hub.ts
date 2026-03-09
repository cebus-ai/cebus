type StreamEvent = Record<string, unknown> & { type: string };
type Listener = (event: StreamEvent) => void;

const channelListeners = new Map<string, Set<Listener>>();

export function subscribeChannel(channelId: string, listener: Listener): () => void {
  let listeners = channelListeners.get(channelId);
  if (!listeners) {
    listeners = new Set();
    channelListeners.set(channelId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners!.delete(listener);
    if (listeners!.size === 0) channelListeners.delete(channelId);
  };
}

export function emitToChannel(channelId: string, event: StreamEvent): void {
  const listeners = channelListeners.get(channelId);
  if (!listeners) return;
  for (const listener of listeners) {
    listener(event);
  }
}
