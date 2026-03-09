import React from 'react';
import { Box, Text } from 'ink';
import wrapAnsi from 'wrap-ansi';
import path from 'path';
import { CONTENT_PADDING } from '../ui/constants';
import { fileLink, webLink } from '../ui/terminal-link';

export interface MarkdownTextProps {
  /** The markdown content to render */
  content: string;
}

/** Available columns for text wrapping (terminal width minus content padding). */
function getWrapColumns(): number {
  return (process.stdout.columns ?? 80) - CONTENT_PADDING;
}

interface CodeBlock {
  type: 'code_block';
  language: string;
  content: string;
}

interface TextBlock {
  type: 'text';
  content: string;
}

type Block = CodeBlock | TextBlock;

type InlineSegment =
  | { type: 'text'; content: string }
  | { type: 'code'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'link'; content: string; url: string };

/**
 * Detect file/folder paths in text and wrap them in OSC 8 clickable hyperlinks.
 * Matches absolute paths (C:\..., /home/...) and relative paths (src/foo.ts, package.json).
 */
function linkifyPaths(text: string): string {
  const cwd = process.cwd();

  // Match: absolute Windows paths, absolute Unix paths, or relative paths with extension/trailing slash
  // Avoid matching inside existing OSC 8 sequences
  // eslint-disable-next-line security/detect-unsafe-regex -- path detection regex, input is bounded
  const pathPattern =
    /(?<![/\w\\])([A-Z]:\\[^\s,;:!?"'()[\]{}]+)|(?<![/\w\\])(\/(?:home|usr|tmp|var|opt|etc|mnt)[^\s,;:!?"'()[\]{}]+)|((?:\.\/|\.\.\/)?(?:[a-zA-Z_@.][a-zA-Z0-9_@.-]*\/)*[a-zA-Z0-9_@.-]+\.[a-zA-Z0-9]+(?:\/[^\s,;:!?"'()[\]{}]*)?|(?:\.\/|\.\.\/)?(?:[a-zA-Z_@.][a-zA-Z0-9_@.-]*\/)+)/g;

  return text.replace(pathPattern, match => {
    // Skip if already inside an OSC 8 sequence
    const trimmed = match.replace(/[,.)]+$/, '');
    if (trimmed.length === 0) return match;

    // Resolve to absolute path for the hyperlink URI
    const absPath = path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
    const suffix = match.slice(trimmed.length);
    return fileLink(trimmed, absPath) + suffix;
  });
}

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index);
      if (text.trim()) {
        blocks.push({ type: 'text', content: text });
      }
    }

    blocks.push({
      type: 'code_block',
      language: match[1] ?? '',
      content: (match[2] ?? '').replace(/^\n|\n$/g, ''),
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const text = content.slice(lastIndex);
    if (text.trim()) {
      blocks.push({ type: 'text', content: text });
    }
  }

  return blocks;
}

function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }

    if (match[1] !== undefined && match[1].length > 0) {
      segments.push({ type: 'code', content: match[1].slice(1, -1) });
    } else if (match[2] !== undefined && match[2].length > 0) {
      segments.push({ type: 'bold', content: match[2].slice(2, -2) });
    } else if (match[3]) {
      segments.push({ type: 'link', content: match[4] ?? '', url: match[5] ?? '' });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return segments;
}

import type { Highlighter, BundledLanguage } from 'shiki';

interface CodeToken {
  text: string;
  color?: string | undefined;
  bold?: boolean | undefined;
  dimColor?: boolean | undefined;
}

/** Shiki highlighter singleton — loaded once, reused across renders. */
let highlighterInstance: Highlighter | null = null;
let highlighterLoading = false;

const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  'c++': 'cpp',
  'c#': 'csharp',
};

function isDiffContent(language: string, content: string): boolean {
  if (language === 'diff') return true;
  if (language.length > 0) return false;
  const lines = content.split('\n').map(l => l.trimStart());
  return lines.some(l => l.startsWith('+')) && lines.some(l => l.startsWith('-'));
}

