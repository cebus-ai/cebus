import React from 'react';
import { Box, Text, useInput } from 'ink';

interface HelpViewProps {
  onBack: () => void;
}

export function HelpView({ onBack }: HelpViewProps): React.ReactElement {
  useInput((input, key) => {
    if (key.escape || input === 'q') {
      onBack();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        Cebus Commands
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Chat Commands:</Text>
        <Text> /help Show this help</Text>
        <Text> /exit, /quit Exit the chat</Text>
        <Text> /clear Clear chat display</Text>
        <Text> /list Show all participants</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Participant Commands:</Text>
        <Text> /add provider:model[:nickname] Add a model</Text>
        <Text> /remove &lt;nickname&gt; Remove a model</Text>
        <Text> /rename &lt;old&gt; &lt;new&gt; Rename participant</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Addressing Models:</Text>
        <Text> @GPT4 message Send only to GPT4</Text>
        <Text> @Claude @GPT4 msg Send to multiple models</Text>
        <Text> Hey Claude, ... Natural language addressing</Text>
        <Text> (no @mention) Broadcast to all models</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Context Commands:</Text>
        <Text> /context Show current context level</Text>
        <Text> /context none CLAUDE.md only</Text>
        <Text> /context minimal CLAUDE.md + project name + branch (default)</Text>
        <Text> /context full Full context (README, git status, etc.)</Text>
        <Text> /refresh Force context refresh on next message</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Press Esc or 'q' to return to chat</Text>
      </Box>
    </Box>
  );
}
