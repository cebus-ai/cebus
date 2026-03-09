import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { Participant } from '@cebus/engine';
import { parseMentions as coreParseMentions, getRoleTemplate } from '@cebus/engine';
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

  /** Called when user pastes base64 image data. Should save and attach the image. */
  onImagePaste?: ((base64: string, mimeType: string) => void) | undefined;

  /** Called when user pastes a file path to an image. Should attach the file directly. */
  onFilePaste?: ((filePath: string) => void) | undefined;

  /** Number of pending attachments (shown as indicator) */
  pendingAttachmentCount?: number | undefined;
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
  { name: 'effort', description: 'Set reasoning effort (low/medium/high)' },
  { name: 'attach', description: 'Attach a file to the next message' },
  { name: 'attachments', description: 'List pending attachments' },
  { name: 'clear-attachments', description: 'Clear all pending attachments' },
];

interface MentionContext {
  isActive: boolean;
  query: string;
  startIndex: number;
}

function getMentionContext(value: string, cursorPosition: number): MentionContext {
  let startIndex = -1;
  for (let i = cursorPosition - 1; i >= 0; i--) {
    // eslint-disable-next-line security/detect-object-injection -- index from loop bounds
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

/** Image file extensions recognised for auto-attach on paste. */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

/** Base64 magic-byte prefixes for common image formats. */
const BASE64_IMAGE_SIGNATURES: Array<{ prefix: string; mimeType: string }> = [
  { prefix: 'iVBOR', mimeType: 'image/png' },      // PNG
  { prefix: '/9j/', mimeType: 'image/jpeg' },        // JPEG
  { prefix: 'R0lGOD', mimeType: 'image/gif' },       // GIF
  { prefix: 'UklGR', mimeType: 'image/webp' },       // WebP (RIFF)
];

function detectBase64Image(text: string): string | null {
  if (text.length < 100) return null;
  // Data URI prefix must be checked first — it contains characters that fail the base64 alphabet test
  if (text.startsWith('data:image/')) {
    const match = /^data:(image\/[a-z+]+);base64,/.exec(text);
    if (match) return match[1]!;
  }
  // Only inspect the first ~200 chars to avoid copying multi-MB base64 strings
  const head = text.slice(0, 200).replace(/[\r\n\s]/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(head)) return null;
  for (const sig of BASE64_IMAGE_SIGNATURES) {
    if (head.startsWith(sig.prefix)) return sig.mimeType;
  }
  return null;
}

/** Detect if pasted text is a file path to an image (e.g. from Windows Snipping Tool). */
function detectImageFilePath(text: string): boolean {
  // Must be a single line (no newlines except trailing whitespace)
  if (/\n/.test(text.trim())) return false;
  const trimmed = text.trim();
  // Check for common image extensions at the end
  const dotIdx = trimmed.lastIndexOf('.');
  if (dotIdx === -1) return false;
  const ext = trimmed.slice(dotIdx).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return false;
  // Must look like a path (contains separator or starts with drive letter on Windows)
  return /[/\\]/.test(trimmed) || /^[A-Za-z]:/.test(trimmed);
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
  onImagePaste,
  onFilePaste,
  pendingAttachmentCount = 0,
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

  // Guard: after a paste is handled as an image attachment, suppress useInput
  // for a short window to prevent the same paste data from leaking through.
  const pasteHandledAt = useRef(0);

  // Bracketed paste: silently captures pasted text without VS Code popup.
  // Small single-line pastes go into the input; large/multi-line show indicator.
  // Base64 image data pastes are detected and auto-attached.
  const isPasting = useBracketedPaste((text: string) => {
    const trimmed = text.trim();

    // Detect pasted file path to an image (e.g. from Windows Snipping Tool)
    if (detectImageFilePath(trimmed) && onFilePaste) {
      onFilePaste(trimmed);
      pasteHandledAt.current = Date.now();
      return;
    }

    // Detect base64-encoded image data (common magic bytes at start of base64)
    const imageSignature = detectBase64Image(trimmed);
    if (imageSignature && onImagePaste) {
      onImagePaste(trimmed, imageSignature);
      return;
    }

    const LARGE_PASTE_THRESHOLD = 100;
    const isMultiLine = text.includes('\n');

    if (text.length <= LARGE_PASTE_THRESHOLD && !isMultiLine) {
      const cp = cursorPositionRef.current;
      setValue(prev => prev.slice(0, cp) + text + prev.slice(cp));
      setCursorPosition(cp + text.length);
    } else {
      setPastedContent(prev => (prev !== null ? prev + text : text));
    }
  });

  const messageHistory = useRef<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const savedInput = useRef('');

  // Clear exit hint timer on unmount
  useEffect(() => {
    return (): void => {
      if (exitHintTimer.current !== null) clearTimeout(exitHintTimer.current);
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
    // Allow ESC to cancel streaming even when disabled (waiting for response)
    if (disabled && key.escape && onCancelStream) {
      onCancelStream();
      return;
    }
    if (disabled || isPasting.current) return;
    // Suppress leaked keystrokes from a paste that was just handled as an attachment
    if (Date.now() - pasteHandledAt.current < 100) return;

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
          // eslint-disable-next-line security/detect-object-injection -- index from state
          const selected = autocompleteOptions[autocompleteIndex];

          if (selected) {
            insertMention(selected);
          }
        } else if (commandAutocompleteActive) {
          // eslint-disable-next-line security/detect-object-injection -- index from state
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
          const historyValue = messageHistory.current.at(-1) ?? '';
          setValue(historyValue);
          setCursorPosition(historyValue.length);
        } else if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          // eslint-disable-next-line security/detect-object-injection -- index from state bounds
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
          // eslint-disable-next-line security/detect-object-injection -- index from state bounds
          const historyValue2 = messageHistory.current[newIndex] ?? '';
          setValue(historyValue2);
          setCursorPosition(historyValue2.length);
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
        // eslint-disable-next-line security/detect-object-injection -- index from state
        const selected = commandOptions[autocompleteIndex];
        if (selected) {
          insertCommand(selected);
          return;
        }
      }
      if (mentionAutocompleteActive) {
        // eslint-disable-next-line security/detect-object-injection -- index from state
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
      if (pastedContent !== null) {
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

      // Large input chunk = paste — check for image file path first
      const PASTE_THRESHOLD = 150;
      if (input.length > PASTE_THRESHOLD) {
        const trimmedInput = input.trim();
        if (detectImageFilePath(trimmedInput) && onFilePaste) {
          onFilePaste(trimmedInput);
          return;
        }
        setPastedContent(prev => (prev !== null ? prev + input : input));
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

  const showPlaceholder = value.length === 0 && pastedContent === null && pendingAttachmentCount === 0;

  // Multi-line: find which line the cursor is on
  const lines = value.split('\n');
  let cursorLine = 0;
  let cursorCol = 0;
  if (value.length > 0) {
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      // eslint-disable-next-line security/detect-object-injection -- index from for-loop
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
  const compact = termCols < 60;

  return (
    <Box flexDirection="column">
      {showPlaceholder ? (
        <Box>
          <Text color={disabled ? 'gray' : 'yellow'} bold>
            {'❯ '}
          </Text>
          {selectedTarget !== 'all' && <Text color="magenta">@{selectedTarget.nickname} </Text>}
          <Text backgroundColor="gray" color="white">
            {' '}
          </Text>
          <Text dimColor>{placeholder}</Text>
        </Box>
      ) : (
        lines.map((line, lineIdx) => {
          const isFirst = lineIdx === 0;
          const isCursorLine = lineIdx === cursorLine;

          return (
            <Box key={lineIdx} flexWrap="wrap">
              <Text color={disabled ? 'gray' : 'yellow'} bold>
                {isFirst ? '❯ ' : '  '}
              </Text>
              {isFirst && selectedTarget !== 'all' && (
                <Text color="magenta">@{selectedTarget.nickname} </Text>
              )}
              {isFirst && pendingAttachmentCount > 0 && (
                <Text color="magenta" dimColor>
                  [{Array.from({ length: pendingAttachmentCount }, (_, i) => `#image${i + 1}`).join(', ')}]{' '}
                </Text>
              )}
              {isFirst && pastedContent !== null && (
                <Text color="cyan" dimColor>
                  [Pasted {pastedContent.length.toLocaleString()} chars
                  {pastedContent.includes('\n')
                    ? `, ${pastedContent.split('\n').length} lines`
                    : ''}
                  ]{' '}
                </Text>
              )}
              {isCursorLine ? (
                <Text wrap="wrap">
                  {line.slice(0, cursorCol)}
                  <Text backgroundColor="gray" color="white">
                    {/* eslint-disable-next-line security/detect-object-injection -- index from cursor position */}
                    {line[cursorCol] ?? ' '}
                  </Text>
                  {line.slice(cursorCol + 1)}
                </Text>
              ) : (
                <Text wrap="wrap">{line}</Text>
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
          {((): React.ReactElement => {
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
                  const roleLabel =
                    participant.role !== undefined && participant.role.length > 0
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
                      {roleLabel !== undefined && roleLabel.length > 0 && (
                        <Text color="#02e3ff"> [{roleLabel}]</Text>
                      )}
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
              ? 'Waiting for response... (you can type ahead • Esc to cancel)'
              : compact
                ? 'Enter send • Tab complete • Esc clear/exit'
                : 'Enter send • Ctrl+J/Ctrl+Enter newline • Tab complete • ↑↓ history • Esc clear/exit'}
          </Text>
        )}
      </Box>
    </Box>
  );
}
