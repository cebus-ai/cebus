/**
 * Task Completion Card
 *
 * Renders a bordered summary card for multi-round supervised task completions.
 * Shows executive summary, per-round agent actions, and task metadata.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { TaskCompletionSummary } from '@cebus/engine';

interface TaskCompletionCardProps {
  summary: TaskCompletionSummary;
}

export function TaskCompletionCard({ summary }: TaskCompletionCardProps): React.ReactElement {
  const { executiveSummary, contributions, metadata } = summary;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={2} paddingY={1}>
      {/* Header */}
      <Box>
        <Text color="green" bold>
          {'✓ Task Complete'}
        </Text>
        <Text dimColor>
          {' '}
          | {metadata.complexity} | {metadata.totalRounds}/{metadata.maxRounds} rounds
        </Text>
      </Box>

      {/* Executive Summary */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Summary</Text>
        <Box paddingLeft={1}>
          <Text wrap="wrap">{executiveSummary}</Text>
        </Box>
      </Box>

      {/* Rounds — one compact line per contribution */}
      {contributions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Rounds</Text>
          {contributions.map((contrib, i) => (
            <Box key={`${contrib.agentId}-${contrib.round}-${i}`} paddingLeft={1}>
              <Text dimColor>{contrib.round}. </Text>
              <Text bold color="cyan">
                {contrib.agentName}
              </Text>
              <Text dimColor> — {truncate(contrib.action, 80)}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Intent */}
      <Box marginTop={1}>
        <Text dimColor>Intent: {metadata.intent}</Text>
        {metadata.planDescription !== undefined && metadata.planDescription.length > 0 && (
          <Text dimColor> | Plan: {truncate(metadata.planDescription, 50)}</Text>
        )}
      </Box>
    </Box>
  );
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
