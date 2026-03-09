/**
 * Shared AbortController management for provider adapters.
 * Tracks active requests and handles cancellation + signal wiring.
 */

interface TrackedRequest {
  controller: AbortController;
  signal?: AbortSignal;
  handler?: () => void;
}

export class RequestTracker {
  private activeRequests = new Map<string, TrackedRequest>();

  /**
   * Track a new request. Creates an AbortController and optionally wires
   * an external signal to abort it.
   * Returns the AbortController for the request.
   */
  track(requestId: string, signal?: AbortSignal): AbortController {
    const controller = new AbortController();
    const tracked: TrackedRequest = { controller };

    if (signal) {
      const handler = (): void => controller.abort();
      signal.addEventListener('abort', handler);
      tracked.signal = signal;
      tracked.handler = handler;
    }

    this.activeRequests.set(requestId, tracked);
    return controller;
  }

  /**
   * Remove a completed request from tracking.
   */
  remove(requestId: string): void {
    const tracked = this.activeRequests.get(requestId);
    if (tracked?.signal && tracked.handler) {
      tracked.signal.removeEventListener('abort', tracked.handler);
    }
    this.activeRequests.delete(requestId);
  }

  /**
   * Cancel a specific request by ID.
   */
  cancel(requestId: string): void {
    const tracked = this.activeRequests.get(requestId);
    if (tracked) {
      tracked.controller.abort();
      if (tracked.signal && tracked.handler) {
        tracked.signal.removeEventListener('abort', tracked.handler);
      }
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * Cancel all active requests (used during dispose).
   */
  cancelAll(): void {
    for (const tracked of this.activeRequests.values()) {
      tracked.controller.abort();
      if (tracked.signal && tracked.handler) {
        tracked.signal.removeEventListener('abort', tracked.handler);
      }
    }
    this.activeRequests.clear();
  }
}
