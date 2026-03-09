import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { Participant } from '@cebus/engine';
import type { AgentActivityEntry } from '../chat-types';
import { MAX_ICON_WIDTH, CONTENT_PADDING, resolveProviderStyle } from '../ui/constants';

export interface ThinkingIndicatorProps {
  participants: Participant[];
  agentActivity?: Map<string, AgentActivityEntry[]> | undefined;
  reasoningContent?: Map<string, string> | undefined;
  waiting?: boolean | undefined;
  expanded?: boolean | undefined;
}

export function ThinkingIndicator({
  participants,
  agentActivity,
  reasoningContent,
  waiting = false,
  expanded = false,
}: ThinkingIndicatorProps): React.ReactElement | null {
  if (participants.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {participants.map(p => {
        const entries = agentActivity?.get(p.id);
        const reasoning = reasoningContent?.get(p.id);
        const style = resolveProviderStyle(
          p.providerId?.toLowerCase() ?? 'default',
          p.modelId ?? null
        );
        const iconPad = ' '.repeat(MAX_ICON_WIDTH - style.iconWidth);

        if (!entries || entries.length === 0) {
          const reasoningLines = reasoning?.split('\n').slice(-3) ?? [];
          const statusLabel = waiting
            ? 'waiting'
            : reasoning !== undefined && reasoning.length > 0
              ? 'reasoning'
              : 'is thinking';
          return (
            <Box key={p.id} flexDirection="column">
              <Box>
                <Text color={style.color}>
                  <Spinner type="dots" />
                  {iconPad} <Text bold>{p.displayName}</Text>
                </Text>
              </Box>
              <Box paddingLeft={CONTENT_PADDING}>
                <Text dimColor>
                  ⎿ {statusLabel}
                  <Spinner type="simpleDots" />
                </Text>
              </Box>
              {reasoningLines.length > 0 && (
                <Box flexDirection="column" paddingLeft={CONTENT_PADDING}>
                  {reasoningLines.map((line, i) => (
                    <Text key={i} dimColor>
                      {line.slice(0, 80)}
                    </Text>
                  ))}
                </Box>
              )}
            </Box>
          );
        }

        const MAX_VISIBLE = 4;
        const lastIndex = entries.length - 1;
        // eslint-disable-next-line security/detect-object-injection -- index from computed length
        const lastEntry = entries[lastIndex];
        const hasActiveToolCall = lastEntry !== undefined && lastEntry.result === undefined;
        const hiddenCount = expanded ? 0 : Math.max(0, entries.length - MAX_VISIBLE);
        const visibleEntries = hiddenCount > 0 ? entries.slice(-MAX_VISIBLE) : entries;

        const activeEntry = hasActiveToolCall ? lastEntry : undefined;
        const completedEntries = activeEntry
          ? visibleEntries.slice(0, visibleEntries.length - 1)
          : visibleEntries;

        const reasoningLines = reasoning?.split('\n').slice(-3) ?? [];

        return (
          <Box key={p.id} flexDirection="column">
            <Box>
              <Text color={style.color}>
                <Spinner type="dots" />
                {iconPad} <Text bold>{p.displayName}</Text>
              </Text>
            </Box>
            {hiddenCount > 0 && (
              <Box paddingLeft={CONTENT_PADDING}>
                <Text dimColor>
                  {'... '}
                  {hiddenCount} more{' '}
                </Text>
                <Text color="gray">(Tab to expand)</Text>
              </Box>
            )}
            {expanded && entries.length > MAX_VISIBLE && (
              <Box paddingLeft={CONTENT_PADDING}>
                <Text color="gray">(Tab to collapse)</Text>
              </Box>
            )}
            {completedEntries.map((entry, i) => {
              const hasResult = entry.result !== undefined;
              return (
                <Box key={hiddenCount + i} flexDirection="column">
                  <Box paddingLeft={CONTENT_PADDING}>
                    <Text color="green">{'✓ '}</Text>
                    <Text>{entry.activity}</Text>
                  </Box>
                  {hasResult && (
                    <Box paddingLeft={CONTENT_PADDING}>
                      <Text dimColor>
                        {'  └ '}
                        {entry.result}
                      </Text>
                    </Box>
                  )}
                </Box>
              );
            })}
            {activeEntry && activeEntry.activity && (
              <Box paddingLeft={CONTENT_PADDING}>
                <Text color="cyan">
                  <Spinner type="dots" /> {activeEntry.activity}
                </Text>
              </Box>
            )}
            {!activeEntry && reasoningLines.length > 0 && (
              <Box paddingLeft={CONTENT_PADDING}>
                <Text dimColor>
                  ⎿ reasoning
                  <Spinner type="simpleDots" />
                </Text>
              </Box>
            )}
            {reasoningLines.length > 0 && (
              <Box flexDirection="column" paddingLeft={CONTENT_PADDING}>
                {reasoningLines.map((line, i) => (
                  <Text key={i} dimColor>
                    {line.slice(0, 80)}
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
