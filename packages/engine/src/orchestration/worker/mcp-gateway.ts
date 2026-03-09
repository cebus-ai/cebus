import type { StructuredToolInterface } from '@langchain/core/tools';
import type {
  MCPServerConfig,
  CircuitBreakerState,
  MCPInitResult,
  MCPToolInvocation,
  OrchestrationLogger,
} from '../types.js';

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RETRY_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 300000; // 5 minutes

interface CircuitBreakerConfig {
  failureThreshold: number;
  retryBackoffMs: number;
}

class CircuitBreaker {
  private state: 'closed' | 'open' | 'half_open' = 'closed';
  private failureCount = 0;
  private lastFailureAt: number | null = null;
  private nextRetryAt: number | null = null;
  private currentBackoff: number;

  constructor(
    private readonly serverId: string,
    private readonly config: CircuitBreakerConfig,
    private readonly logger?: OrchestrationLogger
  ) {
    this.currentBackoff = config.retryBackoffMs;
  }

  canExecute(): boolean {
    if (this.state === 'closed') return true;

    if (this.state === 'open') {
      if (this.nextRetryAt !== null && Date.now() >= this.nextRetryAt) {
        this.transitionTo('half_open', 'Backoff period expired, attempting recovery');
        return true;
      }
      return false;
    }

    // half_open — allow one attempt
    return true;
  }

  recordSuccess(): void {
    if (this.state === 'half_open') {
      this.transitionTo('closed', 'Recovery successful');
      this.failureCount = 0;
      this.currentBackoff = this.config.retryBackoffMs;
    }
    this.failureCount = 0;
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureAt = Date.now();

    if (this.state === 'half_open') {
      this.currentBackoff = Math.min(this.currentBackoff * 2, MAX_BACKOFF_MS);
      this.nextRetryAt = Date.now() + this.currentBackoff;
      this.transitionTo('open', `Recovery failed, doubling backoff to ${this.currentBackoff}ms`);
      return;
    }

    if (this.failureCount >= this.config.failureThreshold) {
      this.nextRetryAt = Date.now() + this.currentBackoff;
      this.transitionTo('open', `${this.failureCount} consecutive failures`);
    }
  }

  getState(): CircuitBreakerState {
    return {
      serverId: this.serverId,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureAt: this.lastFailureAt,
      nextRetryAt: this.nextRetryAt,
    };
  }

  private transitionTo(newState: 'closed' | 'open' | 'half_open', reason: string): void {
    this.state = newState;
    this.logger?.mcpCircuitBreaker(this.serverId, newState, reason);
  }
}

interface MCPConnection {
  client: MCPClientLike;
  tools: StructuredToolInterface[];
  breaker: CircuitBreaker;
  config: MCPServerConfig;
}

interface MCPClientLike {
  getTools(): Promise<StructuredToolInterface[]>;
  close(): Promise<void>;
}

export class MCPGateway {
  private readonly connections = new Map<string, MCPConnection>();
  private readonly logger: OrchestrationLogger | undefined;

  constructor(logger?: OrchestrationLogger) {
    this.logger = logger;
  }

  async connect(agentId: string, servers: MCPServerConfig[]): Promise<MCPInitResult[]> {
    const results: MCPInitResult[] = [];

    for (const serverConfig of servers) {
      const result = await this.connectServer(agentId, serverConfig);
      results.push(result);
    }

    return results;
  }

  getTools(agentId: string): StructuredToolInterface[] {
    const tools: StructuredToolInterface[] = [];

    for (const [key, conn] of this.connections) {
      if (key.startsWith(`${agentId}:`) && conn.breaker.canExecute()) {
        tools.push(...conn.tools);
      }
    }

    return tools;
  }

