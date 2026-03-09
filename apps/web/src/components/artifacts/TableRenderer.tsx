interface TableRendererProps {
  markdown: string;
}

export function TableRenderer({ markdown }: TableRendererProps) {
  const rows = parseMarkdownTable(markdown);
  if (rows.length === 0) return null;

  const headers = rows[0]!;
  const body = rows.slice(1);

  return (
    <div className="my-2 overflow-hidden rounded-md border border-zinc-800 text-start">
      <div className="flex items-center gap-2 bg-zinc-800/50 px-3 py-1.5">
        <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
          TABLE
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/50">
              {headers.map((cell, i) => (
                <th key={i} className="px-3 py-2 text-start text-xs font-semibold text-zinc-400">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, i) => (
              <tr
                key={i}
                className={`border-b border-zinc-800/50 ${i % 2 === 1 ? 'bg-zinc-900/30' : ''}`}
              >
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-1.5 text-zinc-300">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function parseMarkdownTable(md: string): string[][] {
  const lines = md.trim().split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];

  return lines
    .filter((line) => !line.match(/^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)*\|?\s*$/))
    .map((line) =>
      line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim()),
    );
}
