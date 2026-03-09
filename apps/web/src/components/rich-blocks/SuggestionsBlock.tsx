import { useState } from 'react';
import { ArrowRight, ArrowLeft } from 'lucide-react';

interface SuggestionsData {
  suggestions?: string[];
}

interface SuggestionsBlockProps {
  data: unknown;
  onSendMessage?: ((message: string) => void) | undefined;
}

export default function SuggestionsBlock({ data, onSendMessage }: SuggestionsBlockProps) {
  const d = data as SuggestionsData;
  const suggestions = d.suggestions ?? [];
  const [clicked, setClicked] = useState<number | null>(null);

  if (suggestions.length === 0 || !onSendMessage) return null;

  return (
    <div className="my-2 flex flex-wrap gap-1.5 text-start">
      {suggestions.map((text, i) => (
        <button
          key={i}
          onClick={() => {
            if (clicked !== null) return;
            setClicked(i);
            onSendMessage(text);
          }}
          disabled={clicked !== null}
          className={`group flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
            clicked === i
              ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-400'
              : clicked !== null
                ? 'border-zinc-800 text-zinc-600 opacity-50'
                : 'border-zinc-700/60 bg-zinc-800/50 text-zinc-400 hover:border-indigo-500/40 hover:bg-indigo-500/10 hover:text-indigo-400'
          }`}
        >
          <span>{text}</span>
          {clicked === null && (
            document.documentElement.dir === 'rtl'
              ? <ArrowLeft size={10} className="text-zinc-600 transition-colors group-hover:text-indigo-400" />
              : <ArrowRight size={10} className="text-zinc-600 transition-colors group-hover:text-indigo-400" />
          )}
        </button>
      ))}
    </div>
  );
}
