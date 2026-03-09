import { memo, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { RichBlockRenderer, RICH_BLOCK_LANGS, inferBlockType } from '../rich-blocks/RichBlockRenderer';
import { HighlightedCode, DiffView, CopyButton } from './CodeRendering';
import { ToolResultBlock, type ToolResultEntry } from './ToolResultBlock';

interface MarkdownContentProps {
  content: string;
  isStreaming?: boolean | undefined;
  onSendMessage?: ((message: string) => void) | undefined;
}

function extractText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return extractText((children as { props: { children?: ReactNode } }).props.children);
  }
  return String(children ?? '');
}

function CodeBlockWrapper({ className, children, isStreaming, onSendMessage }: { className?: string | undefined; children: ReactNode; isStreaming?: boolean | undefined; onSendMessage?: ((message: string) => void) | undefined }) {
  const raw = extractText(children).replace(/\n$/, '');
  const langMatch = className?.match(/language-(\w+)/);
  const lang = langMatch?.[1] ?? '';

  if (RICH_BLOCK_LANGS.has(lang)) {
    return <RichBlockRenderer lang={lang} code={raw} isStreaming={isStreaming} onSendMessage={onSendMessage} />;
  }

  // Detect rich blocks inside ```json fences
  if (lang === 'json') {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const inferred = inferBlockType(obj);
      if (inferred) {
        return <RichBlockRenderer lang={inferred} code={raw} isStreaming={isStreaming} onSendMessage={onSendMessage} />;
      }
    } catch {
      /* not recognizable — fall through to syntax highlighting */
    }
  }

  const isDiff = lang === 'diff' || (
    !lang && raw.includes('\n') &&
    (raw.startsWith('diff --git') || raw.startsWith('--- ') || /^@@\s/.test(raw))
  );

  if (isDiff) {
    return <DiffView code={raw} isStreaming={isStreaming} />;
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-sm">
      <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-1">
        <span className="text-[10px] font-medium uppercase text-zinc-500">{lang || 'code'}</span>
        <CopyButton text={raw} />
      </div>
      <HighlightedCode lang={lang} code={raw} isStreaming={isStreaming} />
    </div>
  );
}

function ImageWithZoom({ src, alt }: { src: string | undefined; alt: string | undefined }) {
  const [zoomed, setZoomed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (!src) return null;

  return (
    <>
      <span className="my-2 inline-block">
        {!loaded && (
          <span className="inline-block h-32 w-48 animate-pulse rounded-lg bg-zinc-800" />
        )}
        <img
          src={src}
          alt={alt ?? ''}
          onLoad={() => setLoaded(true)}
          onClick={() => setZoomed(true)}
          className={`max-w-sm cursor-zoom-in rounded-lg border border-zinc-700 transition-opacity ${loaded ? 'opacity-100' : 'h-0 opacity-0'}`}
        />
      </span>
      {zoomed && (
        <span
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-8"
          onClick={() => setZoomed(false)}
        >
          <img src={src} alt={alt ?? ''} className="max-h-full max-w-full rounded-lg" />
        </span>
      )}
    </>
  );
}

const UNFENCED_RICH_BLOCK_RE = new RegExp(
  `^(${Array.from(RICH_BLOCK_LANGS).join('|')})\\s+(\\{.+\\})\\s*$`,
  'gm',
);

function splitAdjacentFences(text: string): string {
  // Split 6 backticks (closing+opening glued) into separate fences
  let result = text.replace(/``````/g, '```\n\n```');
  // Insert blank line between closing ``` and opening ```lang on adjacent lines
  result = result.replace(/^(```)[ \t]*\n(```\w)/gm, '$1\n\n$2');
  return result;
}

function wrapUnfencedRichBlocks(text: string): string {
  return text.replace(UNFENCED_RICH_BLOCK_RE, '```$1\n$2\n```');
}

const BRACKETED_SUGGESTIONS_RE = /^(\[([^\]]+)\][\s,]*){2,}$/gm;

function wrapBracketedSuggestions(text: string): string {
  return text.replace(BRACKETED_SUGGESTIONS_RE, (match) => {
    const items = [...match.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    return '```suggestions\n' + JSON.stringify({ suggestions: items }) + '\n```';
  });
}

function wrapBareJsonRichBlocks(text: string): string {
  // Split around existing code fences so we only process unfenced text
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // inside a code fence — skip
      return replaceBareJsonInSegment(part);
    })
    .join('');
}

