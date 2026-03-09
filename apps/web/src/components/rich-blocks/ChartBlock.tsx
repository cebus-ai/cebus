interface ChartData {
  type?: string;
  title?: string;
  data?: { label: string; value: number; color?: string }[];
}

const COLORS = [
  '#6366f1', '#8b5cf6', '#a78bfa', '#c084fc',
  '#818cf8', '#60a5fa', '#38bdf8', '#22d3ee',
  '#2dd4bf', '#34d399', '#4ade80', '#a3e635',
];

function BarChart({ data, maxValue }: { data: ChartData['data']; maxValue: number }) {
  return (
    <div className="space-y-2">
      {data?.map((item, i) => {
        const pct = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
        const color = item.color ?? COLORS[i % COLORS.length]!;
        return (
          <div key={i}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-xs text-zinc-400">{item.label}</span>
              <span className="text-xs font-medium text-zinc-500">{item.value}</span>
            </div>
            <div dir="ltr" className="h-5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PieChart({ data, total }: { data: ChartData['data']; total: number }) {
  const segments: string[] = [];
  let cumulative = 0;
  data?.forEach((item, i) => {
    const pct = total > 0 ? (item.value / total) * 100 : 0;
    const color = item.color ?? COLORS[i % COLORS.length]!;
    segments.push(`${color} ${cumulative}% ${cumulative + pct}%`);
    cumulative += pct;
  });

  return (
    <div className="flex items-center gap-4">
      <div
        className="h-32 w-32 shrink-0 rounded-full"
        style={{ background: `conic-gradient(${segments.join(', ')})` }}
      />
      <div className="space-y-1">
        {data?.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: item.color ?? COLORS[i % COLORS.length] }}
            />
            <span className="text-xs text-zinc-400">{item.label}</span>
            <span className="text-xs text-zinc-600">
              {total > 0 ? Math.round((item.value / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineChart({ data, maxValue }: { data: ChartData['data']; maxValue: number }) {
  if (!data || data.length === 0) return null;
  const width = 300;
  const height = 120;
  const padding = 4;

  const points = data.map((item, i) => {
    const x = padding + (i / Math.max(data.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - (maxValue > 0 ? (item.value / maxValue) * (height - padding * 2) : 0);
    return `${x},${y}`;
  });

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full">
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke="#6366f1"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {data.map((item, i) => {
          const x = padding + (i / Math.max(data.length - 1, 1)) * (width - padding * 2);
          const y = height - padding - (maxValue > 0 ? (item.value / maxValue) * (height - padding * 2) : 0);
          return <circle key={i} cx={x} cy={y} r="3" fill="#6366f1" />;
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-zinc-600">
        {data.map((item, i) => (
          <span key={i}>{item.label}</span>
        ))}
      </div>
    </div>
  );
}

export default function ChartBlock({ data }: { data: unknown }) {
  const d = data as ChartData;
  const items = d.data ?? [];
  const maxValue = Math.max(...items.map((i) => i.value), 1);
  const total = items.reduce((a, b) => a + b.value, 0);
  const type = d.type ?? 'bar';

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-start">
      {d.title && (
        <div dir="auto" className="border-b border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-400">
          {d.title}
        </div>
      )}
      <div className="p-3">
        {type === 'pie' && <PieChart data={items} total={total} />}
        {type === 'line' && <LineChart data={items} maxValue={maxValue} />}
        {type === 'bar' && <BarChart data={items} maxValue={maxValue} />}
      </div>
    </div>
  );
}
