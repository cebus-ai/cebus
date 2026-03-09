import React from 'react';
import { Box, Text } from 'ink';
import { MarkdownText } from '../MarkdownText';
import { getRoleTemplate } from '@cebus/engine';
import {
  MAX_ICON_WIDTH,
  USER_COLOR,
  USER_ICON,
  USER_ICON_WIDTH,
  CONTENT_PADDING,
  ORCHESTRATOR_STYLE,
  TEAM_LEADER_STYLE,
  resolveProviderStyle,
} from '../../ui/constants';
import type { Participant } from '@cebus/engine';
import type { StaticEntry } from '../../chat-types';

type ParticipantStyle = { color: string; icon: string; iconWidth: number };

/** Resolve the display style for a participant (icon, color, width). */
export function getParticipantStyle(
  participantId: string,
  isUser: boolean,
  participantMap: Map<string, Participant>,
  orchestratorParticipantId: string | undefined
): ParticipantStyle {
  if (isUser) {
    return { color: USER_COLOR, icon: USER_ICON, iconWidth: USER_ICON_WIDTH };
  }
  if (participantId === orchestratorParticipantId) {
    return ORCHESTRATOR_STYLE;
  }
  const participant = participantMap.get(participantId);
  const providerId = participant?.providerId?.toLowerCase() ?? 'default';
  return resolveProviderStyle(providerId, participant?.modelId);
}

interface StaticEntryRendererProps {
  entry: StaticEntry;
  participantMap: Map<string, Participant>;
  orchestratorParticipantId: string | undefined;
  showTimestamps: boolean;
}

