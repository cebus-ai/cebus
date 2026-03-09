import type {
  BudgetConfig,
  BudgetState,
  BudgetStatus,
  TokenUsage,
  OrchestrationLogger,
} from '../types.js';

interface BudgetCheckResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly budgetType?: 'agent_tokens' | 'session_tokens' | 'rate_limit';
  readonly current?: number;
  readonly limit?: number;
}

const RATE_LIMIT_WINDOW_MS = 60_000; // 60 seconds

/** Default estimated tokens to reserve per in-flight request. */
const DEFAULT_RESERVATION_TOKENS = 4000;

export class BudgetTracker {
  private readonly states = new Map<string, BudgetState>();

  constructor(
    private readonly config?: BudgetConfig,
    private readonly logger?: OrchestrationLogger
  ) {}

  /**
   * Pre-flight check: can this agent execute within budget?
   */
  checkBudget(sessionId: string, agentId: string, traceId: string): BudgetCheckResult {
    if (!this.config) return { allowed: true };

    const state = this.getOrCreateState(sessionId);

    // Check per-agent token limit (including reserved tokens from concurrent requests)
    if (
      this.config.maxTokensPerAgentPerSession !== null &&
      this.config.maxTokensPerAgentPerSession !== undefined
    ) {
      // eslint-disable-next-line security/detect-object-injection -- agentId from orchestration graph state
      const agentUsage = state.agentTokenUsage[agentId];
      const agentTotal = agentUsage ? agentUsage.input + agentUsage.output : 0;
      // eslint-disable-next-line security/detect-object-injection -- agentId from orchestration graph state
      const reserved = state.reservedTokens[agentId] ?? 0;
      const effectiveTotal = agentTotal + reserved;

      if (effectiveTotal >= this.config.maxTokensPerAgentPerSession) {
        const result: BudgetCheckResult = {
          allowed: false,
          reason: `Agent ${agentId} exceeded per-agent token limit`,
          budgetType: 'agent_tokens',
          current: effectiveTotal,
          limit: this.config.maxTokensPerAgentPerSession,
        };
        this.logger?.budgetExceeded(
          traceId,
          agentId,
          'agent_tokens',
          effectiveTotal,
          this.config.maxTokensPerAgentPerSession
        );
        return result;
      }

      // Warn at 80%
      const threshold = this.config.maxTokensPerAgentPerSession * 0.8;
      if (effectiveTotal >= threshold) {
        this.logger?.budgetWarning(
          traceId,
          agentId,
          'agent_tokens',
          effectiveTotal,
          this.config.maxTokensPerAgentPerSession
        );
      }
    }

    // Check per-session token limit (including all reservations)
    if (this.config.maxTokensPerSession !== null && this.config.maxTokensPerSession !== undefined) {
      const totalReserved = Object.values(state.reservedTokens).reduce((sum, r) => sum + r, 0);
      const effectiveSessionTotal = state.totalTokens + totalReserved;

      if (effectiveSessionTotal >= this.config.maxTokensPerSession) {
        const result: BudgetCheckResult = {
          allowed: false,
          reason: `Session ${sessionId} exceeded total token limit`,
          budgetType: 'session_tokens',
          current: effectiveSessionTotal,
          limit: this.config.maxTokensPerSession,
        };
        this.logger?.budgetExceeded(
          traceId,
          agentId,
          'session_tokens',
          effectiveSessionTotal,
          this.config.maxTokensPerSession
        );
        return result;
      }
    }

    // Check rate limit (invocations per minute)
    if (
      this.config.maxInvocationsPerMinute !== null &&
      this.config.maxInvocationsPerMinute !== undefined
    ) {
      const now = Date.now();
      // eslint-disable-next-line security/detect-object-injection -- agentId from orchestration graph state
      const timestamps = state.invocationTimestamps[agentId] ?? [];
      const recentCount = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS).length;

      if (recentCount >= this.config.maxInvocationsPerMinute) {
        const result: BudgetCheckResult = {
          allowed: false,
          reason: `Agent ${agentId} exceeded rate limit (${recentCount}/${this.config.maxInvocationsPerMinute} per minute)`,
          budgetType: 'rate_limit',
          current: recentCount,
          limit: this.config.maxInvocationsPerMinute,
        };
        this.logger?.budgetExceeded(
          traceId,
          agentId,
          'rate_limit',
          recentCount,
          this.config.maxInvocationsPerMinute
        );
        return result;
      }
    }

