interface ProgressData {
  items?: { label: string; value: number; max?: number; color?: string }[];
}

const COLORS = ['#6366f1', '#8b5cf6', '#34d399', '#f59e0b', '#ef4444', '#06b6d4'];

export default function ProgressBlock({ data }: { data: unknown }) {
  const d = data as ProgressData;
  const items = d.items ?? [];

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-start">
      <div className="space-y-3">
        {items.map((item, i) => {
          const max = item.max ?? 100;
          const pct = max > 0 ? Math.min(Math.round((item.value / max) * 100), 100) : 0;
          const color = item.color ?? COLORS[i % COLORS.length]!;

          return (
            <div key={i}>
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-xs font-medium text-zinc-300">{item.label}</span>
                <span className="text-xs text-zinc-500">{pct}%</span>
              </div>
              <div dir="ltr" className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