export function StaticEntryRenderer({
  entry,
  participantMap,
  orchestratorParticipantId,
  showTimestamps,
}: StaticEntryRendererProps): React.ReactElement {
  if (entry.kind === 'message') {
    const message = entry.message;
    const sender = participantMap.get(message.senderId);
    const isUser = message.type === 'user';
    const {
      color: senderColor,
      icon: senderIcon,
      iconWidth,
    } = getParticipantStyle(message.senderId, isUser, participantMap, orchestratorParticipantId);
    const iconPad = ' '.repeat(MAX_ICON_WIDTH - iconWidth);
    const timeStr = new Date(message.timestamp).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    return (
      <Box key={entry.id} flexDirection="column" marginTop={1}>
        <Box>
          <Text color={senderColor}>
            {senderIcon}
            {iconPad} <Text bold>{sender?.displayName ?? 'Unknown'}</Text>
          </Text>
          {sender?.role !== undefined && sender.role.length > 0 && (
            <Text color="#b0b0b0"> [{getRoleTemplate(sender.role)?.label ?? sender.role}]</Text>
          )}
          {}
          {isUser && message.directedTo && message.directedTo.length > 0 && (
            <Text dimColor>
              {' '}
              {'\u2192'}{' '}
              {message.directedTo.map(id => participantMap.get(id)?.displayName ?? id).join(', ')}
            </Text>
          )}
          {showTimestamps && <Text dimColor> {timeStr}</Text>}
          {message.status === 'error' && (
            <Text color="redBright" bold>
              {' '}
              ✗
            </Text>
          )}
        </Box>
        {isUser && message.content.includes('\n') && message.content.length > 200 ? (
          <Box
            paddingLeft={CONTENT_PADDING}
            flexDirection="column"
          >
            <Box
              borderStyle="round"
              borderColor="gray"
              paddingX={2}
              paddingY={1}
              flexDirection="column"
            >
              <MarkdownText content={message.content} />
            </Box>
          </Box>
        ) : (
          <Box paddingLeft={CONTENT_PADDING}>
            <MarkdownText content={message.content} />
          </Box>
        )}
        {}
        {message.status === 'error' && message.completionMeta?.error && (
          <Box paddingLeft={CONTENT_PADDING}>
            <Text color="redBright" bold>
              Error: {message.completionMeta.error.message}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  if (entry.kind === 'stream-header') {
    const sender = participantMap.get(entry.senderId);
    const {
      color: senderColor,
      icon: senderIcon,
      iconWidth,
    } = getParticipantStyle(entry.senderId, false, participantMap, orchestratorParticipantId);
    const iconPad = ' '.repeat(MAX_ICON_WIDTH - iconWidth);
    const timeStr = entry.timestamp.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    return (
      <Box key={entry.id} flexDirection="column" marginTop={1}>
        <Box>
          <Text color={senderColor}>
            {senderIcon}
            {iconPad} <Text bold>{sender?.displayName ?? 'Unknown'}</Text>
          </Text>
          {sender?.role !== undefined && sender.role.length > 0 && (
            <Text color="#b0b0b0"> [{getRoleTemplate(sender.role)?.label ?? sender.role}]</Text>
          )}
          {showTimestamps && <Text dimColor> {timeStr}</Text>}
        </Box>
        {entry.guidance !== undefined && entry.guidance.length > 0 && (
          <Box paddingLeft={CONTENT_PADDING}>
            <Text dimColor italic>{'↳ '}{entry.guidance}</Text>
          </Box>
        )}
      </Box>
    );
  }

  if (entry.kind === 'plan') {
    return (
      <Box
        key={entry.id}
        flexDirection="column"
        marginY={1}
        borderStyle="round"
        borderColor={entry.approved ? 'green' : 'red'}
        paddingX={2}
        paddingY={1}
      >
        <Text color="magenta" bold>
          Team Leader plan {entry.approved ? '(approved)' : '(rejected)'}:
        </Text>
        <Text dimColor>{entry.plan.description}</Text>
        <Box flexDirection="column" marginTop={1}>
          {entry.plan.steps.map((step, i) => (
            <Text key={i}>
              {' '}
              {i + 1}. <Text bold>{step.agentId}</Text>: {step.action}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            Estimated rounds: {entry.plan.estimatedRounds} | Cost: {entry.plan.estimatedCost}
          </Text>
        </Box>
      </Box>
    );
  }

  if (entry.kind === 'tool-activity') {
    return (
      <Box key={entry.id} flexDirection="column" paddingLeft={CONTENT_PADDING}>
        {entry.entries.map((act, i) => (
          <Box key={i} flexDirection="column">
            <Box>
              <Text color="green">{' ✓ '}</Text>
              <Text>{act.activity}</Text>
            </Box>
            {act.result && (
              <Box>
                <Text dimColor>
                  {'    └ '}
                  {act.result}
                </Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>
    );
  }

  if (entry.kind === 'orchestrator-message') {
    const { icon, color } = TEAM_LEADER_STYLE;
    return (
      <Box key={entry.id} flexDirection="column" paddingLeft={1} marginTop={1}>
        <Text color={color} bold>{icon} Team Leader</Text>
        <Text dimColor>{'⎿'} {entry.content}</Text>
      </Box>
    );
  }

  if (entry.kind === 'tl-routing-plan') {
    const { icon, color } = TEAM_LEADER_STYLE;
    return (
      <Box
        key={entry.id}
        flexDirection="column"
        marginY={1}
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
      >
        <Text color={color} bold>
          {icon} Team Leader
        </Text>
        <Text color="cyan" bold>
          {entry.parallel ? '⚡ Parallel dispatch' : '➜ Routing'} — {entry.assignments.length} model{entry.assignments.length > 1 ? 's' : ''}
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {entry.assignments.map((a, i) => (
            <Box key={i} flexDirection="column">
              <Text>
                {'  '}<Text bold color="yellow">{a.agentName}</Text>
              </Text>
              <Text dimColor>{'    '}{a.guidance}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  if (entry.kind === 'tl-message') {
    const { color, icon, iconWidth } = TEAM_LEADER_STYLE;
    const iconPad = ' '.repeat(MAX_ICON_WIDTH - iconWidth);
    const timeStr = entry.timestamp.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    if (entry.phase === 'synthesize') {
      return (
        <Box
          key={entry.id}
          flexDirection="column"
          marginY={1}
          borderStyle="round"
          borderColor="magenta"
          paddingX={2}
          paddingY={1}
        >
          <Box>
            <Text color={color} bold>
              {icon}{iconPad} Team Leader — Synthesis
            </Text>
            {showTimestamps && <Text dimColor> {timeStr}</Text>}
          </Box>
          <Box marginTop={1}>
            <MarkdownText content={entry.content} />
          </Box>
        </Box>
      );
    }

    return (
      <Box key={entry.id} flexDirection="column" marginTop={1}>
        <Box>
          <Text color={color}>
            {icon}
            {iconPad} <Text bold>Team Leader</Text>
          </Text>
          {showTimestamps && <Text dimColor> {timeStr}</Text>}
        </Box>
        <Box paddingLeft={CONTENT_PADDING}>
          <MarkdownText content={entry.content} />
        </Box>
      </Box>
    );
  }

  // stream-text — flushed streaming line (spacer entries have whitespace-only content)
  if (entry.content.trim() === '') {
    return <Text key={entry.id}> </Text>;
  }
  return (
    <Box key={entry.id} paddingLeft={CONTENT_PADDING}>
      <MarkdownText content={entry.content} />
    </Box>
  );
}