function replaceBareJsonInSegment(text: string): string {
  const lines = text.split('\n');
  const replacements: { start: number; end: number; blockType: string }[] = [];

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith('{')) {
      let depth = 0;
      let jsonStr = '';
      let j = i;
      while (j < lines.length) {
        const line = lines[j]!;
        jsonStr += (j > i ? '\n' : '') + line;
        for (const ch of line) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
        if (depth === 0) break;
        j++;
      }
      if (depth === 0 && j > i) {
        try {
          const obj = JSON.parse(jsonStr) as Record<string, unknown>;
          const blockType = inferBlockType(obj);
          if (blockType) {
            replacements.push({ start: i, end: j, blockType });
          }
        } catch {
          /* not valid JSON */
        }
      }
      i = j + 1;
    } else {
      i++;
    }
  }

  if (replacements.length === 0) return text;

  // Apply replacements in reverse to preserve indices
  for (let r = replacements.length - 1; r >= 0; r--) {
    const { start, end, blockType } = replacements[r]!;
    const jsonLines = lines.slice(start, end + 1);
    lines.splice(start, end - start + 1, '```' + blockType, ...jsonLines, '```');
  }

  return lines.join('\n');
}

const TOOL_BLOCK_RE = /<(tool_call|tool_result)\b[^>]*>([\s\S]*?)<\/\1>/g;
const TOOL_NAME_RE = /<(?:name|tool_name)>(.*?)<\/(?:name|tool_name)>/;
const ERROR_TAG_RE = /<error\b/i;

interface ExtractedToolBlocks {
  cleanedContent: string;
  toolBlockGroups: ToolResultEntry[][];
}

function parseToolEntry(type: 'tool_call' | 'tool_result', innerXml: string): ToolResultEntry {
  const nameMatch = innerXml.match(TOOL_NAME_RE);
  const toolName = nameMatch?.[1]?.trim() ?? (type === 'tool_call' ? 'tool call' : 'tool result');
  const isError = ERROR_TAG_RE.test(innerXml);

  const content = innerXml
    .replace(/<\/?(?:name|tool_name|stdout|stderr|error|result|parameters|arguments)[^>]*>/g, '')
    .trim();

  return { type, toolName, content, isError };
}

function extractToolBlocks(content: string): ExtractedToolBlocks {
  // First pass: collect all matches with positions
  const matches: { start: number; end: number; entry: ToolResultEntry }[] = [];

  TOOL_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOOL_BLOCK_RE.exec(content)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      entry: parseToolEntry(match[1] as 'tool_call' | 'tool_result', match[2] ?? ''),
    });
  }

  if (matches.length === 0) {
    return { cleanedContent: content, toolBlockGroups: [] };
  }

  // Group consecutive blocks (only whitespace between them)
  const groups: { entries: ToolResultEntry[]; start: number; end: number }[] = [];
  const first = matches[0]!;
  let current = { entries: [first.entry], start: first.start, end: first.end };

  for (let i = 1; i < matches.length; i++) {
    const m = matches[i]!;
    const between = content.slice(current.end, m.start);
    if (between.trim() === '') {
      current.entries.push(m.entry);
      current.end = m.end;
    } else {
      groups.push(current);
      current = { entries: [m.entry], start: m.start, end: m.end };
    }
  }
  groups.push(current);

  // Build cleaned content by replacing each group with a placeholder
  let cleaned = '';
  let cursor = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    cleaned += content.slice(cursor, g.start);
    cleaned += `\n<!--TOOL_BLOCK_${i}-->\n`;
    cursor = g.end;
  }
  cleaned += content.slice(cursor);

  return {
    cleanedContent: cleaned,
    toolBlockGroups: groups.map((g) => g.entries),
  };
}

function detectDir(text: string): 'rtl' | 'ltr' {
  // Strip code blocks, inline code, and URLs — these are always LTR noise
  const cleaned = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\S+\.\w{2,4}(?=\s|$)/g, '');
  const rtlCount = (cleaned.match(/[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F]/g) ?? []).length;
  const ltrCount = (cleaned.match(/[A-Za-z]/g) ?? []).length;
  return rtlCount > ltrCount ? 'rtl' : 'ltr';
}

