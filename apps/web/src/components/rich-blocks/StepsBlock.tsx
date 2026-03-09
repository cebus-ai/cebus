import { CheckCircle2 } from 'lucide-react';

interface StepsData {
  title?: string;
  steps?: { label: string; description?: string }[];
}

export default function StepsBlock({ data }: { data: unknown }) {
  const d = data as StepsData;
  const steps = d.steps ?? [];

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-start">
      {d.title && (
        <div dir="auto" className="border-b border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-400">
          {d.title}
        </div>
      )}
      <div className="p-3">
        <div className="space-y-0">
          {steps.map((step, i) => (
            <div key={i} className="flex gap-3">
              {/* Vertical line + circle */}
              <div className="flex flex-col items-center">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-indigo-500/50 bg-indigo-500/10">
                  {i === steps.length - 1 ? (
                    <CheckCircle2 size={12} className="text-indigo-400" />
                  ) : (
                    <span className="text-[10px] font-bold text-indigo-400">{i + 1}</span>
                  )}
                </div>
                {i < steps.length - 1 && (
                  <div className="w-px flex-1 bg-zinc-700" />
                )}
              </div>
              {/* Content */}
              <div className={`${i < steps.length - 1 ? 'pb-4' : ''} pt-0.5`}>
                <div className="text-sm font-medium text-zinc-200">{step.label}</div>
                {step.description && (
                  <div className="mt-0.5 text-xs leading-relaxed text-zinc-500">{step.description}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
