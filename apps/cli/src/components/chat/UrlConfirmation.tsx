import React from 'react';
import { Box, Text } from 'ink';
import type { PendingUrlConfirmation } from '../../chat-types';

interface UrlConfirmationProps {
  confirmation: PendingUrlConfirmation;
}

export function UrlConfirmation({ confirmation }: UrlConfirmationProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      marginY={1}
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      <Text color="cyan" bold>
        {'🔗'} URLs detected in your message:
      </Text>
      {confirmation.urls.map((url, i) => (
        <Text key={i} dimColor>
          {' '}
          • {url}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text>
          Fetch content from {confirmation.urls.length === 1 ? 'this URL' : 'these URLs'}?{' '}
        </Text>
        <Text color="green" bold>
          [Y]
        </Text>
        <Text>es / </Text>
        <Text color="red" bold>
          [N]
        </Text>
        <Text>o</Text>
      </Box>
    </Box>
  );
}
