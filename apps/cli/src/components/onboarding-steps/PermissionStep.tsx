/**
 * PermissionStep — asks user whether to allow directory access.
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { OnboardingAction } from './types';

export interface PermissionStepProps {
  workingDir: string;
  dispatch: (action: OnboardingAction) => void;
  isActive: boolean;
}

export function PermissionStep({
  workingDir,
  dispatch,
  isActive,
}: PermissionStepProps): React.ReactElement {
  useInput(
    (input, key) => {
      if (!isActive) return;

    if (key.escape) {
      dispatch({ type: 'requestExit' });
      return;
    }
    if (input.toLowerCase() === 'y' || key.return) {
      dispatch({ type: 'setFolderAccess', value: true });
      dispatch({ type: 'goToStep', step: 'cost-preference' });
    } else if (input.toLowerCase() === 'n') {
      dispatch({ type: 'setFolderAccess', value: false });
      dispatch({ type: 'goToStep', step: 'cost-preference' });
    }
  }, { isActive });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Allow Directory Access
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text>Cebus can read files in this folder to give context-aware answers:</Text>
      </Box>

      <Box marginBottom={1} paddingLeft={2}>
        <Text color="yellow">{workingDir}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>Yes = AI models see your project files for better answers.</Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>No = Chat-only mode, no file access. You can still talk to models.</Text>
      </Box>

      <Box>
        <Text>
          Allow folder access? <Text color="green">[Y]es</Text> / <Text color="yellow">[N]o</Text>
        </Text>
      </Box>
    </Box>
  );
}
