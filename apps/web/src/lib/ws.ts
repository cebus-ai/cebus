type PresenceEventType =
  | 'presence_update'
  | 'user_typing'
  | 'user_stopped_typing'
  | 'generation_stopped';

interface PresenceEvent {
  type: PresenceEventType;
  [key: string]: unknown;
}

type EventHandler = (event: PresenceEvent) => void;

export class WebSocketClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  connect(url: string): void {
    this.socket = new WebSocket(url);
    this.socket.onopen = () => this.startHeartbeat();
    this.socket.onmessage = (event) => this.handleMessage(event);
    this.socket.onclose = () => this.scheduleReconnect(url);
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }

  send(data: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  }

  on(eventType: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) this.handlers.set(eventType, new Set());
    this.handlers.get(eventType)!.add(handler);
    return () => this.handlers.get(eventType)?.delete(handler);
  }

  private handleMessage(event: MessageEvent): void {
    const data = JSON.parse(String(event.data)) as PresenceEvent;
    this.handlers.get(data.type)?.forEach((handler) => handler(data));
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'presence_heartbeat' });
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  private scheduleReconnect(url: string): void {
    this.stopHeartbeat();
    this.reconnectTimer = setTimeout(() => this.connect(url), 3000);
  }
}
