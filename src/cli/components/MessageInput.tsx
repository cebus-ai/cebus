import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { Participant } from '../../core/types';
import { parseMentions as coreParseMentions } from '../../core/mention-parser';
import { getRoleTemplate } from '../../core/role-templates';
import { useBracketedPaste } from '../hooks/useBracketedPaste';

export interface MessageInputProps {
  /** Callback when message is submitted */
  onSubmit: (content: string, directedTo?: string[]) => void;

  /** Callback when user wants to exit */
  onExit?: (() => void) | undefined;

  /** Callback for slash commands */
  onCommand?: ((command: string, args: string[]) => void) | undefined;

  /** Available participants for @mentions */
  participants?: Participant[] | undefined;

  /** Placeholder text */
  placeholder?: string | undefined;

  /** Whether input is disabled */
  disabled?: boolean | undefined;

  /** Currently selected target (for model selector) */
  selectedTarget?: Participant | 'all' | undefined;

  /** Callback to cancel all streaming agents (Esc when input empty + streaming) */
  onCancelStream?: (() => void) | undefined;

  /** Whether agents are currently streaming */
  isStreaming?: boolean | undefined;

  /** Compact rendering for small terminals */
  compact?: boolean | undefined;
}

interface SlashCommand {
  name: string;
  description: string;
}

const AVAILABLE_COMMANDS: SlashCommand[] = [
  { name: 'exit', description: 'Exit the chat and show session summary' },
  { name: 'quit', description: 'Same as /exit' },
  { name: 'help', description: 'Show available commands' },
  { name: 'clear', description: 'Clear chat display' },
  { name: 'list', description: 'Show all participants' },
  { name: 'add', description: 'Add a model (provider:model[:nickname])' },
  { name: 'remove', description: 'Remove a model by nickname' },
  { name: 'rename', description: 'Rename a participant' },
];

interface MentionContext {
  isActive: boolean;
  query: string;
  startIndex: number;
}

function getMentionContext(value: string, cursorPosition: number): MentionContext {
  let startIndex = -1;
  for (let i = cursorPosition - 1; i >= 0; i--) {
    const char = value[i];
    if (char === '@') {
      startIndex = i;
      break;
    }
    if (char === ' ' || char === '\n') {
      break;
    }
  }

  if (startIndex === -1) {
    return { isActive: false, query: '', startIndex: -1 };
  }

  const query = value.slice(startIndex + 1, cursorPosition).toLowerCase();
  return { isActive: true, query, startIndex };
}

interface CommandContext {
  isActive: boolean;
  query: string;
}

function getCommandContext(value: string, cursorPosition: number): CommandContext {
  if (!value.startsWith('/')) {
    return { isActive: false, query: '' };
  }

  const spaceIndex = value.indexOf(' ');
  if (spaceIndex !== -1 && cursorPosition > spaceIndex) {
    return { isActive: false, query: '' };
  }

  const query = value.slice(1, cursorPosition).toLowerCase();
  return { isActive: true, query };
}

