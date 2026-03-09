import { useState } from 'react';
import { Send, CheckCircle2 } from 'lucide-react';

interface FormField {
  type?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  options?: string[];
  required?: boolean;
}

interface FormData {
  title?: string;
  submitLabel?: string;
  fields?: FormField[];
}

export default function FormBlock({ data, onSendMessage }: { data: unknown; onSendMessage?: ((message: string) => void) | undefined }) {
  const d = data as FormData;
  const fields = d.fields ?? [];
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [submitted, setSubmitted] = useState(false);

  const updateValue = (name: string, value: string | boolean) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = () => {
    if (submitted) return;
    setSubmitted(true);

    if (onSendMessage) {
      const parts = fields
        .map((f) => {
          const key = f.name ?? f.label ?? '';
          const val = values[key];
          if (val === undefined || val === '') return null;
          return `**${f.label ?? key}**: ${String(val)}`;
        })
        .filter(Boolean);
      onSendMessage(parts.join('\n'));
    }
  };

  if (submitted) {
    const summaryItems = fields
      .map((f) => {
        const key = f.name ?? f.label ?? '';
        const val = values[key];
        if (val === undefined || val === '') return null;
        const type = f.type ?? 'text';
        let display: string;
        if (type === 'checkbox') {
          display = val ? 'Yes' : 'No';
        } else if (type === 'rating') {
          display = '★'.repeat(Number(val)) + '☆'.repeat(5 - Number(val));
        } else {
          display = String(val);
        }
        return { label: f.label ?? key, display };
      })
      .filter(Boolean) as { label: string; display: string }[];

    return (
      <div className="my-2 overflow-hidden rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-start">
        <div className="flex items-center gap-2 border-b border-emerald-500/20 px-3 py-2">
          <CheckCircle2 size={14} className="text-emerald-400" />
          <span className="text-xs font-medium text-emerald-400">
            {d.title ? `${d.title} — Submitted` : 'Form Submitted'}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2">
          {summaryItems.map((item, i) => (
            <span key={i} className="text-xs text-zinc-400">
              <span className="text-zinc-500">{item.label}:</span>{' '}
              <span className="text-zinc-300">{item.display}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-start">
      {d.title && (
        <div dir="auto" className="border-b border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-400">
          {d.title}
        </div>
      )}
      <div className="space-y-3 p-3">
        {fields.map((field, i) => {
          const key = field.name ?? field.label ?? `field-${i}`;
          const type = field.type ?? 'text';

          if (type === 'checkbox') {
            return (
              <label key={i} className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={!!values[key]}
                  onChange={(e) => updateValue(key, e.target.checked)}
                  className="rounded border-zinc-600 bg-zinc-800"
                />
                {field.label}
              </label>
            );
          }

          if (type === 'select' && field.options) {
            return (
              <div key={i}>
                {field.label && <label className="mb-1 block text-xs font-medium text-zinc-400">{field.label}</label>}
                <select
                  value={(values[key] as string) ?? ''}
                  onChange={(e) => updateValue(key, e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-300 outline-none focus:border-indigo-500"
                >
                  <option value="">Select...</option>
                  {field.options.map((opt, j) => (
                    <option key={j} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            );
          }

          if (type === 'rating') {
            const currentRating = Number(values[key]) || 0;
            return (
              <div key={i}>
                {field.label && <label className="mb-1 block text-xs font-medium text-zinc-400">{field.label}</label>}
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => updateValue(key, String(star))}
                      className={`text-lg transition-colors ${
                        star <= currentRating ? 'text-amber-400' : 'text-zinc-700 hover:text-zinc-500'
                      }`}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>
            );
          }

          // Default: text input
          return (
            <div key={i}>
              {field.label && <label className="mb-1 block text-xs font-medium text-zinc-400">{field.label}</label>}
              <input
                type="text"
                value={(values[key] as string) ?? ''}
                onChange={(e) => updateValue(key, e.target.value)}
                placeholder={field.placeholder ?? ''}
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-300 outline-none focus:border-indigo-500"
              />
            </div>
          );
        })}
        <button
          onClick={handleSubmit}
          className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
        >
          <Send size={12} />
          {d.submitLabel ?? 'Submit'}
        </button>
      </div>
    </div>
  );
}