    this.logger?.budgetCheck(traceId, agentId, true);
    return { allowed: true };
  }

  /**
   * Atomically check budget AND reserve tokens for an in-flight request.
   * This prevents concurrent workers in free_chat mode from both passing
   * checkBudget() before either records actual usage.
   *
   * Call releaseReservation() on error, or recordUsage() on success
   * (which clears the reservation automatically).
   */
  reserveBudget(
    sessionId: string,
    agentId: string,
    traceId: string,
    estimatedTokens?: number
  ): BudgetCheckResult {
    const check = this.checkBudget(sessionId, agentId, traceId);
    if (!check.allowed) return check;

    // Reserve tokens synchronously (no await between check and reserve)
    const state = this.getOrCreateState(sessionId);
    const reservation = estimatedTokens ?? DEFAULT_RESERVATION_TOKENS;
    // eslint-disable-next-line security/detect-object-injection -- agentId from orchestration graph state
    state.reservedTokens[agentId] = (state.reservedTokens[agentId] ?? 0) + reservation;

    return { allowed: true };
  }

  /**
   * Release a reservation without recording actual usage (e.g., on error/timeout).
   */
  releaseReservation(sessionId: string, agentId: string, estimatedTokens?: number): void {
    const state = this.states.get(sessionId);
    if (!state) return;

    const reservation = estimatedTokens ?? DEFAULT_RESERVATION_TOKENS;
    // eslint-disable-next-line security/detect-object-injection -- agentId from orchestration graph state
    const current = state.reservedTokens[agentId] ?? 0;
    const remaining = current - reservation;
    if (remaining <= 0) {
      // eslint-disable-next-line security/detect-object-injection -- agentId from orchestration graph state
      delete state.reservedTokens[agentId];
    } else {
      // eslint-disable-next-line security/detect-object-injection -- agentId from orchestration graph state
      state.reservedTokens[agentId] = remaining;
    }
  }

  /**
   * Post-flight: record actual token usage from LLM response.
   * Automatically clears the reservation for this agent.
   */
  recordUsage(sessionId: string, agentId: string, tokenUsage: TokenUsage): void {
    const state = this.getOrCreateState(sessionId);

    // eslint-disable-next-line security/detect-object-injection -- agentId from orchestration graph state
    delete state.reservedTokens[agentId];

    // eslint-disable-next-line security/detect-object-injection -- agentId from orchestration graph state
    const existing = state.agentTokenUsage[agentId] ?? {
      input: 0,
      output: 0,
    };
    // eslint-disable-next-line security/detect-object-injection -- agentId from orchestration graph state
    state.agentTokenUsage[agentId] = {
      input: existing.input + tokenUsage.inputTokens,
      output: existing.output + tokenUsage.outputTokens,
    };

    // Update total tokens
    state.totalTokens += tokenUsage.inputTokens + tokenUsage.outputTokens;

    // eslint-disable-next-line security/detect-object-injection -- agentId from orchestration graph state
    if (!state.invocationTimestamps[agentId]) {
      // eslint-disable-next-line security/detect-object-injection -- agentId from orchestration graph state
      state.invocationTimestamps[agentId] = [];
    }

    const now = Date.now();
    // eslint-disable-next-line security/detect-object-injection -- agentId from orchestration graph state
    state.invocationTimestamps[agentId]!.push(now);

    // eslint-disable-next-line security/detect-object-injection -- agentId from orchestration graph state
    state.invocationTimestamps[agentId] =
      // eslint-disable-next-line security/detect-object-injection -- agentId from orchestration graph state
      state.invocationTimestamps[agentId]!.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  }

  /**
   * Get current budget status for a session.
   */
  getStatus(sessionId: string): BudgetStatus {
    const state = this.getOrCreateState(sessionId);

    const agentUsage: Record<string, TokenUsage> = {};
    for (const [agentId, usage] of Object.entries(state.agentTokenUsage)) {
      // eslint-disable-next-line security/detect-object-injection -- agentId from Object.entries iteration
      agentUsage[agentId] = {
        inputTokens: usage.input,
        outputTokens: usage.output,
      };
    }

    return {
      sessionId,
      agentUsage,
      totalTokens: state.totalTokens,
      limits: {
        perAgentPerSession: this.config?.maxTokensPerAgentPerSession ?? null,
        perSession: this.config?.maxTokensPerSession ?? null,
        perMinute: this.config?.maxInvocationsPerMinute ?? null,
      },
    };
  }

  /**
   * Remove all budget state for a session (call on session end).
   */
  clearSession(sessionId: string): void {
    this.states.delete(sessionId);
  }

  /**
   * Remove all tracked budget state across all sessions.
   */
  dispose(): void {
    this.states.clear();
  }

  private getOrCreateState(sessionId: string): BudgetState {
    let state = this.states.get(sessionId);
    if (!state) {
      state = {
        sessionId,
        agentTokenUsage: {},
        totalTokens: 0,
        invocationTimestamps: {},
        reservedTokens: {},
      };
      this.states.set(sessionId, state);
    }
    return state;
  }
}