async function initHighlighter(): Promise<void> {
  if (highlighterInstance !== null || highlighterLoading) return;
  highlighterLoading = true;
  try {
    const { createHighlighter } = await import('shiki');
    highlighterInstance = await createHighlighter({
      themes: ['dark-plus'],
      langs: [
        'typescript',
        'javascript',
        'tsx',
        'jsx',
        'python',
        'json',
        'bash',
        'html',
        'css',
        'rust',
        'go',
        'java',
        'c',
        'cpp',
        'csharp',
        'sql',
        'yaml',
        'markdown',
        'xml',
        'toml',
        'dockerfile',
      ],
    });
  } catch {
    // Shiki unavailable — regex fallback will be used
  }
  highlighterLoading = false;
}

void initHighlighter();

function highlightWithShiki(code: string, language: string): CodeToken[][] | null {
  if (highlighterInstance === null || language.length === 0) return null;

  const lang = LANG_ALIASES[language.toLowerCase()] ?? language.toLowerCase();

  try {
    const result = highlighterInstance.codeToTokens(code, {
      lang: lang as BundledLanguage,
      theme: 'dark-plus',
    });

    return result.tokens.map(line =>
      line.map(token => ({
        text: token.content,
        color: token.color ?? undefined,
        bold: token.fontStyle !== undefined ? (token.fontStyle & 2) !== 0 : undefined,
      }))
    );
  } catch {
    return null;
  }
}

function tokenizeLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  const regex =
    // eslint-disable-next-line security/detect-unsafe-regex -- syntax highlighter regex, input is bounded
    /(\/\/.*$|\/\*.*?\*\/)|('[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*"|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|(\b[a-zA-Z_]\w*\b)/g;
  let lastIndex = 0;

  const KEYWORDS = new Set([
    'import',
    'export',
    'from',
    'class',
    'function',
    'const',
    'let',
    'var',
    'if',
    'else',
    'return',
    'async',
    'await',
    'new',
    'throw',
    'try',
    'catch',
    'finally',
    'switch',
    'case',
    'break',
    'default',
    'for',
    'while',
    'do',
    'typeof',
    'instanceof',
    'implements',
    'extends',
    'interface',
    'type',
    'enum',
    'readonly',
    'private',
    'public',
    'protected',
    'static',
    'void',
    'null',
    'undefined',
    'true',
    'false',
    'this',
    'super',
    'def',
    'elif',
    'except',
    'yield',
    'lambda',
    'pass',
    'raise',
    'True',
    'False',
    'None',
    'and',
    'or',
    'not',
    'fn',
    'mut',
    'pub',
    'struct',
    'impl',
    'trait',
    'func',
    'package',
  ]);

  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, match.index) });
    }

    if (match[1] !== undefined && match[1].length > 0) {
      tokens.push({ text: match[1], dimColor: true });
    } else if (match[2] !== undefined && match[2].length > 0) {
      tokens.push({ text: match[2], color: 'yellow' });
    } else if (match[3] !== undefined && match[3].length > 0) {
      tokens.push({ text: match[3], color: 'yellow' });
    } else if (match[4] !== undefined && match[4].length > 0) {
      const word = match[4];
      if (KEYWORDS.has(word)) {
        tokens.push({ text: word, color: 'magenta', bold: true });
      } else if (/^[A-Z]/.test(word)) {
        tokens.push({ text: word, color: 'cyan' });
      } else {
        tokens.push({ text: word });
      }
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex) });
  }

  return tokens;
}

function renderToken(token: CodeToken, key: number): React.ReactElement {
  if (token.dimColor === true) {
    return (
      <Text key={key} dimColor>
        {token.text}
      </Text>
    );
  }
  if (token.color !== undefined) {
    return token.bold === true ? (
      <Text key={key} color={token.color} bold>
        {token.text}
      </Text>
    ) : (
      <Text key={key} color={token.color}>
        {token.text}
      </Text>
    );
  }
  if (token.bold === true) {
    return (
      <Text key={key} bold>
        {token.text}
      </Text>
    );
  }
  return <Text key={key}>{token.text}</Text>;
}

/** Matches markdown list items: `* `, `- `, `+ `, or `1. ` style. */
const LIST_ITEM_RE = /^(\s*)([*\-+]|\d+[.)]) /;

/**
 * Split a text block into paragraphs and list items.
 * Continuation lines (indented under a list item) are merged with their bullet.
 */
