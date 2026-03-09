/**
 * Periodic health check for the shared Copilot CLI server.
 *
 * Pings every 30s. After 3 consecutive failures, triggers a restart callback.
 * Timer is unref'd to not block extension deactivation.
 */

import * as http from 'node:http';

const PING_INTERVAL_MS = 30_000;
const MAX_FAILURES = 3;
const PING_TIMEOUT_MS = 5_000;

export interface HealthCheckCallbacks {
  onHealthy: () => void;
  onUnhealthy: (consecutiveFailures: number) => void;
  onRestartNeeded: () => void;
}

export class CopilotHealthCheck {
  private timer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private port: number;
  private callbacks: HealthCheckCallbacks;

  constructor(port: number, callbacks: HealthCheckCallbacks) {
    this.port = port;
    this.callbacks = callbacks;
  }

  start(): void {
    this.stop();
    this.consecutiveFailures = 0;
    this.timer = setInterval(() => {
      void this.ping();
    }, PING_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  updatePort(port: number): void {
    this.port = port;
    this.consecutiveFailures = 0;
  }

  private async ping(): Promise<void> {
    const reachable = await this.isReachable();
    if (reachable) {
      this.consecutiveFailures = 0;
      this.callbacks.onHealthy();
    } else {
      this.consecutiveFailures++;
      this.callbacks.onUnhealthy(this.consecutiveFailures);
      if (this.consecutiveFailures >= MAX_FAILURES) {
        this.consecutiveFailures = 0;
        this.callbacks.onRestartNeeded();
      }
    }
  }

  private isReachable(): Promise<boolean> {
    return new Promise(resolve => {
      const req = http.get(
        { hostname: '127.0.0.1', port: this.port, path: '/', timeout: PING_TIMEOUT_MS },
        res => {
          res.resume();
          resolve(true);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }
}
