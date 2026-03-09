/**
 * ACP shim entry point — drop-in replacement for @github/copilot-sdk.
 *
 * Exports the same API surface so that `import { CopilotClient } from '@github/copilot-sdk'`
 * works unchanged in the engine.
 */

export { CopilotClient } from './client.js';
export type { AcpSessionConfig } from './session.js';

/** No-op stub for tool definition (not used by engine, but exported by the real SDK) */
export function defineTool(): unknown {
  return {};
}

/** Convenience helper matching SDK v0.1.28's approveAll export */
export const approveAll = (): { kind: 'approved' } => ({ kind: 'approved' as const });
