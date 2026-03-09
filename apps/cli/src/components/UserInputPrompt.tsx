import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface UserInputPromptProps {
  agentName: string;
  prompt: string;
  options?: string[] | undefined;
  onSubmit: (answer: string) => void;
  onCancel?: (() => void) | undefined;
}

export function UserInputPrompt({
  agentName,
  prompt,
  options,
  onSubmit,
  onCancel,
}: UserInputPromptProps): React.ReactElement {
  const hasOptions = options !== undefined && options.length > 0;

  if (hasOptions) {
    return (
      <ChoiceSelector
        agentName={agentName}
        prompt={prompt}
        options={options!}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );
  }

  return (
    <FreeformInput
      agentName={agentName}
      prompt={prompt}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
}

function ChoiceSelector({
  agentName,
  prompt,
  options,
  onSubmit,
  onCancel,
}: {
  agentName: string;
  prompt: string;
  options: string[];
  onSubmit: (answer: string) => void;
  onCancel?: (() => void) | undefined;
}): React.ReactElement {
  const totalItems = options.length + 1; // +1 for "Other" option
  const [selected, setSelected] = useState(0);
  const [typing, setTyping] = useState(false);
  const [freeText, setFreeText] = useState('');
  const [cursorPos, setCursorPos] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      if (typing) {
        setTyping(false);
        setFreeText('');
        setCursorPos(0);
        return;
      }
      onCancel?.();
      return;
    }

    if (typing) {
      if (key.return && freeText.trim()) {
        onSubmit(freeText.trim());
        return;
      }
      if (key.backspace || key.delete) {
        if (cursorPos > 0) {
          setFreeText(prev => prev.slice(0, cursorPos - 1) + prev.slice(cursorPos));
          setCursorPos(prev => Math.max(0, prev - 1));
        }
        return;
      }
      if (key.leftArrow) {
        setCursorPos(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.rightArrow) {
        setCursorPos(prev => Math.min(freeText.length, prev + 1));
        return;
      }
      if (!key.ctrl && !key.meta && input) {
        setFreeText(prev => prev.slice(0, cursorPos) + input + prev.slice(cursorPos));
        setCursorPos(prev => prev + input.length);
      }
      return;
    }

    if (key.return) {
      if (selected === options.length) {
        setTyping(true);
        return;
      }
      // eslint-disable-next-line security/detect-object-injection -- index from controlled state
      onSubmit(options[selected]!);
      return;
    }
    if (key.upArrow) {
      setSelected(prev => (prev > 0 ? prev - 1 : totalItems - 1));
      return;
    }
    if (key.downArrow) {
      setSelected(prev => (prev < totalItems - 1 ? prev + 1 : 0));
      return;
    }
    const num = parseInt(input, 10);
    if (num >= 1 && num <= options.length) {
      onSubmit(options[num - 1]!);
    }
  });

  const cols = process.stdout.columns ?? 120;
  const innerWidth = Math.max(cols - 6, 40);

  return (
    <Box flexDirection="column" marginY={1} paddingX={1}>
      <Box>
        <Text dimColor>{'─'.repeat(innerWidth)}</Text>
      </Box>
      <Box marginTop={1} marginBottom={1} paddingLeft={2} flexDirection="column">
        <Box>
          <Text color="magenta" bold>
            {agentName}
          </Text>
          <Text dimColor> is asking you:</Text>
        </Box>
        <Box marginTop={1} paddingLeft={2}>
          <Text wrap="wrap">{prompt}</Text>
        </Box>
      </Box>
      <Box flexDirection="column" paddingLeft={4}>
        {options.map((opt, i) => (
          <Box key={i}>
            {i === selected && !typing ? (
              <Text color="magenta" bold>{'❯ '}{i + 1}. {opt}</Text>
            ) : (
              <Text>{'  '}{i + 1}. {opt}</Text>
            )}
          </Box>
        ))}
        <Box>
          {selected === options.length && !typing ? (
            <Text color="magenta" bold>{'❯ '}{options.length + 1}. Other (type your own)</Text>
          ) : (
            <Text>{'  '}{options.length + 1}. Other (type your own)</Text>
          )}
        </Box>
        {typing && (
          <Box paddingLeft={2} marginTop={1}>
            <Text color="magenta" bold>{'> '}</Text>
            <Text>{freeText.slice(0, cursorPos)}</Text>
            {/* eslint-disable-next-line security/detect-object-injection -- cursor index */}
            <Text backgroundColor="gray" color="white">
              {freeText[cursorPos] ?? ' '}
            </Text>
            <Text>{freeText.slice(cursorPos + 1)}</Text>
          </Box>
        )}
      </Box>
      <Box paddingLeft={2} marginTop={1}>
        {typing ? (
          <>
            <Text dimColor>Enter to submit</Text>
            <Text dimColor> | </Text>
            <Text dimColor>Esc to go back</Text>
          </>
        ) : (
          <>
            <Text dimColor>↑↓ navigate</Text>
            <Text dimColor> | </Text>
            <Text dimColor>Enter select</Text>
            <Text dimColor> | </Text>
            <Text dimColor>1-{options.length} quick pick</Text>
            <Text dimColor> | </Text>
            <Text dimColor>Esc skip</Text>
          </>
        )}
      </Box>
      <Box>
        <Text dimColor>{'─'.repeat(innerWidth)}</Text>
      </Box>
    </Box>
  );
}