type TextPart =
  | { type: 'paragraph'; content: string }
  | { type: 'list-item'; bullet: string; indent: number; content: string };

function splitTextParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    // eslint-disable-next-line security/detect-object-injection -- index from loop bounds
    const line = lines[i] ?? '';
    const listMatch = LIST_ITEM_RE.exec(line);

    if (listMatch) {
      const indent = (listMatch[1] ?? '').length;
      const marker = listMatch[2] ?? '*';
      const bullet = /\d/.test(marker) ? marker : '\u2022';
      let content = line.slice((listMatch[0] ?? '').length);

      // Merge continuation lines (indented beyond the bullet or empty)
      while (i + 1 < lines.length) {
        const next = lines[i + 1] ?? '';
        const nextTrimmed = next.trimStart();
        const nextIndent = next.length - nextTrimmed.length;
        // Continuation: indented further than bullet + marker, and not a new list item
        if (nextTrimmed && nextIndent > indent && !LIST_ITEM_RE.test(next)) {
          content += ' ' + nextTrimmed;
          i++;
        } else {
          break;
        }
      }

      parts.push({ type: 'list-item', bullet, indent, content: content.trim() });
    } else if (line.trim() === '') {
      // Skip blank lines between parts
    } else {
      // Regular paragraph — collect consecutive non-list, non-blank lines
      let para = line;
      while (i + 1 < lines.length) {
        const next = lines[i + 1] ?? '';
        if (next.trim() === '' || LIST_ITEM_RE.test(next)) break;
        para += '\n' + next;
        i++;
      }
      parts.push({ type: 'paragraph', content: para });
    }
    i++;
  }

  return parts;
}

function renderInlineSegment(
  seg: InlineSegment,
  key: number,
  applyLinkify = true
): React.ReactElement {
  switch (seg.type) {
    case 'code':
      return (
        <Text key={key} color="cyan">
          {applyLinkify ? linkifyPaths(seg.content) : seg.content}
        </Text>
      );
    case 'bold':
      return (
        <Text key={key} bold>
          {seg.content}
        </Text>
      );
    case 'link':
      return <Text key={key}>{webLink(seg.content, seg.url)}</Text>;
    default:
      return <Text key={key}>{applyLinkify ? linkifyPaths(seg.content) : seg.content}</Text>;
  }
}

function InlineText({ content }: { content: string }): React.ReactElement {
  const parts = splitTextParts(content);
  const cols = getWrapColumns();

  // Fast path: no list items — render as before
  if (parts.every(p => p.type === 'paragraph')) {
    const segments = parseInline(content);
    return <Text wrap="wrap">{segments.map((seg, i) => renderInlineSegment(seg, i))}</Text>;
  }

  return (
    <Box flexDirection="column">
      {parts.map((part, i) => {
        if (part.type === 'list-item') {
          const prefix = '  '.repeat(part.indent) + part.bullet + ' ';
          const contIndent = ' '.repeat(prefix.length);
          const wrapped = wrapAnsi(linkifyPaths(part.content), cols - prefix.length, {
            trim: true,
          });
          const wrappedLines = wrapped.split('\n');
          const formatted = wrappedLines
            .map((line, li) => (li === 0 ? prefix + line : contIndent + line))
            .join('\n');
          const segments = parseInline(formatted);
          return (
            <Text key={i} wrap="wrap">
              {segments.map((seg, j) => {
                switch (seg.type) {
                  case 'code':
                    return (
                      <Text key={j} color="cyan">
                        {seg.content}
                      </Text>
                    );
                  case 'bold':
                    return (
                      <Text key={j} bold>
                        {seg.content}
                      </Text>
                    );
                  default:
                    return <Text key={j}>{seg.content}</Text>;
                }
              })}
            </Text>
          );
        }
        // Paragraph
        const segments = parseInline(part.content);
        return (
          <Text key={i} wrap="wrap">
            {segments.map((seg, j) => {
              switch (seg.type) {
                case 'code':
                  return (
                    <Text key={j} color="cyan">
                      {linkifyPaths(seg.content)}
                    </Text>
                  );
                case 'bold':
                  return (
                    <Text key={j} bold>
                      {seg.content}
                    </Text>
                  );
                default:
                  return <Text key={j}>{linkifyPaths(seg.content)}</Text>;
              }
            })}
          </Text>
        );
      })}
    </Box>
  );
}

