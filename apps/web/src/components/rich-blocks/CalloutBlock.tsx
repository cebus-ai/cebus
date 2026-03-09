import { Info, AlertTriangle, XCircle, CheckCircle, Lightbulb } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface CalloutData {
  type?: string;
  title?: string;
  content?: string;
}

const VARIANTS: Record<string, { icon: typeof Info; border: string; bg: string; iconColor: string; titleColor: string }> = {
  info: { icon: Info, border: 'border-blue-500/30', bg: 'bg-blue-500/5', iconColor: 'text-blue-400', titleColor: 'text-blue-300' },
  warning: { icon: AlertTriangle, border: 'border-amber-500/30', bg: 'bg-amber-500/5', iconColor: 'text-amber-400', titleColor: 'text-amber-300' },
  error: { icon: XCircle, border: 'border-red-500/30', bg: 'bg-red-500/5', iconColor: 'text-red-400', titleColor: 'text-red-300' },
  success: { icon: CheckCircle, border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', iconColor: 'text-emerald-400', titleColor: 'text-emerald-300' },
  tip: { icon: Lightbulb, border: 'border-violet-500/30', bg: 'bg-violet-500/5', iconColor: 'text-violet-400', titleColor: 'text-violet-300' },
};

export default function CalloutBlock({ data }: { data: unknown }) {
  const d = data as CalloutData;
  const variant = VARIANTS[d.type ?? 'info'] ?? VARIANTS.info!;
  const Icon = variant.icon;

  return (
    <div className={`my-2 flex gap-3 rounded-lg border text-start ${variant.border} ${variant.bg} p-3`}>
      <Icon size={18} className={`mt-0.5 shrink-0 ${variant.iconColor}`} />
      <div className="min-w-0 flex-1">
        {d.title && (
          <div dir="auto" className={`mb-1 text-sm font-semibold ${variant.titleColor}`}>{d.title}</div>
        )}
        {d.content && (
          <div dir="auto" className="prose-sm prose-invert max-w-none text-sm leading-relaxed text-zinc-300 [&_ol]:list-decimal [&_ol]:ps-4 [&_ul]:list-disc [&_ul]:ps-4 [&_li]:my-0.5 [&_p]:my-1 [&_p:first-child]:mt-0 [&_strong]:text-zinc-100">
            <Markdown remarkPlugins={[remarkGfm]}>{d.content}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}
