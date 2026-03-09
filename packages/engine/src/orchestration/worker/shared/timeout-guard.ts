/**
 * Shared timeout/cancellation guard for workers.
 *
 * Both LangChainWorker and ProviderAdapterWorker use the same pattern:
 * - Set a timeout timer
 * - Listen for cancellation via AbortSignal
 * - Race the operation against timeout/cancel
 */

import { OrchestrationError } from '../../types.js';

export interface TimeoutRaceResult<T> {
  promise: Promise<T>;
  cleanup: () => void;
}

/**
 * Create a timeout+cancellation race for a worker operation.
 *
 * Returns a promise that rejects if the timeout or cancellation fires before
 * the operation completes, plus a cleanup function to clear the timer.
 */
export function createTimeoutRace<T>(
  agentId: string,
  traceId: string,
  timeoutMs: number,
  cancellationToken: AbortSignal | undefined,
  operation: Promise<T>,
): TimeoutRaceResult<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new OrchestrationError(
          'TIMEOUT',
          `Worker ${agentId} exceeded timeout of ${timeoutMs}ms`,
          traceId,
        ),
      );
    }, timeoutMs);

    if (cancellationToken && typeof cancellationToken.addEventListener === 'function') {
      if (cancellationToken.aborted) {
        clearTimeout(timer);
        reject(new OrchestrationError('CANCELLED', `Worker ${agentId} was cancelled`, traceId));
        return;
      }
      cancellationToken.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(
          new OrchestrationError(
            'CANCELLED',
            `Worker ${agentId} was cancelled`,
            traceId,
          ),
        );
      }, { once: true });
    }
  });

  const racePromise = Promise.race([operation, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });

  return {
    promise: racePromise,
    cleanup: () => clearTimeout(timer),
  };
}