function stripCommonIndent(lines: string[]): string[] {
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.length === 0) return lines;
  const minIndent = Math.min(...nonEmpty.map(l => l.length - l.trimStart().length));
  return minIndent > 0 ? lines.map(l => l.slice(minIndent)) : lines;
}

function DiffBlockView({ content }: { content: string }): React.ReactElement {
  const lines = stripCommonIndent(content.split('\n'));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginY={1}>
      <Text dimColor>diff</Text>
      {lines.map((line, i) => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('@@')) {
          return (
            <Text key={i} color="cyan">
              {line}
            </Text>
          );
        }
        if (
          trimmed.startsWith('+++') ||
          trimmed.startsWith('---') ||
          trimmed.startsWith('diff ') ||
          trimmed.startsWith('index ')
        ) {
          return (
            <Text key={i} bold dimColor>
              {line}
            </Text>
          );
        }
        if (trimmed.startsWith('+')) {
          return (
            <Text key={i} color="green">
              {line}
            </Text>
          );
        }
        if (trimmed.startsWith('-')) {
          return (
            <Text key={i} color="red">
              {line}
            </Text>
          );
        }
        return <Text key={i}>{line}</Text>;
      })}
    </Box>
  );
}

const CODE_LANGUAGES = new Set([
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'ts',
  'js',
  'python',
  'py',
  'java',
  'c',
  'cpp',
  'c++',
  'csharp',
  'c#',
  'cs',
  'rust',
  'go',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'html',
  'css',
  'scss',
  'less',
  'sql',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'bash',
  'sh',
  'shell',
  'powershell',
  'ps1',
  'dockerfile',
  'makefile',
  'cmake',
  'lua',
  'perl',
  'r',
  'scala',
  'elixir',
  'haskell',
  'zig',
  'nim',
  'graphql',
  'proto',
  'protobuf',
]);

function shouldShowLineNumbers(language: string): boolean {
  return language !== '' && CODE_LANGUAGES.has(language.toLowerCase());
}

function CodeBlockView({
  language,
  content,
}: {
  language: string;
  content: string;
}): React.ReactElement {
  const lines = content.split('\n');
  const showLineNums = shouldShowLineNumbers(language);
  const lineNumWidth = showLineNums ? String(lines.length).length : 0;

  const shikiTokens = highlightWithShiki(content, language);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginY={1}>
      {language !== '' && <Text dimColor>{language}</Text>}
      {lines.map((line, i) => {
        // eslint-disable-next-line security/detect-object-injection -- index from Array.map
        const tokens = shikiTokens?.[i] ?? tokenizeLine(line);
        if (showLineNums) {
          const lineNum = String(i + 1).padStart(lineNumWidth);
          return (
            <Text key={i}>
              <Text dimColor>{lineNum} </Text>
              {tokens.map((token, j) => renderToken(token, j))}
            </Text>
          );
        }
        return <Text key={i}>{tokens.map((token, j) => renderToken(token, j))}</Text>;
      })}
    </Box>
  );
}

export function MarkdownText({ content }: MarkdownTextProps): React.ReactElement {
  if (!content.includes('```') && !content.includes('`') && !content.includes('**')) {
    // Check if content has list items — if so, use InlineText for proper formatting
    if (LIST_ITEM_RE.test(content)) {
      return <InlineText content={content} />;
    }
    return <Text>{wrapAnsi(linkifyPaths(content), getWrapColumns(), { trim: true })}</Text>;
  }

  const blocks = parseBlocks(content);

  if (blocks.length === 0) {
    return <Text>{''}</Text>;
  }

  if (blocks.length === 1 && blocks[0]?.type === 'text') {
    return <InlineText content={blocks[0].content} />;
  }

  return (
    <Box flexDirection="column">
      {blocks.map((block, i) => {
        if (block.type === 'code_block') {
          if (isDiffContent(block.language, block.content)) {
            return <DiffBlockView key={i} content={block.content} />;
          }
          return <CodeBlockView key={i} language={block.language} content={block.content} />;
        }
        return <InlineText key={i} content={block.content} />;
      })}
    </Box>
  );
}
