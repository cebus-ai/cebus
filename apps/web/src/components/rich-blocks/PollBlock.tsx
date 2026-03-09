import { useState } from 'react';
import { BarChart3 } from 'lucide-react';

interface PollData {
  question?: string;
  options?: string[];
  multiSelect?: boolean;
}

interface PollBlockProps {
  data: unknown;
  onSendMessage?: ((message: string) => void) | undefined;
}

export default function PollBlock({ data, onSendMessage }: PollBlockProps) {
  const d = data as PollData;
  const options = d.options ?? [];
  const [votes, setVotes] = useState<number[]>(() => options.map(() => 0));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const hasVoted = selected.size > 0;
  const total = votes.reduce((a, b) => a + b, 0);

  const handleVote = (index: number) => {
    if (hasVoted && !d.multiSelect) return;

    if (d.multiSelect) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(index)) {
          next.delete(index);
          setVotes((v) => v.map((val, i) => (i === index ? Math.max(0, val - 1) : val)));
        } else {
          next.add(index);
          setVotes((v) => v.map((val, i) => (i === index ? val + 1 : val)));
        }
        return next;
      });
    } else {
      setSelected(new Set([index]));
      setVotes((v) => v.map((val, i) => (i === index ? val + 1 : val)));

      // Send the vote as a message so models can react
      if (onSendMessage && options[index]) {
        const label = options[index];
        const msg = d.question
          ? `I voted **"${label}"** on the poll: *${d.question}*`
          : `I voted **"${label}"**`;
        onSendMessage(msg);
      }
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-start">
      <div className="flex items-center gap-2 border-b border-zinc-700 px-3 py-2">
        <BarChart3 size={14} className="text-indigo-400" />
        <span className="text-xs font-medium text-indigo-400">POLL</span>
      </div>
      <div className="p-3">
        {d.question && (
          <div dir="auto" className="mb-3 text-sm font-semibold text-zinc-200">{d.question}</div>
        )}
        <div className="space-y-2">
          {options.map((option, i) => {
            const pct = total > 0 ? Math.round((votes[i]! / total) * 100) : 0;
            const isSelected = selected.has(i);

            return (
              <button
                key={i}
                onClick={() => handleVote(i)}
                disabled={hasVoted && !d.multiSelect}
                className={`group relative w-full overflow-hidden rounded-md border text-start transition-all ${
                  isSelected
                    ? 'border-indigo-500/50 bg-indigo-500/10'
                    : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600 hover:bg-zinc-800'
                } ${hasVoted && !d.multiSelect ? 'cursor-default' : 'cursor-pointer'}`}
              >
                {hasVoted && (
                  <div
                    className="absolute inset-y-0 start-0 bg-indigo-500/10 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                )}
                <div className="relative flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        isSelected
                          ? 'border-indigo-400 bg-indigo-500'
                          : 'border-zinc-600'
                      }`}
                    >
                      {isSelected && (
                        <div className="h-1.5 w-1.5 rounded-full bg-white" />
                      )}
                    </div>
                    <span className="text-sm text-zinc-300">{option}</span>
                  </div>
                  {hasVoted && (
                    <span className="text-xs font-medium text-zinc-500">{pct}%</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        {hasVoted && (
          <div className="mt-2 text-[11px] text-zinc-600">
            {total} vote{total !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}
