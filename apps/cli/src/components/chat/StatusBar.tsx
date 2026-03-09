import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { ChatMode } from '@cebus/engine';
import { CHAT_MODE_LABELS } from '../../ui/constants';

interface StatusBarProps {
  title: string | undefined;
  participantCount: number;
  modelCount: number;
  chatMode: ChatMode | undefined;
  orchestratorModelId: string | undefined;
  isStreaming?: boolean | undefined;
  thinkingNames?: string[] | undefined;
  copilotQuota?: { used: number; total: number; remaining: number } | undefined;
}

export function StatusBar({
  title,
  participantCount,
  modelCount,
  chatMode,
  orchestratorModelId,
  copilotQuota,
  thinkingNames,
}: StatusBarProps): React.ReactElement {
  const displayName = title ?? 'Cebus';

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
      {chatMode !== undefined && chatMode.length > 0 && (
        // eslint-disable-next-line security/detect-object-injection -- chatMode is a typed union
        <Text dimColor> • {CHAT_MODE_LABELS[chatMode]}</Text>
      )}
      {orchestratorModelId !== undefined && orchestratorModelId.length > 0 && (
        <Text dimColor> • Team Leader ({orchestratorModelId})</Text>
      )}
      {copilotQuota !== undefined && copilotQuota.total > 0 && (
        <>
          <Text dimColor> │ Copilot: </Text>
          <Text color={copilotQuota.remaining < 10 ? 'yellow' : 'green'}>
            {copilotQuota.used}/{copilotQuota.total} premium ({copilotQuota.remaining} left)
          </Text>
        </>
      )}
      {thinkingNames && thinkingNames.length > 0 && (
        <>
          <Text dimColor> │ </Text>
          <Spinner type="dots" />
          <Text dimColor> {thinkingNames.join(', ')} thinking...</Text>
        </>
      )}
    </Box>
  );
}
