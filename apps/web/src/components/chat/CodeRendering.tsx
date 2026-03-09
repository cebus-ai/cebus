import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BundledLanguage } from 'shiki';
import { codeToHtml } from 'shiki';
import DOMPurify from 'dompurify';
import { Check, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { useI18n } from '../../lib/i18n';

const SHIKI_THEME = 'github-dark';

export function LineNumbers({ count }: { count: number }) {
  return (
    <div
      aria-hidden="true"
      className="sticky left-0 shrink-0 select-none border-r border-zinc-700/50 bg-zinc-900 py-3 pl-3 pr-2 text-right text-[13px] leading-relaxed text-zinc-600"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>{i + 1}</div>
      ))}
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? t('code.copied') : t('code.copy')}
    </button>
  );
}

export function HighlightedCode({ lang, code, isStreaming }: { lang: string; code: string; isStreaming?: boolean | undefined }) {
  const [html, setHtml] = useState<string | null>(null);
  const lineCount = code.split('\n').length;

  useEffect(() => {
    if (isStreaming) {
      setHtml(null);
      return;
    }
    let cancelled = false;
    codeToHtml(code, {
      lang: (lang || 'text') as BundledLanguage,
      theme: SHIKI_THEME,
    }).then((result) => {
      if (!cancelled) setHtml(result);
    }).catch(() => {
      // fallback - no highlighting
    });
    return () => { cancelled = true; };
  }, [code, lang, isStreaming]);

  if (html) {
    return (
      <div dir="ltr" className="flex overflow-x-auto text-left">
        <LineNumbers count={lineCount} />
        <div
          className="min-w-0 flex-1 p-3 [&_pre]:!m-0 [&_pre]:!bg-transparent [&_code]:!bg-transparent"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
        />
      </div>
    );
  }

  return (
    <div dir="ltr" className="flex overflow-x-auto text-left">
      <LineNumbers count={lineCount} />
      <pre className="min-w-0 flex-1 p-3">
        <code className="text-zinc-300">{code}</code>
      </pre>
    </div>
  );
}

interface DiffParsedLine {
  type: 'add' | 'remove' | 'context' | 'hunk';
  content: string;
  oldNum: number | null;
  newNum: number | null;
  hunkIndex: number;
}

interface DiffParseResult {
  filePath: string;
  lines: DiffParsedLine[];
  additions: number;
  deletions: number;
  hunkCount: number;
}

interface SideBySideRow {
  left: DiffParsedLine | null;
  right: DiffParsedLine | null;
  isHunk?: boolean | undefined;
}

function parseDiff(raw: string): DiffParseResult {
  const inputLines = raw.split('\n');
  let filePath = '';
  let additions = 0;
  let deletions = 0;
  let hunkIndex = -1;
  let oldLine = 1;
  let newLine = 1;
  const parsed: DiffParsedLine[] = [];

  for (const line of inputLines) {
    if (line.startsWith('diff --git')) {
      const m = line.match(/b\/(.+)$/);
      if (m?.[1]) filePath = m[1];
      continue;
    }
    if (line.startsWith('index ') || line.startsWith('\\ ')) continue;
    if (line.startsWith('--- ')) {
      if (!filePath && line.startsWith('--- a/')) filePath = line.slice(6);
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (line.startsWith('+++ b/')) filePath = line.slice(6);
      continue;
    }
    if (line.startsWith('@@')) {
      hunkIndex++;
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m?.[1] && m[2]) {
        oldLine = parseInt(m[1], 10);
        newLine = parseInt(m[2], 10);
      }
      const label = line.replace(/@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@\s?/, '');
      parsed.push({ type: 'hunk', content: label || '', oldNum: null, newNum: null, hunkIndex });
      continue;
    }
    if (hunkIndex < 0 && !line.startsWith('+') && !line.startsWith('-')) continue;
    if (hunkIndex < 0) { hunkIndex = 0; oldLine = 1; newLine = 1; }

    if (line.startsWith('+')) {
      additions++;
      parsed.push({ type: 'add', content: line.slice(1), oldNum: null, newNum: newLine++, hunkIndex });
    } else if (line.startsWith('-')) {
      deletions++;
      parsed.push({ type: 'remove', content: line.slice(1), oldNum: oldLine++, newNum: null, hunkIndex });
    } else {
      parsed.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line, oldNum: oldLine++, newNum: newLine++, hunkIndex });
    }
  }

  return { filePath, lines: parsed, additions, deletions, hunkCount: hunkIndex + 1 };
}

