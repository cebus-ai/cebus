import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface AccordionData {
  sections?: { title: string; content: string }[];
}

export default function AccordionBlock({ data }: { data: unknown }) {
  const d = data as AccordionData;
  const sections = d.sections ?? [];
  const [openIndices, setOpenIndices] = useState<Set<number>>(new Set());

  const toggle = (index: number) => {
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
      {sections.map((section, i) => {
        const isOpen = openIndices.has(i);
        return (
          <div key={i} className={i > 0 ? 'border-t border-zinc-700' : ''}>
            <button
              onClick={() => toggle(i)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-start transition-colors hover:bg-zinc-800/50"
            >
              <span className="text-sm font-medium text-zinc-200">{section.title}</span>
              <ChevronDown
                size={14}
                className={`shrink-0 text-zinc-500 transition-transform duration-200 ${
                  isOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            {isOpen && (
              <div className="border-t border-zinc-800 px-3 py-2.5">
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
                  {section.content}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
