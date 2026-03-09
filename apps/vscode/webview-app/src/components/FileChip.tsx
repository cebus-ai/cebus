import React from 'react';
import type { FileAttachmentMeta } from '../hooks/useVSCodeMessages';

interface FileChipProps {
  attachment: FileAttachmentMeta;
  onRemove: (uri: string) => void;
}

const LANGUAGE_ICONS: Record<string, string> = {
  typescript: 'TS',
  javascript: 'JS',
  python: 'PY',
  rust: 'RS',
  go: 'GO',
  java: 'JV',
  csharp: 'C#',
  html: 'HT',
  css: 'CS',
  json: '{}',
  markdown: 'MD',
  yaml: 'YM',
  sql: 'SQ',
  bash: 'SH',
};

export function FileChip({ attachment, onRemove }: FileChipProps): React.ReactElement {
  const langIcon = LANGUAGE_ICONS[attachment.language] ?? attachment.language.slice(0, 2).toUpperCase();
  const rangeLabel = attachment.lineRange
    ? `L${attachment.lineRange.start}-${attachment.lineRange.end}`
    : `${attachment.lineCount}L`;

  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-badge/30 px-1.5 py-0.5 text-[11px]">
      <span className="rounded bg-primary/15 px-1 py-px text-[9px] font-bold text-primary">
        {langIcon}
      </span>
      <span className="max-w-[120px] truncate text-foreground" title={attachment.fileName}>
        {attachment.fileName}
      </span>
      <span className="text-muted">{rangeLabel}</span>
      <button
        onClick={() => onRemove(attachment.uri)}
        className="ml-0.5 text-muted hover:text-error"
        title="Remove file"
      >
        &#x2715;
      </button>
    </span>
  );
}