function buildSideBySideRows(lines: DiffParsedLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.type === 'hunk') { rows.push({ left: line, right: line, isHunk: true }); i++; continue; }
    if (line.type === 'context') { rows.push({ left: line, right: line }); i++; continue; }
    if (line.type === 'remove') {
      const removes: DiffParsedLine[] = [];
      while (i < lines.length && lines[i]!.type === 'remove') removes.push(lines[i++]!);
      const adds: DiffParsedLine[] = [];
      while (i < lines.length && lines[i]!.type === 'add') adds.push(lines[i++]!);
      const max = Math.max(removes.length, adds.length);
      for (let j = 0; j < max; j++) {
        rows.push({ left: removes[j] ?? null, right: adds[j] ?? null });
      }
      continue;
    }
    if (line.type === 'add') { rows.push({ left: null, right: line }); i++; continue; }
    i++;
  }
  return rows;
}

function diffLineStyle(type: 'add' | 'remove' | 'context' | 'hunk'): { bg: string; text: string; border: string } {
  switch (type) {
    case 'add': return { bg: 'var(--diff-add-bg)', text: 'var(--diff-add-text)', border: 'var(--diff-add-border)' };
    case 'remove': return { bg: 'var(--diff-remove-bg)', text: 'var(--diff-remove-text)', border: 'var(--diff-remove-border)' };
    case 'hunk': return { bg: 'var(--diff-hunk-bg)', text: 'var(--diff-hunk-text)', border: 'transparent' };
    default: return { bg: 'transparent', text: 'var(--diff-context-text)', border: 'transparent' };
  }
}

function UnifiedDiffView({ lines }: { lines: DiffParsedLine[] }) {
  return (
    <div className="overflow-x-auto font-mono text-[13px] leading-relaxed">
      {lines.map((line, i) => {
        if (line.type === 'hunk') {
          return (
            <div key={i} data-hunk={line.hunkIndex} className="flex min-h-[1.6em] items-center px-3 py-0.5 select-none" style={{ background: 'var(--diff-hunk-bg)', color: 'var(--diff-hunk-text)' }}>
              <span className="text-[12px]">@@ {line.content} @@</span>
            </div>
          );
        }
        const s = diffLineStyle(line.type);
        return (
          <div key={i} className="flex min-h-[1.6em]" style={{ background: s.bg, borderLeft: `2px solid ${s.border}` }}>
            <span className="w-10 shrink-0 select-none px-1.5 text-right text-[12px]" style={{ color: 'var(--diff-num)' }}>{line.oldNum ?? ''}</span>
            <span className="w-10 shrink-0 select-none border-r px-1.5 text-right text-[12px]" style={{ color: 'var(--diff-num)', borderColor: 'var(--diff-line-border)' }}>{line.newNum ?? ''}</span>
            <span className="w-5 shrink-0 select-none text-center opacity-70" style={{ color: s.text }}>{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}</span>
            <span className="min-w-0 flex-1 whitespace-pre px-1" style={{ color: s.text }}>{line.content}</span>
          </div>
        );
      })}
    </div>
  );
}

function SideBySideDiffCell({ line, side }: { line: DiffParsedLine | null; side: 'left' | 'right' }) {
  const borderClass = side === 'left' ? 'border-r' : '';
  if (!line) {
    return <div className={`w-1/2 min-w-0 min-h-[1.6em] ${borderClass}`} style={{ borderColor: 'var(--diff-line-border)', background: 'var(--diff-hunk-bg)' }} />;
  }
  const isChanged = (side === 'left' && line.type === 'remove') || (side === 'right' && line.type === 'add');
  const s = isChanged ? diffLineStyle(line.type) : diffLineStyle('context');
  const num = side === 'left' ? line.oldNum : line.newNum;

  return (
    <div className={`flex w-1/2 min-w-0 min-h-[1.6em] ${borderClass}`} style={{ background: isChanged ? s.bg : 'transparent', borderColor: 'var(--diff-line-border)' }}>
      <span className="w-8 shrink-0 select-none px-1 text-right text-[12px]" style={{ color: 'var(--diff-num)' }}>{num ?? ''}</span>
      <span className="w-4 shrink-0 select-none text-center opacity-70" style={{ color: isChanged ? s.text : 'transparent' }}>{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ''}</span>
      <span className="min-w-0 flex-1 whitespace-pre px-1" style={{ color: isChanged ? s.text : 'var(--diff-context-text)' }}>{line.content}</span>
    </div>
  );
}

function SideBySideDiffView({ lines }: { lines: DiffParsedLine[] }) {
  const rows = buildSideBySideRows(lines);
  return (
    <div className="overflow-x-auto font-mono text-[13px] leading-relaxed">
      {rows.map((row, i) => {
        if (row.isHunk) {
          return (
            <div key={i} data-hunk={row.left!.hunkIndex} className="flex min-h-[1.6em]">
              <div className="w-1/2 border-r px-2 py-0.5 select-none" style={{ background: 'var(--diff-hunk-bg)', color: 'var(--diff-hunk-text)', borderColor: 'var(--diff-line-border)' }}>
                <span className="text-[12px]">@@ {row.left!.content}</span>
              </div>
              <div className="w-1/2 px-2 py-0.5" style={{ background: 'var(--diff-hunk-bg)' }} />
            </div>
          );
        }
        return (
          <div key={i} className="flex">
            <SideBySideDiffCell line={row.left} side="left" />
            <SideBySideDiffCell line={row.right} side="right" />
          </div>
        );
      })}
    </div>
  );
}