const MARKDOWN_COMPONENTS = {
  pre({ children }: { children?: ReactNode | undefined }) {
    return <>{children}</>;
  },
  p({ children }: { children?: ReactNode | undefined }) {
    return <p dir="auto" className="mb-2 last:mb-0">{children}</p>;
  },
  a({ href, children }: { href?: string | undefined; children?: ReactNode | undefined }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline hover:text-indigo-300">
        {children}
      </a>
    );
  },
  img({ src, alt }: { src?: string | undefined; alt?: string | undefined }) {
    return <ImageWithZoom src={src} alt={alt} />;
  },
  ul({ children }: { children?: ReactNode | undefined }) {
    return <ul className="mb-2 list-inside list-disc space-y-1 ps-1">{children}</ul>;
  },
  ol({ children }: { children?: ReactNode | undefined }) {
    return <ol className="mb-2 list-inside list-decimal space-y-1 ps-1">{children}</ol>;
  },
  li({ children }: { children?: ReactNode | undefined }) {
    return <li dir="auto" className="text-zinc-300">{children}</li>;
  },
  h1({ children }: { children?: ReactNode | undefined }) {
    return <h1 dir="auto" className="mb-2 text-lg font-bold text-zinc-100">{children}</h1>;
  },
  h2({ children }: { children?: ReactNode | undefined }) {
    return <h2 dir="auto" className="mb-2 text-base font-bold text-zinc-100">{children}</h2>;
  },
  h3({ children }: { children?: ReactNode | undefined }) {
    return <h3 dir="auto" className="mb-1 text-sm font-bold text-zinc-200">{children}</h3>;
  },
  blockquote({ children }: { children?: ReactNode | undefined }) {
    return <blockquote dir="auto" className="mb-2 border-s-2 border-zinc-600 ps-3 italic text-zinc-400">{children}</blockquote>;
  },
  table({ children }: { children?: ReactNode | undefined }) {
    return (
      <div className="my-2 overflow-x-auto rounded-lg border border-zinc-700">
        <table className="w-full text-sm">{children}</table>
      </div>
    );
  },
  thead({ children }: { children?: ReactNode | undefined }) {
    return <thead className="border-b border-zinc-700 bg-zinc-800/50">{children}</thead>;
  },
  th({ children }: { children?: ReactNode | undefined }) {
    return <th className="px-3 py-1.5 text-start text-xs font-medium text-zinc-400">{children}</th>;
  },
  td({ children }: { children?: ReactNode | undefined }) {
    return <td className="border-t border-zinc-800 px-3 py-1.5 text-zinc-300">{children}</td>;
  },
  hr() {
    return <hr className="my-3 border-zinc-700" />;
  },
  strong({ children }: { children?: ReactNode | undefined }) {
    return <strong className="font-semibold text-zinc-100">{children}</strong>;
  },
  em({ children }: { children?: ReactNode | undefined }) {
    return <em className="italic text-zinc-400">{children}</em>;
  },
};

function MarkdownSegment({ content, isStreaming, onSendMessage }: MarkdownContentProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      children={content}
      components={{
        ...MARKDOWN_COMPONENTS,
        code({ className, children }) {
          const isBlock = !!className || (typeof children === 'string' && children.includes('\n'));
          if (isBlock) {
            return <CodeBlockWrapper className={className} isStreaming={isStreaming} onSendMessage={onSendMessage}>{children}</CodeBlockWrapper>;
          }
          return (
            <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-[13px] text-indigo-300">
              {children}
            </code>
          );
        },
      }}
    />
  );
}

const TOOL_BLOCK_PLACEHOLDER_RE = /<!--TOOL_BLOCK_(\d+)-->/;

export const MarkdownContent = memo(function MarkdownContent({ content, isStreaming, onSendMessage }: MarkdownContentProps) {
  if (!content || typeof content !== 'string') {
    return <div dir="auto" className="whitespace-pre-wrap text-start text-sm leading-relaxed text-zinc-300">{String(content ?? '')}</div>;
  }

  const { cleanedContent, toolBlockGroups } = useMemo(() => extractToolBlocks(content), [content]);
  const processed = isStreaming
    ? wrapBareJsonRichBlocks(wrapUnfencedRichBlocks(splitAdjacentFences(cleanedContent)))
    : wrapBracketedSuggestions(wrapBareJsonRichBlocks(wrapUnfencedRichBlocks(splitAdjacentFences(cleanedContent))));
  const dir = detectDir(processed);

  const hasToolBlocks = toolBlockGroups.length > 0;

  const hasMarkdown =
    hasToolBlocks ||
    processed.includes('```') ||
    processed.includes('**') ||
    processed.includes('##') ||
    /^\s*[-*+]\s/m.test(processed) ||
    /^\s*\d+\.\s/m.test(processed) ||
    /\[.+\]\(.+\)/.test(processed) ||
    /^\s*>/m.test(processed) ||
    processed.includes('`') ||
    processed.includes('![');

  if (!hasMarkdown) {
    return <div dir={dir} className="whitespace-pre-wrap text-start text-sm leading-relaxed text-zinc-300">{processed}</div>;
  }

  if (hasToolBlocks) {
    const segments = processed.split(TOOL_BLOCK_PLACEHOLDER_RE);
    // segments alternates: [text, groupIndex, text, groupIndex, text, ...]
    return (
      <div dir={dir} className="text-start text-sm leading-relaxed text-zinc-300">
        {segments.map((segment, i) => {
          if (i % 2 === 1) {
            const groupIdx = parseInt(segment, 10);
            const group = toolBlockGroups[groupIdx];
            return group ? <ToolResultBlock key={`tool-${groupIdx}`} entries={group} /> : null;
          }
          const trimmed = segment.trim();
          if (!trimmed) return null;
          return <MarkdownSegment key={`md-${i}`} content={trimmed} isStreaming={isStreaming} onSendMessage={onSendMessage} />;
        })}
      </div>
    );
  }

  return (
    <div dir={dir} className="text-start text-sm leading-relaxed text-zinc-300">
      <MarkdownSegment content={processed} isStreaming={isStreaming} onSendMessage={onSendMessage} />
    </div>
  );
});
