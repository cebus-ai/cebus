import { lazy, Suspense, type ReactElement } from 'react';

const PollBlock = lazy(() => import('./PollBlock'));
const ChartBlock = lazy(() => import('./ChartBlock'));
const MermaidBlock = lazy(() => import('./MermaidBlock'));
const FormBlock = lazy(() => import('./FormBlock'));
const QuizBlock = lazy(() => import('./QuizBlock'));
const StepsBlock = lazy(() => import('./StepsBlock'));
const TabsBlock = lazy(() => import('./TabsBlock'));
const CalloutBlock = lazy(() => import('./CalloutBlock'));
const CardsBlock = lazy(() => import('./CardsBlock'));
const AccordionBlock = lazy(() => import('./AccordionBlock'));
const ProgressBlock = lazy(() => import('./ProgressBlock'));
const MediaBlock = lazy(() => import('./MediaBlock'));
const SuggestionsBlock = lazy(() => import('./SuggestionsBlock'));

/** Set of language names that map to rich interactive components. */
export const RICH_BLOCK_LANGS = new Set([
  'poll',
  'chart',
  'mermaid',
  'form',
  'quiz',
  'steps',
  'tabs',
  'callout',
  'cards',
  'accordion',
  'progress',
  'media',
  'suggestions',
]);

const CALLOUT_TYPES = new Set(['info', 'warning', 'error', 'success', 'tip']);
const CHART_TYPES = new Set(['bar', 'pie', 'line']);

/**
 * Infer the rich block type from a parsed JSON object's structure.
 * Returns the block lang string or null if unrecognized.
 */
export function inferBlockType(obj: Record<string, unknown>): string | null {
  if (Array.isArray(obj.suggestions)) return 'suggestions';
  if (Array.isArray(obj.cards)) return 'cards';
  if (Array.isArray(obj.steps)) return 'steps';
  if (Array.isArray(obj.sections)) return 'accordion';
  if (Array.isArray(obj.tabs)) return 'tabs';
  if (Array.isArray(obj.fields)) return 'form';
  if (obj.question && Array.isArray(obj.options) && 'answer' in obj) return 'quiz';
  if (obj.question && Array.isArray(obj.options)) return 'poll';
  if (CHART_TYPES.has(obj.type as string) && Array.isArray(obj.data)) return 'chart';
  if (typeof obj.type === 'string' && CALLOUT_TYPES.has(obj.type) && (obj.title || obj.content))
    return 'callout';
  if (Array.isArray(obj.items) && obj.items.length > 0) {
    const first = obj.items[0] as Record<string, unknown> | null;
    if (first && typeof first === 'object') {
      if ('url' in first) return 'media';
      if ('value' in first && 'label' in first) return 'progress';
    }
  }
  return null;
}

interface RichBlockRendererProps {
  lang: string;
  code: string;
  isStreaming?: boolean | undefined;
  onSendMessage?: ((message: string) => void) | undefined;
}

function LoadingFallback() {
  return (
    <div className="my-2 flex h-20 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
    </div>
  );
}

function StreamingFallback({ lang }: { lang: string }) {
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 p-3">
      <div className="mb-3 flex items-center gap-2">
        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        <span className="text-[11px] font-medium text-zinc-500">Generating {lang}…</span>
      </div>
      <div className="space-y-2">
        <div className="h-2.5 w-3/4 animate-pulse rounded bg-zinc-800" />
        <div className="h-2.5 w-1/2 animate-pulse rounded bg-zinc-800" />
        <div className="h-2.5 w-5/6 animate-pulse rounded bg-zinc-800" />
      </div>
    </div>
  );
}

function ErrorFallback({ code, lang }: { code: string; lang?: string | undefined }) {
  const lines = code.split('\n');
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-sm">
      <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-1">
        <span className="text-[10px] font-medium uppercase text-zinc-500">{lang || 'code'}</span>
      </div>
      <div className="overflow-x-auto p-3 text-zinc-400">
        {lines.map((line, i) => (
          <div key={i} dir="auto" className="whitespace-pre-wrap">{line || '\u00A0'}</div>
        ))}
      </div>
    </div>
  );
}

export function RichBlockRenderer({ lang, code, isStreaming, onSendMessage }: RichBlockRendererProps) {
  if (isStreaming) return <StreamingFallback lang={lang} />;

  // Mermaid uses raw syntax, not JSON
  if (lang === 'mermaid') {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <MermaidBlock source={code} />
      </Suspense>
    );
  }

  // All other blocks expect JSON
  let data: unknown;
  try {
    data = JSON.parse(code);
  } catch {
    return <ErrorFallback code={code} lang={lang} />;
  }

  const blockMap: Record<string, ReactElement> = {
    poll: <PollBlock data={data} onSendMessage={onSendMessage} />,
    chart: <ChartBlock data={data} />,
    form: <FormBlock data={data} onSendMessage={onSendMessage} />,
    quiz: <QuizBlock data={data} />,
    steps: <StepsBlock data={data} />,
    tabs: <TabsBlock data={data} />,
    callout: <CalloutBlock data={data} />,
    cards: <CardsBlock data={data} />,
    accordion: <AccordionBlock data={data} />,
    progress: <ProgressBlock data={data} />,
    media: <MediaBlock data={data} />,
    suggestions: <SuggestionsBlock data={data} onSendMessage={onSendMessage} />,
  };

  const element = blockMap[lang];
  if (!element) return <ErrorFallback code={code} lang={lang} />;

  return (
    <Suspense fallback={<LoadingFallback />}>
      {element}
    </Suspense>
  );
}
