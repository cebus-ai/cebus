import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PermissionKind } from '@cebus/engine';

export interface ToolApprovalPromptProps {
  agentName: string;
  permissionKind: PermissionKind;
  toolName: string;
  parameters: Record<string, unknown>;
  onRespond: (approved: boolean, budget: number) => void;
}

/** -1 = unlimited for current response, 1 = once, -2 = session-level for this kind */
interface ApprovalOption {
  label: string;
  approved: boolean;
  budget: number;
}

const OPTIONS: ApprovalOption[] = [
  { label: 'Allow once', approved: true, budget: 1 },
  { label: 'Allow for session', approved: true, budget: -1 },
  { label: 'Deny', approved: false, budget: 0 },
];

function describeKind(kind: PermissionKind): string {
  switch (kind) {
    case 'shell':
      return 'run a shell command';
    case 'write':
      return 'write a file';
    case 'mcp':
      return 'use an MCP tool';
    case 'read':
      return 'read a file';
    case 'url':
      return 'fetch a URL';
  }
}

function describeDetail(params: Record<string, unknown>): string | undefined {
  const path = params['path'] ?? params['filePath'] ?? params['file'];
  if (typeof path === 'string') return path;
  const command = params['command'] ?? params['cmd'];
  if (typeof command === 'string') return command;
  const toolName = params['toolName'];
  if (typeof toolName === 'string') return toolName;
  return undefined;
}

export function ToolApprovalPrompt({
  agentName,
  permissionKind,
  toolName,
  parameters,
  onRespond,
}: ToolApprovalPromptProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : OPTIONS.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => (prev < OPTIONS.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      // eslint-disable-next-line security/detect-object-injection -- index from bounded state
      const option = OPTIONS[selectedIndex];
      if (option) {
        onRespond(option.approved, option.budget);
      }
    }
  });

  const detail = describeDetail(parameters);

  return (
    <Box
      flexDirection="column"
      marginY={1}
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
    >
      <Text color="yellow" bold>
        {agentName} wants to {describeKind(permissionKind)}:
      </Text>
      {detail !== undefined && detail.length > 0 && <Text dimColor> {detail}</Text>}
      {(detail === undefined || detail.length === 0) && toolName.length > 0 && (
        <Text dimColor> {toolName}</Text>
      )}
      <Text> </Text>
      {OPTIONS.map((option, index) => (
        <Text key={option.label}>
          {index === selectedIndex ? (
            <Text color="yellow" bold>
              {'  > '}
              {option.label}
            </Text>
          ) : (
            <Text dimColor>
              {'    '}
              {option.label}
            </Text>
          )}
        </Text>
      ))}
    </Box>
  );
}
