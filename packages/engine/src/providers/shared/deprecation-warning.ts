/**
 * Styled deprecation warning capture and display.
 *
 * Intercepts console.warn/error during SDK calls to capture deprecation
 * messages. Captured warnings are displayed once with a visible bordered
 * box so users notice them without the raw SDK noise.
 */

const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/** Track warnings we've already shown to avoid duplicates across calls. */
const shownWarnings = new Set<string>();

/**
 * Display a deprecation warning with a bordered box in yellow.
 */
function displayDeprecationWarning(message: string): void {
  // Deduplicate: only show each unique warning once per session
  const key = message.trim();
  if (shownWarnings.has(key)) return;
  shownWarnings.add(key);

  const lines = message.trim().split('\n');
  const maxLen = Math.max(...lines.map(l => l.length), 20);
  const pad = (s: string): string => s + ' '.repeat(maxLen - s.length);

  const top = `${YELLOW}┌${'─'.repeat(maxLen + 2)}┐${RESET}`;
  const bottom = `${YELLOW}└${'─'.repeat(maxLen + 2)}┘${RESET}`;
  const header = `${YELLOW}│ ${BOLD}${pad('⚠  Deprecation Notice')}${RESET}${YELLOW} │${RESET}`;
  const separator = `${YELLOW}├${'─'.repeat(maxLen + 2)}┤${RESET}`;

  const body = lines
    .map(l => `${YELLOW}│${RESET} ${DIM}${pad(l)}${RESET} ${YELLOW}│${RESET}`)
    .join('\n');

  // Use stderr so it doesn't interfere with structured stdout output
  process.stderr.write(`\n${top}\n${header}\n${separator}\n${body}\n${bottom}\n\n`);
}

/**
 * Run a synchronous callback while intercepting deprecation warnings
 * from the underlying SDK. Captured warnings are displayed with styled
 * formatting instead of raw console output.
 *
 * Non-deprecation console messages are passed through unchanged.
 */
export function withDeprecationCapture<T>(fn: () => T): T {
  const captured: string[] = [];

  const origWarn = console.warn;
  const origError = console.error;

  console.warn = (...args: unknown[]): void => {
    const msg = String(args[0] ?? '');
    if (msg.includes('deprecated') || msg.includes('end-of-life')) {
      captured.push(msg);
    } else {
      origWarn.apply(console, args);
    }
  };

  console.error = (...args: unknown[]): void => {
    const msg = String(args[0] ?? '');
    if (msg.includes('deprecated') || msg.includes('end-of-life')) {
      captured.push(msg);
    } else {
      origError.apply(console, args);
    }
  };

  try {
    return fn();
  } finally {
    console.warn = origWarn;
    console.error = origError;

    for (const warning of captured) {
      displayDeprecationWarning(warning);
    }
  }
}
