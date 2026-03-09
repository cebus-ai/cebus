/**
 * ChatModeStep — lets user pick a chat mode (free_chat / sequential / tag_only).
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { CHAT_MODES, type OnboardingAction } from './types';

export interface ChatModeStepProps {
  dispatch: (action: OnboardingAction) => void;
  isActive: boolean;
}

export function ChatModeStep({ dispatch, isActive }: ChatModeStepProps): React.ReactElement {
  const [focusIndex, setFocusIndex] = useState(1); // Default to sequential (index 1)

  useInput(
    (input, key) => {
      if (!isActive) return;

      if (key.escape) {
        dispatch({ type: 'goBack' });
        return;
      }
      if (key.upArrow) {
        setFocusIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setFocusIndex(prev => Math.min(CHAT_MODES.length - 1, prev + 1));
      } else if (key.return || input === ' ') {
        // eslint-disable-next-line security/detect-object-injection -- index from bounded state
        const selected = CHAT_MODES[focusIndex]!;
        dispatch({ type: 'setChatMode', value: selected.mode });
        // raw bypasses orchestrator + roles — go straight to confirm
        // tag_only bypasses orchestrator — go straight to ask-roles
        if (selected.mode === 'raw') {
          dispatch({ type: 'goToStep', step: 'confirm' });
        } else if (selected.mode === 'tag_only') {
          dispatch({ type: 'goToStep', step: 'ask-roles' });
        } else {
          dispatch({ type: 'goToStep', step: 'ask-orchestrator' });
        }
      }
    },
    { isActive }
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Select Chat Mode
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {CHAT_MODES.map((item, index) => {
          const isFocused = index === focusIndex;

          return (
            <Box key={item.mode} marginY={0}>
              {isFocused ? <Text color="yellow">{'❯ '}</Text> : <Text>{'  '}</Text>}
              <Text color={isFocused ? 'cyan' : 'white'} bold={isFocused}>
                {item.label}
              </Text>
              <Text dimColor> {item.description}</Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate, Enter select, Esc back</Text>
      </Box>
    </Box>
  );
}
