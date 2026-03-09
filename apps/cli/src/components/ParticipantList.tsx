import React from 'react';
import { Box, Text } from 'ink';
import type { Participant } from '@cebus/engine';
import { getRoleTemplate } from '@cebus/engine';

export interface ParticipantListProps {
  /** List of participants to display */
  participants: Participant[];

  /** Show participant details (provider, model) */
  showDetails?: boolean | undefined;

  /** Title for the list */
  title?: string | undefined;

  /** Compact display mode */
  compact?: boolean | undefined;
}

export function ParticipantList({
  participants,
  showDetails = false,
  title = 'Participants',
  compact = false,
}: ParticipantListProps): React.ReactElement {
  const users = participants.filter(p => p.type === 'user');
  const models = participants.filter(p => p.type === 'model');

  if (compact) {
    return (
      <Box>
        <Text dimColor>{title}: </Text>
        {participants.map((p, i) => (
          <React.Fragment key={p.id}>
            <Text color={p.type === 'user' ? 'blue' : 'green'}>@{p.nickname}</Text>
            {i < participants.length - 1 && <Text dimColor>, </Text>}
          </React.Fragment>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{title}</Text>
        <Text dimColor> ({participants.length})</Text>
      </Box>

      {users.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="blue" bold>
            You
          </Text>
          {users.map(user => (
            <ParticipantItem key={user.id} participant={user} showDetails={showDetails} />
          ))}
        </Box>
      )}

      {models.length > 0 && (
        <Box flexDirection="column">
          <Text color="green" bold>
            AI Models
          </Text>
          {models.map(model => (
            <ParticipantItem key={model.id} participant={model} showDetails={showDetails} />
          ))}
        </Box>
      )}
    </Box>
  );
}

interface ParticipantItemProps {
  participant: Participant;
  showDetails?: boolean | undefined;
}

function ParticipantItem({
  participant,
  showDetails = false,
}: ParticipantItemProps): React.ReactElement {
  const isModel = participant.type === 'model';

  return (
    <Box paddingLeft={2} flexDirection="column">
      <Box>
        <Text color={isModel ? 'green' : 'blue'}>• </Text>
        <Text>{participant.displayName}</Text>
        <Text dimColor> (@{participant.nickname})</Text>
        {participant.role !== undefined && participant.role.length > 0 && (
          <Text color="#02e3ff">
            {' '}
            [{getRoleTemplate(participant.role)?.label ?? participant.role}]
          </Text>
        )}
      </Box>

      {showDetails && isModel && (
        <Box paddingLeft={4}>
          <Text dimColor>
            {participant.providerId}/{participant.modelId}
          </Text>
        </Box>
      )}
    </Box>
  );
}