  async invokeTool(
    agentId: string,
    serverId: string,
    toolName: string,
    parameters: Record<string, unknown>,
    traceId: string,
    timeoutMs?: number
  ): Promise<MCPToolInvocation> {
    const connectionKey = `${agentId}:${serverId}`;
    const conn = this.connections.get(connectionKey);
    const startTime = Date.now();

    if (!conn) {
      const invocation: MCPToolInvocation = {
        traceId,
        timestamp: startTime,
        agentId,
        serverId,
        toolName,
        parameters,
        status: 'error',
        latencyMs: 0,
        error: `No connection found for server: ${serverId}`,
      };
      this.logger?.mcpInvoke(invocation);
      return invocation;
    }

    if (!conn.breaker.canExecute()) {
      const invocation: MCPToolInvocation = {
        traceId,
        timestamp: startTime,
        agentId,
        serverId,
        toolName,
        parameters,
        status: 'error',
        latencyMs: 0,
        error: `Circuit breaker is open for server: ${serverId}`,
      };
      this.logger?.mcpInvoke(invocation);
      return invocation;
    }

    const timeout = timeoutMs ?? conn.config.timeout ?? 30000;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const tool = conn.tools.find(t => t.name === toolName);
      if (!tool) {
        throw new Error(`Tool not found: ${toolName}`);
      }

      const resultPromise = tool.invoke(parameters);
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Tool timeout after ${timeout}ms`)), timeout);
      });

      const result = await Promise.race([resultPromise, timeoutPromise]);
      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;

      conn.breaker.recordSuccess();

      const invocation: MCPToolInvocation = {
        traceId,
        timestamp: startTime,
        agentId,
        serverId,
        toolName,
        parameters,
        result,
        status: 'success',
        latencyMs,
      };

      this.logger?.mcpInvoke(invocation);
      return invocation;
    } catch (err) {
      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : 'Unknown MCP error';
      const isTimeout = errorMsg.includes('timeout');

      conn.breaker.recordFailure();

      const invocation: MCPToolInvocation = {
        traceId,
        timestamp: startTime,
        agentId,
        serverId,
        toolName,
        parameters,
        status: isTimeout ? 'timeout' : 'error',
        latencyMs,
        error: errorMsg,
      };

      this.logger?.mcpInvoke(invocation);
      return invocation;
    }
  }

  getHealth(): Record<string, CircuitBreakerState> {
    const health: Record<string, CircuitBreakerState> = {};

    for (const [key, conn] of this.connections) {
      // eslint-disable-next-line security/detect-object-injection -- key from Map iteration
      health[key] = conn.breaker.getState();
    }

    return health;
  }

  async dispose(): Promise<void> {
    for (const conn of this.connections.values()) {
      try {
        await conn.client.close();
      } catch {
        // Best-effort cleanup: connection may already be closed
      }
    }
    this.connections.clear();
  }

  private async connectServer(
    agentId: string,
    serverConfig: MCPServerConfig
  ): Promise<MCPInitResult> {
    const connectionKey = `${agentId}:${serverConfig.id}`;

    try {
      const { MultiServerMCPClient } = await import('@langchain/mcp-adapters');

      const connectionConfig: Record<string, Record<string, unknown>> = {};

      if (serverConfig.type === 'local') {
        connectionConfig[serverConfig.id] = {
          transport: 'stdio',
          command: serverConfig.command,
          args: serverConfig.args ?? [],
          env: serverConfig.env,
        };
      } else if (serverConfig.type === 'streamable_http') {
        connectionConfig[serverConfig.id] = {
          transport: 'http',
          url: serverConfig.url,
          headers: serverConfig.headers,
        };
      } else {
        connectionConfig[serverConfig.id] = {
          transport: 'sse',
          url: serverConfig.url,
          headers: serverConfig.headers,
        };
      }

      /**
       * MultiServerMCPClient's constructor expects a specific config shape that
       * doesn't align with our generic Record<string, Record<string, unknown>>.
       * The `as any` cast bridges the type mismatch between our normalized config
       * and the library's expected parameter types.
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = new MultiServerMCPClient(connectionConfig as any) as unknown as MCPClientLike;

      let tools: StructuredToolInterface[];
      try {
        tools = await client.getTools();
      } catch {
        const breaker = new CircuitBreaker(
          serverConfig.id,
          {
            failureThreshold: DEFAULT_FAILURE_THRESHOLD,
            retryBackoffMs: DEFAULT_RETRY_BACKOFF_MS,
          },
          this.logger
        );

        this.connections.set(connectionKey, {
          client,
          tools: [],
          breaker,
          config: serverConfig,
        });

        return {
          serverId: serverConfig.id,
          status: 'degraded',
          toolCount: 0,
          error: 'Connected but tools unavailable',
        };
      }

      const breaker = new CircuitBreaker(
        serverConfig.id,
        {
          failureThreshold: DEFAULT_FAILURE_THRESHOLD,
          retryBackoffMs: DEFAULT_RETRY_BACKOFF_MS,
        },
        this.logger
      );

      this.connections.set(connectionKey, {
        client,
        tools,
        breaker,
        config: serverConfig,
      });

      return {
        serverId: serverConfig.id,
        status: 'connected',
        toolCount: tools.length,
      };
    } catch (err) {
      return {
        serverId: serverConfig.id,
        status: 'failed',
        toolCount: 0,
        error: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  }
}
