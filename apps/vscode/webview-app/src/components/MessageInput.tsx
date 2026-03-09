import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { ParticipantInfo, FileAttachmentMeta } from '../hooks/useVSCodeMessages';
import { resolveProviderStyle } from '../lib/provider-styles';
import { FileChip } from './FileChip';

interface MessageInputProps {
  onSend: (content: string) => void;
  onCancel: () => void;
  disabled: boolean;
  isStreaming: boolean;
  participants: ParticipantInfo[];
  attachments?: FileAttachmentMeta[];
  onRequestFilePicker?: () => void;
  onAttachActiveFile?: () => void;
  onRemoveAttachment?: (uri: string) => void;
  onAttachByUri?: (uri: string) => void;
  onAttachSelection?: () => void;
  onPasteImage?: (dataUrl: string, fileName: string) => void;
}

export function MessageInput({
  onSend,
  onCancel,
  disabled,
  isStreaming,
  participants,
  attachments = [],
  onRequestFilePicker,
  onAttachActiveFile,
  onRemoveAttachment,
  onAttachByUri,
  onAttachSelection,
  onPasteImage,
}: MessageInputProps): React.ReactElement {
  const [value, setValue] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIdx, setMentionIdx] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const agentParticipants = participants.filter(p => p.id !== 'user');

  const filtered = mentionFilter
    ? agentParticipants.filter(p =>
        p.displayName.toLowerCase().includes(mentionFilter.toLowerCase())
      )
    : agentParticipants;

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = 5 * 20; // ~5 rows
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [value]);

  const closeMention = useCallback(() => {
    setMentionOpen(false);
    setMentionFilter('');
    setMentionIdx(0);
  }, []);

  const insertMention = useCallback(
    (participant: ParticipantInfo) => {
      const el = textareaRef.current;
      if (!el) return;
      const cursorPos = el.selectionStart;
      const before = value.slice(0, cursorPos);
      const after = value.slice(cursorPos);
      // Find the @ that started this mention
      const atIdx = before.lastIndexOf('@');
      if (atIdx === -1) return;
      const newValue = `${before.slice(0, atIdx)}@${participant.displayName} ${after}`;
      setValue(newValue);
      closeMention();
      // Restore focus
      requestAnimationFrame(() => {
        const newCursor = atIdx + participant.displayName.length + 2;
        el.setSelectionRange(newCursor, newCursor);
        el.focus();
      });
    },
    [value, closeMention]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newVal = e.target.value;
      setValue(newVal);

      const cursorPos = e.target.selectionStart;
      const textBefore = newVal.slice(0, cursorPos);
      const atIdx = textBefore.lastIndexOf('@');

      if (atIdx !== -1 && (atIdx === 0 || textBefore[atIdx - 1] === ' ')) {
        const query = textBefore.slice(atIdx + 1);
        if (!query.includes(' ') || query.length < 30) {
          setMentionOpen(true);
          setMentionFilter(query);
          setMentionIdx(0);
          return;
        }
      }
      closeMention();
    },
    [closeMention]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (!trimmed || disabled) return;
      onSend(trimmed);
      setValue('');
      closeMention();
    },
    [value, disabled, onSend, closeMention]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionOpen && filtered.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIdx(i => (i + 1) % filtered.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIdx(i => (i - 1 + filtered.length) % filtered.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          insertMention(filtered[mentionIdx]!);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closeMention();
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed && !disabled) {
          onSend(trimmed);
          setValue('');
          closeMention();
        }
      }
    },
    [value, disabled, onSend, mentionOpen, filtered, mentionIdx, insertMention, closeMention]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!onPasteImage) return;
      const items = e.clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const ext = item.type.split('/')[1] ?? 'png';
            onPasteImage(dataUrl, `paste-${Date.now()}.${ext}`);
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    },
    [onPasteImage]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    },
    []
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
    },
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (!onAttachByUri) return;

      // VS Code webviews receive file URIs via text/uri-list
      const uriList = e.dataTransfer.getData('text/uri-list');
      if (uriList) {
        for (const line of uriList.split('\n')) {
          const uri = line.trim();
          if (uri && !uri.startsWith('#')) {
            onAttachByUri(uri);
          }
        }
        return;
      }

      // Fallback: plain text that looks like a file URI
      const text = e.dataTransfer.getData('text/plain');
      if (text && (text.startsWith('file://') || text.startsWith('vscode-'))) {
        onAttachByUri(text.trim());
      }
    },
    [onAttachByUri]
  );

  return (
    <div
      className={`relative border-t border-border p-2 ${isDragOver ? 'ring-2 ring-primary/50 bg-primary/5' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop zone indicator */}
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary/50 bg-primary/5">
          <span className="text-xs font-medium text-primary">Drop file to attach</span>
        </div>
      )}

      {/* @mention dropdown */}
      {mentionOpen && filtered.length > 0 && (
        <div className="absolute bottom-full left-2 right-2 mb-1 overflow-hidden rounded-md border border-border bg-background shadow-lg">
          {filtered.map((p, i) => {
            const style = p.providerId
              ? resolveProviderStyle(p.providerId, p.modelId)
              : undefined;
            return (
              <button
                key={p.id}
                onMouseDown={e => {
                  e.preventDefault();
                  insertMention(p);
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm ${
                  i === mentionIdx
                    ? 'bg-primary/15 text-foreground'
                    : 'text-muted hover:bg-badge/30'
                }`}
              >
                <span
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px]"
                  style={{
                    backgroundColor: `${style?.color ?? '#8b5cf6'}20`,
                    color: style?.color ?? '#8b5cf6',
                  }}
                >
                  {style?.icon ?? p.displayName.charAt(0)}
                </span>
                <span style={{ color: style?.color }}>{p.displayName}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* File attachment chips */}
      {attachments.length > 0 && onRemoveAttachment && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {attachments.map(a => (
            <FileChip key={a.uri} attachment={a} onRemove={onRemoveAttachment} />
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-1.5">
        <div className="flex-1 rounded-lg border border-input-border bg-input-bg focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/30">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onBlur={() => {
              // Delay to allow click on mention item
              setTimeout(() => closeMention(), 150);
            }}
            placeholder="Message... (@ to mention)"
            disabled={disabled}
            rows={1}
            className="block w-full resize-none bg-transparent px-2.5 py-1.5 text-sm text-input-fg placeholder:text-muted focus:outline-none"
          />
        </div>

        {/* File attachment buttons */}
        {onRequestFilePicker && (
          <button
            type="button"
            onClick={onRequestFilePicker}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted hover:bg-badge/40 hover:text-foreground"
            title="Attach file"
          >
            {/* Paperclip icon */}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 6.5L7 11.5C5.62 12.88 3.38 12.88 2 11.5C0.62 10.12 0.62 7.88 2 6.5L7 1.5C7.97 0.53 9.53 0.53 10.5 1.5C11.47 2.47 11.47 4.03 10.5 5L5.5 10C5.01 10.49 4.24 10.49 3.75 10C3.26 9.51 3.26 8.74 3.75 8.25L8.25 3.75" />
            </svg>
          </button>
        )}

        {onAttachActiveFile && (
          <button
            type="button"
            onClick={onAttachActiveFile}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted hover:bg-badge/40 hover:text-foreground"
            title="Attach active file"
          >
            {/* Document icon */}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 1H3.5C2.67 1 2 1.67 2 2.5V11.5C2 12.33 2.67 13 3.5 13H10.5C11.33 13 12 12.33 12 11.5V5L8 1Z" />
              <path d="M8 1V5H12" />
            </svg>
          </button>
        )}

        {onAttachSelection && (
          <button
            type="button"
            onClick={onAttachSelection}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted hover:bg-badge/40 hover:text-foreground"
            title="Attach editor selection"
          >
            {/* Text selection icon */}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3h8M3 7h5M3 11h7" />
              <path d="M11 6v6" strokeDasharray="1.5 1.5" />
            </svg>
          </button>
        )}

        {isStreaming ? (
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-error text-white hover:opacity-80"
            title="Stop"
          >
            {/* Square stop icon */}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="1" y="1" width="10" height="10" rx="1" />
            </svg>
          </button>
        ) : (
          <button
            type="submit"
            disabled={disabled || !value.trim()}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
            title="Send"
          >
            {/* Arrow up send icon */}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 12V3" />
              <path d="M3 7L7 2L11 7" />
            </svg>
          </button>
        )}
      </form>
    </div>
  );
}
