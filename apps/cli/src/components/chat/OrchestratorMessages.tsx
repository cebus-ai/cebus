import React from 'react';
import { Box, Text } from 'ink';
import { MarkdownText } from '../MarkdownText';
import { TaskCompletionCard } from '../TaskCompletionCard';
import { CONTENT_PADDING } from '../../ui/constants';
import type { OrchestratorMessage, PlanProgress, PendingPlanApproval } from '../../chat-types';

const PHASE_ICONS: Record<string, string> = {
  analyzing: '\u25B6',
  planning: '\u2692',
  executing: '\u26A1',
  reviewing: '\u2714',
  complete: '\u2705',
  // TL phases
  clarify: '\u2753',
  plan: '\u2692',
  deliberate: '\u{1F4AC}',
  execute: '\u26A1',
  review: '\u2714',
  synthesize: '\u2728',
  ask_user: '\u270B',
};

const PHASE_COLORS: Record<string, string> = {
  analyzing: 'blue',
  planning: 'magenta',
  executing: 'yellow',
  reviewing: 'cyan',
  complete: 'green',
  // TL phases
  clarify: 'blue',
  plan: 'magenta',
  deliberate: 'cyan',
  execute: 'yellow',
  review: 'cyan',
  synthesize: 'green',
  ask_user: 'magenta',
};

interface OrchestratorMessagesProps {
  messages: OrchestratorMessage[];
  orchestratorModelId: string | undefined;
  showTimestamps: boolean;
}

export function OrchestratorMessagesView({
  messages,
  orchestratorModelId,
  showTimestamps,
}: OrchestratorMessagesProps): React.ReactElement | null {
  if (messages.length === 0) return null;

  return (
    <Box flexDirection="column" marginY={1}>
      {messages.map((msg, i) => {
        if (msg.kind === 'direct') {
          const timeStr = msg.timestamp.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          });
          return (
            <Box key={i} flexDirection="column">
              <Box>
                <Text color="magenta">
                  {'\u25C6'} <Text bold>Team Leader</Text>
                </Text>
                {orchestratorModelId !== undefined && orchestratorModelId.length > 0 && (
                  <Text color="#b0b0b0"> [{orchestratorModelId}]</Text>
                )}
                {showTimestamps && <Text dimColor> {timeStr}</Text>}
              </Box>
              <Box paddingLeft={CONTENT_PADDING}>
                <MarkdownText content={msg.content} />
              </Box>
              <Text> </Text>
            </Box>
          );
        }

        if (msg.kind === 'complete' && msg.taskSummary) {
          return (
            <Box key={i} marginY={1}>
              <TaskCompletionCard summary={msg.taskSummary} />
            </Box>
          );
        }

        if (msg.kind === 'phase') {
          const icon = PHASE_ICONS[msg.phase ?? ''] ?? '\u25B6';
          const color = PHASE_COLORS[msg.phase ?? ''];
          const label = msg.content.length > 0 ? msg.content : (msg.phase ?? 'unknown');
          return (
            <Box key={i} paddingLeft={1}>
              {color !== undefined && color.length > 0 ? (
                <Text color={color}>{icon} {label}</Text>
              ) : (
                <Text>{icon} {label}</Text>
              )}
            </Box>
          );
        }

        if (msg.kind === 'status') {
          return (
            <Box key={i} flexDirection="column">
              <Box>
                <Text color="magenta">
                  {'\u25C6'} <Text bold>Team Leader</Text>
                </Text>
              </Box>
              <Box paddingLeft={CONTENT_PADDING}>
                <MarkdownText content={msg.content} />
              </Box>
            </Box>
          );
        }

        if (msg.kind === 'request') {
          return (
            <Box key={i} paddingLeft={2}>
              <Text dimColor>{'\u2192'} {msg.summary ?? msg.content}</Text>
            </Box>
          );
        }

        if (msg.kind === 'step_result') {
          const stepColor = msg.stepStatus === 'done' ? 'green' : msg.stepStatus === 'failed' ? 'red' : undefined;
          const stepIcon = msg.stepStatus === 'done' ? '\u2713' : msg.stepStatus === 'failed' ? '\u2717' : '\u223C';
          return (
            <Box key={i} flexDirection="column" paddingLeft={1}>
              {stepColor ? (
                <Text color={stepColor}>
                  {stepIcon} {msg.summary ?? msg.content}
                </Text>
              ) : (
                <Text>
                  {stepIcon} {msg.summary ?? msg.content}
                </Text>
              )}
              {msg.nextSummary !== undefined && msg.nextSummary.length > 0 && (
                <Text dimColor>  {'\u2192'} {msg.nextSummary}</Text>
              )}
            </Box>
          );
        }

        return (
          <Box key={i} paddingLeft={1}>
            <Text dimColor>Team Leader: {msg.content}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

interface PlanProgressViewProps {
  planProgress: PlanProgress;
}

export function PlanProgressView({ planProgress }: PlanProgressViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingLeft={1} marginBottom={1}>
      {planProgress.plan.steps.map((step, i) => {
        const isDone = i < planProgress.completed;
        const isActive = i === planProgress.completed && planProgress.activeAgent !== null;
        const icon = isDone ? '\u2713' : isActive ? '\u2192' : '\u00B7';
        const actionText = step.action.length > 70 ? step.action.slice(0, 67) + '...' : step.action;
        return (
          <Box key={i}>
            <Text
              {...(isDone ? { color: 'green' } : isActive ? { color: 'yellow' } : {})}
              dimColor={!isDone && !isActive}
            >
              {icon} {i + 1}. {step.agentId}: {actionText}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

interface PlanApprovalViewProps {
  pendingPlanApproval: PendingPlanApproval;
}

export function PlanApprovalView({
  pendingPlanApproval,
}: PlanApprovalViewProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      marginY={1}
      borderStyle="round"
      borderColor="magenta"
      paddingX={2}
      paddingY={1}
    >
      <Text color="magenta" bold>
        Team Leader proposes a plan:
      </Text>
      <Text dimColor>{pendingPlanApproval.plan.description}</Text>
      <Box flexDirection="column" marginTop={1}>
        {pendingPlanApproval.plan.steps.map((step, i) => (
          <Text key={i}>
            {' '}
            {i + 1}. <Text bold>{step.agentId}</Text>: {step.action}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Estimated rounds: {pendingPlanApproval.plan.estimatedRounds} | Cost:{' '}
          {pendingPlanApproval.plan.estimatedCost}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text>
          Approve?{' '}
          <Text color="green" bold>
            Y
          </Text>
          es /{' '}
          <Text color="red" bold>
            N
          </Text>
          o — or type your feedback in the input box below
        </Text>
      </Box>
    </Box>
  );
}
