/* eslint-disable no-console -- intentional CLI stdout output for exit summary */
import { formatTokens } from '../ui/constants.js';
import { formatCostUSD } from '@cebus/engine';

/** Per-model token usage for the exit summary breakdown. */
export interface ModelUsageStats {
  nickname: string;
  providerId: string;
  promptTokens: number;
  completionTokens: number;
  cacheTokens: number;
  premiumRequests: number;
  estimatedCostUSD?: number | undefined;
}

export interface SessionStats {
  /** Session start time */
  startTime: Date;

  /** Number of user messages sent */
  userMessageCount: number;

  /** Number of model responses received */
  modelResponseCount: number;

  /** Total models used */
  modelsUsed: string[];

  /** Session ID for resume */
  sessionId: string;

  /** Total prompt tokens used */
  promptTokens?: number;

  /** Total completion tokens used */
  completionTokens?: number;

  /** Total cache read tokens */
  cacheReadTokens?: number;

  /** Total cache write tokens */
  cacheWriteTokens?: number;

  /** Per-model usage breakdown */
  perModelUsage?: ModelUsageStats[];

  /** OpenRouter remaining credit balance */
  openRouterCredits?: number | undefined;
}

function formatDuration(startTime: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - startTime.getTime();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function printExitSummary(stats: SessionStats, version = '0.2.0'): void {
  const sessionDuration = formatDuration(stats.startTime);
  const promptTokensStr = formatTokens(stats.promptTokens ?? 0);
  const completionTokensStr = formatTokens(stats.completionTokens ?? 0);

  const boxInner = 50;
  const line = '─'.repeat(boxInner);

  function padLine(visible: string, visibleLen: number): string {
    return visible + ' '.repeat(Math.max(0, boxInner - visibleLen));
  }

  const line1Text = ` ○○  Cebus v${version}`;
  const line2Text = ' ●●● Session ended';

  console.log('');
  console.log(`\x1b[36m╭${line}╮\x1b[0m`);
  console.log(
    `\x1b[36m│\x1b[0m${padLine(`\x1b[36m ○○\x1b[0m  \x1b[1mCebus\x1b[0m \x1b[2mv${version}\x1b[0m`, line1Text.length)}\x1b[36m│\x1b[0m`
  );
  console.log(
    `\x1b[36m│\x1b[0m${padLine(`\x1b[32m ●●●\x1b[0m \x1b[2mSession ended\x1b[0m`, line2Text.length)}\x1b[36m│\x1b[0m`
  );
  console.log(`\x1b[36m╰${line}╯\x1b[0m`);
  console.log('');
  console.log(`  Messages sent:      ${stats.userMessageCount}`);
  console.log(`  Model responses:    ${stats.modelResponseCount}`);
  console.log(`  Session time:       ${sessionDuration}`);
  console.log(
    `  Tokens:             \x1b[33m${promptTokensStr} in\x1b[0m, \x1b[32m${completionTokensStr} out\x1b[0m`
  );
  console.log(`  Models used:        \x1b[36m${stats.modelsUsed.join(', ') || 'None'}\x1b[0m`);
  console.log('');
  if (stats.perModelUsage && stats.perModelUsage.length > 0) {
    console.log('  Breakdown by model:');
    for (const model of stats.perModelUsage) {
      const inStr = formatTokens(model.promptTokens);
      const outStr = formatTokens(model.completionTokens);
      let line = `    ${model.nickname} (${model.providerId}): \x1b[33m${inStr} in\x1b[0m, \x1b[32m${outStr} out\x1b[0m`;
      if (model.cacheTokens > 0) {
        line += `, \x1b[36m${formatTokens(model.cacheTokens)} cached\x1b[0m`;
      }
      if (model.premiumRequests > 0) {
        line += ` | Premium requests: ${model.premiumRequests}`;
      }
      if (model.estimatedCostUSD !== undefined && model.estimatedCostUSD > 0) {
        line += ` | \x1b[33m${formatCostUSD(model.estimatedCostUSD)}\x1b[0m`;
      }
      console.log(line);
    }
    const totalCost = stats.perModelUsage.reduce((sum, m) => sum + (m.estimatedCostUSD ?? 0), 0);
    if (totalCost > 0) {
      console.log(`  Estimated cost:     \x1b[33m${formatCostUSD(totalCost)}\x1b[0m`);
    }
    if (stats.openRouterCredits !== undefined) {
      const color = stats.openRouterCredits < 1 ? '31' : stats.openRouterCredits <= 5 ? '33' : '32';
      console.log(
        `  OpenRouter credit:  \x1b[${color}m$${stats.openRouterCredits.toFixed(2)}\x1b[0m`
      );
    }
    console.log('');
  }

  if (!stats.perModelUsage?.length && stats.openRouterCredits !== undefined) {
    const color = stats.openRouterCredits < 1 ? '31' : stats.openRouterCredits <= 5 ? '33' : '32';
    console.log(
      `  OpenRouter credit:  \x1b[${color}m$${stats.openRouterCredits.toFixed(2)}\x1b[0m`
    );
    console.log('');
  }

  console.log(`  Resume session with \x1b[36mcebus --resume ${stats.sessionId.slice(0, 8)}\x1b[0m`);
  console.log('');
}