export function DiffView({ code, isStreaming }: { code: string; isStreaming?: boolean | undefined }) {
  const diff = useMemo(() => parseDiff(code), [code]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  const [hunkIdx, setHunkIdx] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWide(entry.contentRect.width >= 700);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);

  const navigateHunk = useCallback((direction: 1 | -1) => {
    if (diff.hunkCount === 0) return;
    const next = Math.max(0, Math.min(diff.hunkCount - 1, hunkIdx + direction));
    setHunkIdx(next);
    scrollRef.current?.querySelector(`[data-hunk="${next}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hunkIdx, diff.hunkCount]);

  if (isStreaming) {
    return (
      <div dir="ltr" className="my-2 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-sm text-left">
        <div className="flex items-center gap-2 border-b border-zinc-700 px-3 py-1.5">
          <span className="text-[10px] font-medium uppercase text-zinc-500">diff</span>
        </div>
        <pre className="max-h-96 overflow-y-auto p-3 font-mono text-[13px] leading-relaxed text-zinc-400">
          {code}
        </pre>
      </div>
    );
  }

  return (
    <div ref={containerRef} dir="ltr" className="my-2 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-sm text-left">
      <div className="flex items-center gap-2 border-b border-zinc-700 px-3 py-1.5">
        {diff.filePath ? (
          <span className="min-w-0 truncate text-[12px] font-medium text-zinc-300" title={diff.filePath}>{diff.filePath}</span>
        ) : (
          <span className="text-[10px] font-medium uppercase text-zinc-500">diff</span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {diff.additions > 0 && <span className="text-[11px] font-medium" style={{ color: 'var(--diff-add-border)' }}>+{diff.additions}</span>}
          {diff.deletions > 0 && <span className="text-[11px] font-medium" style={{ color: 'var(--diff-remove-border)' }}>-{diff.deletions}</span>}
          {diff.hunkCount > 1 && (
            <div className="ml-1 flex items-center gap-0.5">
              <button onClick={() => navigateHunk(-1)} disabled={hunkIdx === 0} className="rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 disabled:opacity-30">
                <ChevronUp size={14} />
              </button>
              <span className="text-[10px] text-zinc-500">{hunkIdx + 1}/{diff.hunkCount}</span>
              <button onClick={() => navigateHunk(1)} disabled={hunkIdx === diff.hunkCount - 1} className="rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 disabled:opacity-30">
                <ChevronDown size={14} />
              </button>
            </div>
          )}
          <CopyButton text={code} />
        </div>
      </div>
      <div ref={scrollRef} className="max-h-96 overflow-y-auto">
        {wide ? <SideBySideDiffView lines={diff.lines} /> : <UnifiedDiffView lines={diff.lines} />}
      </div>
    </div>
  );
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go',
  java: 'java', kt: 'kotlin', swift: 'swift', cs: 'csharp',
  cpp: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
  css: 'css', scss: 'scss', html: 'html', vue: 'vue', svelte: 'svelte',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  md: 'markdown', sql: 'sql', sh: 'bash', bash: 'bash',
  dockerfile: 'dockerfile', xml: 'xml', graphql: 'graphql',
};

export function stripFences(content: string): { code: string; fenceLang: string } {
  const match = content.match(/^```(\w*)\n([\s\S]*?)```\s*$/);
  if (match?.[2] != null) return { code: match[2].replace(/\n$/, ''), fenceLang: match[1] ?? '' };
  return { code: content, fenceLang: '' };
}

export function detectLang(label: string, content: string): string {
  const fromFile = langFromFilename(label);
  if (fromFile !== 'text') return fromFile;

  const { fenceLang } = stripFences(content);
  if (fenceLang) return fenceLang;

  const trimmed = content.trimStart();
  if (/^(import |export |const |let |var |function |class |interface |type |enum |async )/.test(trimmed)) {
    return trimmed.includes('</') || trimmed.includes('/>') ? 'tsx' : 'typescript';
  }
  if (/^(def |class |from |import )/.test(trimmed)) return 'python';
  if (/^(package |func |import \()/.test(trimmed)) return 'go';
  if (/^(use |fn |struct |impl |pub )/.test(trimmed)) return 'rust';
  if (/^(<\?php|namespace )/.test(trimmed)) return 'php';
  if (/^(<!DOCTYPE|<html|<div)/.test(trimmed)) return 'html';
  if (/^\{[\s\n]/.test(trimmed) || /^\[[\s\n]/.test(trimmed)) return 'json';
  if (/^#!\/bin\/(bash|sh)/.test(trimmed)) return 'bash';
  if (/^(SELECT |INSERT |CREATE |ALTER |DROP )/i.test(trimmed)) return 'sql';
  return 'text';
}

export function langFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANG[ext] ?? 'text';
}
