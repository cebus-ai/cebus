import type React from 'react';
import { useEffect, useRef } from 'react';

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/**
 * Enables bracketed paste mode on the terminal so pastes arrive as a single
 * chunk wrapped in escape sequences instead of line-by-line keystrokes.
 *
 * This prevents the VS Code multi-line paste confirmation popup and lets the
 * app handle pasted content silently.
 *
 * Returns an `isPasting` ref that callers should check in their `useInput`
 * handler — when true, all keypress events belong to the paste and should
 * be ignored (the hook captures them separately).
 */
export function useBracketedPaste(onPaste: (text: string) => void): React.RefObject<boolean> {
  const isPasting = useRef(false);
  const buffer = useRef('');
  const onPasteRef = useRef(onPaste);
  onPasteRef.current = onPaste;

  useEffect(() => {
    // Enable bracketed paste mode — the terminal wraps pastes in
    // \x1b[200~ ... \x1b[201~ so we can detect them reliably.
    process.stdout.write('\x1b[?2004h');

    const onData = (data: Buffer): void => {
      const str = data.toString('utf-8');

      if (isPasting.current) {
        const endIdx = str.indexOf(PASTE_END);
        if (endIdx !== -1) {
          buffer.current += str.slice(0, endIdx);
          const content = buffer.current;
          buffer.current = '';
          // Keep isPasting true through this tick so useInput skips the
          // keypress events that readline emits for the same data chunk.
          setImmediate(() => {
            isPasting.current = false;
          });
          onPasteRef.current(content);
        } else {
          buffer.current += str;
        }
        return;
      }

      const startIdx = str.indexOf(PASTE_START);
      if (startIdx === -1) return; // Not a paste — let Ink handle normally.

      isPasting.current = true;
      buffer.current = '';

      const afterStart = str.slice(startIdx + PASTE_START.length);
      const endIdx = afterStart.indexOf(PASTE_END);

      if (endIdx !== -1) {
        // Entire paste fits in a single chunk.
        const content = afterStart.slice(0, endIdx);
        setImmediate(() => {
          isPasting.current = false;
        });
        onPasteRef.current(content);
      } else {
        buffer.current = afterStart;
      }
    };

    process.stdin.prependListener('data', onData);

    return (): void => {
      process.stdout.write('\x1b[?2004l');
      process.stdin.removeListener('data', onData);
      isPasting.current = false;
      buffer.current = '';
    };
  }, []);

  return isPasting;
}
