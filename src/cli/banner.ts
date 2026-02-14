/**
 * ASCII Art Banner for Cebus CLI
 */

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  brightGreen: '\x1b[92m',
  magenta: '\x1b[35m',
  brightMagenta: '\x1b[95m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  brightBlue: '\x1b[94m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

// Each letter of CEBUS: C=green, E=green, B=blue, U=magenta, S=magenta
const LETTER_COLORS = [
  colors.brightGreen,
  colors.brightGreen,
  colors.brightBlue,
  colors.brightMagenta,
  colors.brightMagenta,
];

// ASCII art letter segments per row: [C, E, B, U, S]
const LETTER_SEGMENTS = [
  [' ██████╗', '███████╗', '██████╗ ', '██╗   ██╗', '███████╗'],
  ['██╔════╝', '██╔════╝', '██╔══██╗', '██║   ██║', '██╔════╝'],
  ['██║     ', '█████╗  ', '██████╔╝', '██║   ██║', '███████╗'],
  ['██║     ', '██╔══╝  ', '██╔══██╗', '██║   ██║', '╚════██║'],
  ['╚██████╗', '███████╗', '██████╔╝', '╚██████╔╝', '███████║'],
  [' ╚═════╝', '╚══════╝', '╚═════╝ ', ' ╚═════╝ ', '╚══════╝'],
];

// ── Helpers ─────────────────────────────────────────────────────

/** Strip ANSI escape codes for visible-length calculation */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Center content within a fixed width */
function centerLine(content: string, width: number): string {
  const visibleLen = stripAnsi(content).length;
  const totalPad = width - visibleLen;
  const left = Math.floor(totalPad / 2);
  const right = totalPad - left;
  return ' '.repeat(Math.max(0, left)) + content + ' '.repeat(Math.max(0, right));
}

/** Build all 6 colorized CEBUS ASCII art rows */
function buildCebusLines(): string[] {
  return LETTER_SEGMENTS.map(row =>
    row.map((seg, i) => `${LETTER_COLORS[i]!}${seg}${colors.reset}`).join('')
  );
}

// ── Static banner ───────────────────────────────────────────────

const cebusArt = buildCebusLines();

// ── Exported functions ──────────────────────────────────────────

export function printBanner(version: string): void {
  const W = 57;
  const terminalWidth = process.stdout.columns ?? 80;

  // Narrow terminal fallback: avoid large ASCII art that wraps/clips badly.
  if (terminalWidth < W + 4) {
    const versionLine = `${colors.dim}v${version}${colors.reset}`;
    const tagline = `${colors.dim}All your AI models, one conversation${colors.reset}`;

    console.log('');
    console.log(`${colors.bold}${colors.cyan}Cebus${colors.reset} ${versionLine}`);
    console.log(tagline);
    console.log('');
    return;
  }

  const border = '─'.repeat(W);
  const empty = `${colors.cyan}│${colors.reset}${' '.repeat(W)}${colors.cyan}│${colors.reset}`;

  const versionLine = `${colors.dim}v${version}${colors.reset}`;
  const tagline = `${colors.dim}All your AI models, one conversation${colors.reset}`;

  const lines = [
    '',
    `${colors.cyan}╭${border}╮${colors.reset}`,
    empty,
    ...cebusArt.map(
      l => `${colors.cyan}│${colors.reset}${centerLine(l, W)}${colors.cyan}│${colors.reset}`
    ),
    empty,
    `${colors.cyan}│${colors.reset}${centerLine(versionLine, W)}${colors.cyan}│${colors.reset}`,
    `${colors.cyan}│${colors.reset}${centerLine(tagline, W)}${colors.cyan}│${colors.reset}`,
    empty,
    `${colors.cyan}╰${border}╯${colors.reset}`,
    '',
  ];

  console.log(lines.join('\n'));
}

export function printStatusLine(providers: { name: string; available: boolean }[]): void {
  console.log('');
  for (const provider of providers) {
    const status = provider.available
      ? `${colors.green}●${colors.reset}`
      : `${colors.dim}○${colors.reset}`;
    const name = provider.available
      ? `${colors.reset}${provider.name}`
      : `${colors.dim}${provider.name}${colors.reset}`;
    console.log(`  ${status} ${name}`);
  }
  console.log('');
}

export function printHelp(): void {
  console.log(`
${colors.bold}Usage:${colors.reset}
  cebus chat ${colors.dim}[options]${colors.reset}    Start a multi-model chat session
  cebus --resume <id>      Resume a previous session
  cebus providers          List available AI providers
  cebus config             Show configuration status
  cebus help               Show this help message

${colors.bold}Chat Options:${colors.reset}
  ${colors.cyan}-m, --models${colors.reset} <spec>    Add models ${colors.dim}(provider:model[:nickname])${colors.reset}
  ${colors.cyan}-t, --title${colors.reset} <title>    Set session title
  ${colors.cyan}-i, --interactive${colors.reset}      Interactive model selection

${colors.bold}Debug Options:${colors.reset}
  ${colors.cyan}-d, --debug${colors.reset}            Enable debug logging ${colors.dim}(logs to .cebus/debug.log)${colors.reset}
  ${colors.dim}CEBUS_DEBUG=1${colors.reset}          Enable via environment variable

${colors.bold}Examples:${colors.reset}
  ${colors.dim}$${colors.reset} cebus chat -m openai:gpt-4 -m anthropic:claude-3-opus
  ${colors.dim}$${colors.reset} cebus chat -m openai:gpt-4:GPT -t "Code Review"
  ${colors.dim}$${colors.reset} cebus --debug   ${colors.dim}# Run with debug logging${colors.reset}

${colors.bold}In Chat:${colors.reset}
  ${colors.yellow}@GPT4${colors.reset} message       Direct message to specific model
  ${colors.dim}(no @mention)${colors.reset}        Broadcast to all models
  ${colors.cyan}/help${colors.reset}                Show commands
  ${colors.cyan}/exit${colors.reset}                Exit chat

${colors.dim}https://github.com/cebus/cebus${colors.reset}
`);
}
