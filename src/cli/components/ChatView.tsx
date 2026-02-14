import React from 'react';
import { Box, Text } from 'ink';

interface ChatEmptyStateProps {
  compact?: boolean | undefined;
}

export function ChatEmptyState({ compact = false }: ChatEmptyStateProps): React.ReactElement {
  if (compact) {
    return (
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        <Text dimColor>Welcome to Cebus! Type /help for commands.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={2}>
      <Text bold>Welcome to Cebus!</Text>
      <Text dimColor>Start the conversation by typing a message below.</Text>
      <Text dimColor>Use @nickname to direct a message to a specific model.</Text>
      <Text dimColor>Type /help for available commands.</Text>
    </Box>
  );
}
