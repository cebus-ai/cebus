import { useState } from 'react';
import { ChevronDown, Check, X, Terminal } from 'lucide-react';

export interface ToolResultEntry {
  type: 'tool_call' | 'tool_result';
  toolName: string;
  content: string;
  isError: boolean;
}

export function ToolResultBlock({ entries }: { entries: ToolResultEntry[] }) {
  const [openIndices, setOpenIndices] = useState<Set<number>>(new Set());

  const toggle = (index: number): void => {
    setOpenIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-start">
      {entries.map((entry, i) => {
        const isOpen = openIndices.has(i);
        const label = entry.type === 'tool_call' ? 'Called' : 'Result';
        const StatusIcon = entry.isError ? X : Check;
        const statusColor = entry.isError ? 'text-red-400' : 'text-green-400';

        return (
          <div key={i} className={i > 0 ? 'border-t border-zinc-700' : ''}>
            <button
              onClick={() => toggle(i)}
              className="flex w-full items-center gap-2 px-3 py-2 text-start transition-colors hover:bg-zinc-800/50"
            >
              <Terminal size={14} className="shrink-0 text-zinc-500" />
              <span className="text-xs font-medium text-zinc-400">{label}:</span>
              <span className="truncate text-sm font-medium text-zinc-200">{entry.toolName}</span>
              <StatusIcon size={14} className={`shrink-0 ${statusColor}`} />
              <ChevronDown
                size={14}
                className={`ms-auto shrink-0 text-zinc-500 transition-transform duration-200 ${
                  isOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            {isOpen && (
              <div className="border-t border-zinc-800">
                <pre className="max-h-[200px] overflow-auto px-3 py-2.5 text-xs leading-relaxed text-zinc-400">
                  {entry.content}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
