import { useState, type ReactElement } from 'react';
import { HelpCircle, CheckCircle, XCircle } from 'lucide-react';

interface QuizData {
  question?: string;
  options?: string[];
  answer?: number;
  explanation?: string;
}

export default function QuizBlock({ data }: { data: unknown }) {
  const d = data as QuizData;
  const options = d.options ?? [];
  const correctIndex = d.answer ?? 0;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const revealed = selectedIndex !== null;

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-start">
      <div className="flex items-center gap-2 border-b border-zinc-700 px-3 py-2">
        <HelpCircle size={14} className="text-amber-400" />
        <span className="text-xs font-medium text-amber-400">QUIZ</span>
      </div>
      <div className="p-3">
        {d.question && (
          <div dir="auto" className="mb-3 text-sm font-semibold text-zinc-200">{d.question}</div>
        )}
        <div className="space-y-2">
          {options.map((option, i) => {
            const isCorrect = i === correctIndex;
            const isSelected = i === selectedIndex;
            let borderClass = 'border-zinc-700';
            let bgClass = 'bg-zinc-800/50';
            let iconEl: ReactElement | null = null;

            if (revealed) {
              if (isCorrect) {
                borderClass = 'border-emerald-500/50';
                bgClass = 'bg-emerald-500/10';
                iconEl = <CheckCircle size={14} className="shrink-0 text-emerald-400" />;
              } else if (isSelected && !isCorrect) {
                borderClass = 'border-red-500/50';
                bgClass = 'bg-red-500/10';
                iconEl = <XCircle size={14} className="shrink-0 text-red-400" />;
              }
            }

            return (
              <button
                key={i}
                onClick={() => !revealed && setSelectedIndex(i)}
                disabled={revealed}
                className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-start text-sm transition-all ${borderClass} ${bgClass} ${
                  revealed ? 'cursor-default' : 'cursor-pointer hover:border-zinc-600 hover:bg-zinc-800'
                }`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-600 text-[10px] font-medium text-zinc-500">
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="flex-1 text-zinc-300">{option}</span>
                {iconEl}
              </button>
            );
          })}
        </div>
        {revealed && d.explanation && (
          <div className="mt-3 rounded-md border border-zinc-700 bg-zinc-800/50 p-2.5 text-xs leading-relaxed text-zinc-400">
            {d.explanation}
          </div>
        )}
      </div>
    </div>
  );
}
