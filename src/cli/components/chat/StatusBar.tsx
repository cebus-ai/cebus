import React from 'react';
import { Box, Text } from 'ink';
import type { ChatMode } from '../../../core/types';
import { CHAT_MODE_LABELS } from '../../ui/constants';

interface StatusBarProps {
  title: string | undefined;
  participantCount: number;
  modelCount: number;
  chatMode: ChatMode | undefined;
  orchestratorModelId: string | undefined;
  isStreaming?: boolean | undefined;
  compact?: boolean | undefined;
}

export function StatusBar({
  title,
  participantCount,
  modelCount,
  chatMode,
  orchestratorModelId,
  compact = false,
}: StatusBarProps): React.ReactElement {
  const displayName = title ?? 'Cebus';

  if (compact) {
    return (
      <Box marginBottom={1}>
        <Text>{'\uD83D\uDC12'} </Text>
        <Text bold color="cyan">
          {displayName}
        </Text>
        <Text dimColor> • {modelCount} models</Text>
      </Box>
    );
  }

  return (
    <Box marginBottom={1}>
      <Text>{'\uD83D\uDC12'} </Text>
      <Text bold color="cyan">
        {displayName}
      </Text>
      <Text dimColor>
        {' '}
        • {participantCount} participants • {modelCount} models
      </Text>
      {chatMode && <Text dimColor> • {CHAT_MODE_LABELS[chatMode]}</Text>}
      {orchestratorModelId && <Text dimColor> • Orchestrator ({orchestratorModelId})</Text>}
    </Box>
  );
}
