import { useState } from 'react';
import { HighlightedCode, CopyButton, detectLang, stripFences } from '../chat/CodeRendering';
import { MarkdownContent } from '../chat/MarkdownContent';

interface TabsData {
  tabs?: { label: string; content: string; lang?: string }[];
}

export default function TabsBlock({ data }: { data: unknown }) {
  const d = data as TabsData;
  const tabs = d.tabs ?? [];
  const [activeIndex, setActiveIndex] = useState(0);

  if (tabs.length === 0) return null;

  const activeTab = tabs[activeIndex];
  const stripped = activeTab ? stripFences(activeTab.content) : null;
  const code = stripped?.code ?? '';
  const lang = activeTab
    ? (activeTab.lang ?? detectLang(activeTab.label, activeTab.content))
    : 'text';

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-sm">
      <div className="flex items-center justify-between border-b border-zinc-700">
        <div className="flex overflow-x-auto bg-zinc-800/50">
          {tabs.map((tab, i) => (
            <button
              key={i}
              onClick={() => setActiveIndex(i)}
              className={`relative whitespace-nowrap px-3 py-2 text-xs font-medium transition-colors ${
                i === activeIndex
                  ? 'text-indigo-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab.label}
              {i === activeIndex && (
                <div className="absolute inset-x-0 bottom-0 h-0.5 bg-indigo-500" />
              )}
            </button>
          ))}
        </div>
        {activeTab && <CopyButton text={code} />}
      </div>
      {activeTab && (
        <div className="max-h-96 overflow-y-auto">
          {lang === 'text' || lang === 'markdown' ? (
            <div dir="auto" className="p-3">
              <MarkdownContent content={code} />
            </div>
          ) : (
            <HighlightedCode lang={lang} code={code} />
          )}
        </div>
      )}
    </div>
  );
}