function FreeformInput({
  agentName,
  prompt,
  onSubmit,
  onCancel,
}: {
  agentName: string;
  prompt: string;
  onSubmit: (answer: string) => void;
  onCancel?: (() => void) | undefined;
}): React.ReactElement {
  const [value, setValue] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onCancel?.();
      return;
    }
    if (key.return && value.trim()) {
      onSubmit(value.trim());
      return;
    }
    if (key.backspace || key.delete) {
      if (cursorPosition > 0) {
        setValue(prev => prev.slice(0, cursorPosition - 1) + prev.slice(cursorPosition));
        setCursorPosition(prev => Math.max(0, prev - 1));
      }
      return;
    }
    if (key.leftArrow) {
      setCursorPosition(prev => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorPosition(prev => Math.min(value.length, prev + 1));
      return;
    }
    if (!key.ctrl && !key.meta && input) {
      setValue(prev => prev.slice(0, cursorPosition) + input + prev.slice(cursorPosition));
      setCursorPosition(prev => prev + input.length);
    }
  });

  const cols = process.stdout.columns ?? 120;
  const innerWidth = Math.max(cols - 6, 40);

  return (
    <Box flexDirection="column" marginY={1} paddingX={1}>
      <Box>
        <Text dimColor>{'─'.repeat(innerWidth)}</Text>
      </Box>
      <Box marginTop={1} marginBottom={1} paddingLeft={2} flexDirection="column">
        <Box>
          <Text color="magenta" bold>
            {agentName}
          </Text>
          <Text dimColor> is asking you:</Text>
        </Box>
        <Box marginTop={1} paddingLeft={2}>
          <Text wrap="wrap">{prompt}</Text>
        </Box>
      </Box>
      <Box paddingLeft={2}>
        <Text color="magenta" bold>
          {'> '}
        </Text>
        <Text>{value.slice(0, cursorPosition)}</Text>
        {/* eslint-disable-next-line security/detect-object-injection -- index from cursor position */}
        <Text backgroundColor="gray" color="white">
          {value[cursorPosition] ?? ' '}
        </Text>
        <Text>{value.slice(cursorPosition + 1)}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor>Enter to submit</Text>
        <Text dimColor> | </Text>
        <Text dimColor>Esc to skip</Text>
      </Box>
      <Box>
        <Text dimColor>{'─'.repeat(innerWidth)}</Text>
      </Box>
    </Box>
  );
}