export function MessageInput({
  onSubmit,
  onExit,
  onCommand,
  participants = [],
  placeholder = 'Type @ to mention models or / for commands',
  disabled = false,
  selectedTarget = 'all',
  onCancelStream,
  isStreaming = false,
  compact = false,
}: MessageInputProps): React.ReactElement {
  const { stdout } = useStdout();
  const [value, setValue] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [exitHintActive, setExitHintActive] = useState(false);
  const exitHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pastedContent, setPastedContent] = useState<string | null>(null);

  // Ref for cursorPosition so the paste callback always sees the latest value
  const cursorPositionRef = useRef(cursorPosition);
  cursorPositionRef.current = cursorPosition;

  // Bracketed paste: silently captures pasted text without VS Code popup.
  // Small single-line pastes go into the input; large/multi-line show indicator.
  const isPasting = useBracketedPaste((text: string) => {
    const LARGE_PASTE_THRESHOLD = 100;
    const isMultiLine = text.includes('\n');

    if (text.length <= LARGE_PASTE_THRESHOLD && !isMultiLine) {
      const cp = cursorPositionRef.current;
      setValue(prev => prev.slice(0, cp) + text + prev.slice(cp));
      setCursorPosition(cp + text.length);
    } else {
      setPastedContent(prev => (prev ? prev + text : text));
    }
  });

  const messageHistory = useRef<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const savedInput = useRef('');

  // Clear exit hint timer on unmount
  useEffect(() => {
    return () => {
      if (exitHintTimer.current) clearTimeout(exitHintTimer.current);
    };
  }, []);

  const mentionContext = useMemo(
    () => getMentionContext(value, cursorPosition),
    [value, cursorPosition]
  );

  const commandContext = useMemo(
    () => getCommandContext(value, cursorPosition),
    [value, cursorPosition]
  );

  const autocompleteOptions = useMemo(() => {
    if (!mentionContext.isActive) return [];
    const models = participants.filter(p => p.type === 'model');
    if (!mentionContext.query) return models;
    return models.filter(
      p =>
        p.nickname.toLowerCase().includes(mentionContext.query) ||
        p.displayName.toLowerCase().includes(mentionContext.query)
    );
  }, [mentionContext, participants]);

  const commandOptions = useMemo(() => {
    if (!commandContext.isActive) return [];
    if (!commandContext.query) return AVAILABLE_COMMANDS;
    return AVAILABLE_COMMANDS.filter(cmd => cmd.name.toLowerCase().includes(commandContext.query));
  }, [commandContext]);

  useEffect(() => {
    setAutocompleteIndex(0);
  }, [autocompleteOptions.length, commandOptions.length]);

  const insertMention = useCallback(
    (participant: Participant) => {
      const before = value.slice(0, mentionContext.startIndex);
      const after = value.slice(cursorPosition);
      const newValue = `${before}@${participant.nickname} ${after}`;
      setValue(newValue);
      setCursorPosition(before.length + participant.nickname.length + 2);
    },
    [value, cursorPosition, mentionContext.startIndex]
  );

  const insertCommand = useCallback((command: SlashCommand) => {
    const newValue = `/${command.name} `;
    setValue(newValue);
    setCursorPosition(newValue.length);
  }, []);

  useInput((input, key) => {
    if (disabled || isPasting.current) return;

    const mentionAutocompleteActive = mentionContext.isActive && autocompleteOptions.length > 0;
    const commandAutocompleteActive = commandContext.isActive && commandOptions.length > 0;
    const anyAutocompleteActive = mentionAutocompleteActive || commandAutocompleteActive;
    const currentOptions = mentionAutocompleteActive
      ? autocompleteOptions
      : commandAutocompleteActive
        ? commandOptions
        : [];

    if (anyAutocompleteActive) {
      if (key.upArrow) {
        setAutocompleteIndex(prev => (prev > 0 ? prev - 1 : currentOptions.length - 1));
        return;
      }
      if (key.downArrow) {
        setAutocompleteIndex(prev => (prev < currentOptions.length - 1 ? prev + 1 : 0));
        return;
      }
      if (key.tab) {
        if (mentionAutocompleteActive) {
          const selected = autocompleteOptions[autocompleteIndex];
          if (selected) {
            insertMention(selected);
          }
        } else if (commandAutocompleteActive) {
          const selected = commandOptions[autocompleteIndex];
          if (selected) {
            insertCommand(selected);
          }
        }
        return;
      }
    }

    if (!anyAutocompleteActive && messageHistory.current.length > 0) {
      if (key.upArrow) {
        if (historyIndex === -1) {
          savedInput.current = value;
          setHistoryIndex(messageHistory.current.length - 1);
          const historyValue = messageHistory.current[messageHistory.current.length - 1] ?? '';
          setValue(historyValue);
          setCursorPosition(historyValue.length);
        } else if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          const historyValue = messageHistory.current[newIndex] ?? '';
          setValue(historyValue);
          setCursorPosition(historyValue.length);
        }
        return;
      }
      if (key.downArrow && historyIndex !== -1) {
        if (historyIndex < messageHistory.current.length - 1) {
          const newIndex = historyIndex + 1;
          setHistoryIndex(newIndex);
          const historyValue = messageHistory.current[newIndex] ?? '';
          setValue(historyValue);
          setCursorPosition(historyValue.length);
        } else {
          setHistoryIndex(-1);
          setValue(savedInput.current);
          setCursorPosition(savedInput.current.length);
        }
        return;
      }
    }

    // Ctrl+J inserts a newline (guaranteed fallback for Shift+Enter).
    // Ctrl+J sends LF (0x0A) which is always distinct from Enter CR (0x0D).
    if (key.ctrl && input === 'j') {
      if (historyIndex !== -1) {
        setHistoryIndex(-1);
      }
      setValue(prev => prev.slice(0, cursorPosition) + '\n' + prev.slice(cursorPosition));
      setCursorPosition(prev => prev + 1);
      return;
    }

    if (key.return) {
      // Autocomplete: Enter selects the highlighted option
      if (commandAutocompleteActive) {
        const selected = commandOptions[autocompleteIndex];
        if (selected) {
          insertCommand(selected);
          return;
        }
      }
      if (mentionAutocompleteActive) {
        const selected = autocompleteOptions[autocompleteIndex];
        if (selected) {
          insertMention(selected);
          return;
        }
      }
      // No autocomplete: Enter submits
      if (!disabled) {
        handleSubmit();
      }
      return;
    } else if (key.escape) {
      // Layer 1: dismiss autocomplete
      if (mentionContext.isActive && autocompleteOptions.length > 0) {
        const before = value.slice(0, mentionContext.startIndex);
        const after = value.slice(cursorPosition);
        setValue(before + after);
        setCursorPosition(before.length);
        return;
      }
      // Layer 2: clear pasted content
      if (pastedContent) {
        setPastedContent(null);
        return;
      }
      // Layer 3: clear input if it has text
      if (value.length > 0) {
        setValue('');
        setCursorPosition(0);
        setHistoryIndex(-1);
        return;
      }
      // Layer 3: cancel streaming agents (empty input + agents streaming)
      if (isStreaming && onCancelStream) {
        onCancelStream();
        return;
      }
      // Layer 4: double-tap Esc to exit
      if (exitHintActive) {
        if (exitHintTimer.current) clearTimeout(exitHintTimer.current);
        setExitHintActive(false);
        onExit?.();
      } else {
        setExitHintActive(true);
        if (exitHintTimer.current) clearTimeout(exitHintTimer.current);
        exitHintTimer.current = setTimeout(() => setExitHintActive(false), 2000);
      }
      return;
    } else if (key.ctrl && input === 'u') {
      // Ctrl+U: clear input line (standard terminal shortcut)
      setValue('');
      setCursorPosition(0);
      return;
    } else if (key.backspace || key.delete) {
      if (cursorPosition > 0) {
        setValue(prev => prev.slice(0, cursorPosition - 1) + prev.slice(cursorPosition));
        setCursorPosition(prev => Math.max(0, prev - 1));
      }
    } else if (key.leftArrow) {
      setCursorPosition(prev => Math.max(0, prev - 1));
    } else if (key.rightArrow) {
      setCursorPosition(prev => Math.min(value.length, prev + 1));
    } else if (!key.ctrl && !key.meta && input) {
      if (historyIndex !== -1) {
        setHistoryIndex(-1);
      }
      if (exitHintActive) {
        setExitHintActive(false);
        if (exitHintTimer.current) clearTimeout(exitHintTimer.current);
      }

      // Large input chunk = paste — store separately, show indicator
      const PASTE_THRESHOLD = 150;
      if (input.length > PASTE_THRESHOLD) {
        setPastedContent(prev => (prev ? prev + input : input));
        return;
      }

      setValue(prev => prev.slice(0, cursorPosition) + input + prev.slice(cursorPosition));
      setCursorPosition(prev => prev + input.length);
    }
  });

  const handleSubmit = useCallback(() => {
    const typed = value.trim();
    const pasted = pastedContent?.trim() ?? '';
    const fullMessage = typed && pasted ? `${typed}\n\n${pasted}` : typed || pasted;

    if (!fullMessage) return;

    if (messageHistory.current[messageHistory.current.length - 1] !== fullMessage) {
      messageHistory.current.push(fullMessage);
      if (messageHistory.current.length > 100) {
        messageHistory.current.shift();
      }
    }
    setHistoryIndex(-1);
    savedInput.current = '';

    if (fullMessage.startsWith('/')) {
      const parts = fullMessage.slice(1).split(/\s+/);
      const command = parts[0] ?? '';
      const args = parts.slice(1);
      onCommand?.(command, args);
      setValue('');
      setCursorPosition(0);
      setPastedContent(null);
      return;
    }

    const parseResult = coreParseMentions(fullMessage, { participants });

    let directedTo: string[] | undefined;
    if (parseResult.type !== 'broadcast' && parseResult.targetIds.length > 0) {
      directedTo = parseResult.targetIds;
    } else if (selectedTarget !== 'all') {
      directedTo = [selectedTarget.id];
    }

    onSubmit(parseResult.cleanedContent || fullMessage, directedTo);
    setValue('');
    setCursorPosition(0);
    setPastedContent(null);
  }, [value, pastedContent, onSubmit, onCommand, participants, selectedTarget]);

  const showPlaceholder = !value && !pastedContent;

  // Multi-line: find which line the cursor is on
  const lines = value.split('\n');
  let cursorLine = 0;
  let cursorCol = 0;
  if (value) {
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineLen = lines[i]!.length;
      if (cursorPosition <= offset + lineLen) {
        cursorLine = i;
        cursorCol = cursorPosition - offset;
        break;
      }
      offset += lineLen + 1; // +1 for \n
    }
  }

  const termCols = stdout?.columns ?? 120;
  const PROMPT_WIDTH = 2; // "❯ " or "  "

  /**
   * Compute a horizontal viewport for a line so text scrolls around the cursor
   * instead of letting the terminal hard-wrap long lines.
   */
  const viewportFor = (
    line: string,
    col: number,
    extraPrefix: number,
  ): { visible: string; viewCol: number; scrolled: boolean } => {
    const avail = termCols - PROMPT_WIDTH - extraPrefix - 1;
    if (avail <= 0 || line.length <= avail) {
      return { visible: line, viewCol: col, scrolled: false };
    }
    let start = col - Math.floor(avail / 2);
    if (start < 0) start = 0;
    if (start + avail > line.length) start = Math.max(line.length - avail, 0);
    return {
      visible: line.slice(start, start + avail),
      viewCol: col - start,
      scrolled: start > 0,
    };
  };

  return (
    <Box flexDirection="column">
      {showPlaceholder ? (
        <Box>
          <Text color={disabled ? 'gray' : 'yellow'} bold>
            {'❯ '}
          </Text>
          {selectedTarget !== 'all' && <Text color="magenta">@{selectedTarget.nickname} </Text>}
          {pastedContent && (
            <Text color="cyan" dimColor>
              [Pasted {pastedContent.length.toLocaleString()} chars
              {pastedContent.includes('\n') ? `, ${pastedContent.split('\n').length} lines` : ''}
              ]{' '}
            </Text>
          )}
          <Text backgroundColor="gray" color="white">
            {' '}
          </Text>
          <Text dimColor>{placeholder}</Text>
        </Box>
      ) : (
        lines.map((line, lineIdx) => {
          const isFirst = lineIdx === 0;
          const isCursorLine = lineIdx === cursorLine;

          let extraPrefix = 0;
          if (isFirst && selectedTarget !== 'all') {
            extraPrefix += selectedTarget.nickname.length + 2; // "@nick "
          }

          const vp = isCursorLine
            ? viewportFor(line, cursorCol, extraPrefix)
            : viewportFor(line, 0, extraPrefix);

          return (
            <Box key={lineIdx}>
              <Text color={disabled ? 'gray' : 'yellow'} bold>
                {isFirst ? '❯ ' : '  '}
              </Text>
              {isFirst && selectedTarget !== 'all' && (
                <Text color="magenta">@{selectedTarget.nickname} </Text>
              )}
              {isFirst && pastedContent && (
                <Text color="cyan" dimColor>
                  [Pasted {pastedContent.length.toLocaleString()} chars
                  {pastedContent.includes('\n')
                    ? `, ${pastedContent.split('\n').length} lines`
                    : ''}
                  ]{' '}
                </Text>
              )}
              {vp.scrolled && <Text dimColor>{'…'}</Text>}
              {isCursorLine ? (
                <>
                  <Text>{vp.visible.slice(0, vp.viewCol)}</Text>
                  <Text backgroundColor="gray" color="white">
                    {vp.visible[vp.viewCol] ?? ' '}
                  </Text>
                  <Text>{vp.visible.slice(vp.viewCol + 1)}</Text>
                </>
              ) : (
                <Text>{vp.visible}</Text>
              )}
            </Box>
          );
        })
      )}

      {commandContext.isActive && commandOptions.length > 0 && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Box marginBottom={1}>
            <Text color="gray">Available commands:</Text>
          </Box>
          {commandOptions.slice(0, 8).map((command, index) => {
            const isSelected = index === autocompleteIndex;
            return (
              <Box key={command.name}>
                <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected} inverse={isSelected}>
                  {isSelected ? ' ❯ ' : '   '}/{command.name}
                </Text>
                <Text color="gray" dimColor>
                  {' '}
                  {command.description}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {mentionContext.isActive && autocompleteOptions.length > 0 && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Box marginBottom={1}>
            <Text color="gray">Select a participant:</Text>
          </Box>
          {(() => {
            const maxVisible = 6;
            const total = autocompleteOptions.length;
            let startIdx = 0;
            if (total > maxVisible) {
              startIdx = Math.max(0, Math.min(autocompleteIndex - 2, total - maxVisible));
            }
            const endIdx = Math.min(startIdx + maxVisible, total);
            const visibleOptions = autocompleteOptions.slice(startIdx, endIdx);

            return (
              <>
                {startIdx > 0 && (
                  <Text color="gray" dimColor>
                    {'   '}...{startIdx} above
                  </Text>
                )}
                {visibleOptions.map((participant, visibleIndex) => {
                  const actualIndex = startIdx + visibleIndex;
                  const isSelected = actualIndex === autocompleteIndex;
                  const roleLabel = participant.role
                    ? (getRoleTemplate(participant.role)?.label ?? participant.role)
                    : undefined;
                  return (
                    <Box key={participant.id}>
                      <Text
                        color={isSelected ? 'cyan' : 'white'}
                        bold={isSelected}
                        inverse={isSelected}
                      >
                        {isSelected ? ' ❯ ' : '   '}@{participant.nickname}
                      </Text>
                      <Text color="gray" dimColor>
                        {' '}
                        ({participant.displayName})
                      </Text>
                      {roleLabel && <Text color="#02e3ff"> [{roleLabel}]</Text>}
                    </Box>
                  );
                })}
                {endIdx < total && (
                  <Text color="gray" dimColor>
                    {'   '}...{total - endIdx} below
                  </Text>
                )}
              </>
            );
          })()}
        </Box>
      )}

      {!compact && (
        <Box marginTop={1}>
          <Text dimColor>{'─'.repeat(Math.max((stdout?.columns ?? 120) - 2, 1))}</Text>
        </Box>
      )}

      <Box>
        {exitHintActive && !disabled ? (
          <Text color="yellow">Press Esc again to exit</Text>
        ) : (
          <Text dimColor>
            {disabled
              ? 'Waiting for response... (you can type ahead)'
              : compact
                ? 'Enter send • Tab complete • Esc clear/exit'
                : 'Enter send • Ctrl+J/Ctrl+Enter newline • Tab complete • ↑↓ history • Esc clear/exit'}
          </Text>
        )}
      </Box>
    </Box>
  );
}
