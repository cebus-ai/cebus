/**
 * ANSI color codes for terminal output
 */
export const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  redBright: '\x1b[91m', // Bright red for better visibility
  gray: '\x1b[90m',
  white: '\x1b[97m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
} as const;
