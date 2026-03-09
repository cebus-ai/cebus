import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ArrowUp, Square, X, Plus, XCircle, SlidersHorizontal, Paperclip } from 'lucide-react';
import { useI18n } from '../../lib/i18n';

interface MentionableAgent {
  id: string;
  displayName: string;
  avatarLetter: string;
  avatarColor: string;
  avatarIcon?: string | undefined;
  roleName?: string | null | undefined;
  provider?: string | undefined;
  model?: string | undefined;
}

/** A file selected for attachment. */
interface AttachmentPreview {
  file: File;
  previewUrl?: string | undefined;
}

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
const ACCEPTED_FILE_EXTS = '.png,.jpg,.jpeg,.gif,.webp,.svg,.txt,.md,.ts,.js,.py,.json,.yaml,.yml,.toml,.csv';

interface MessageInputProps {
  onSend: (content: string, contextSize?: number | undefined, directedTo?: string[] | undefined, attachments?: File[] | undefined) => void;
  disabled?: boolean;
  isSending?: boolean;
  agents?: MentionableAgent[] | undefined;
  placeholder?: string | undefined;
  chatMode?: string | undefined;
  orchestratorEnabled?: boolean | undefined;
  defaultContextSize?: number | undefined;
  isGenerating?: boolean | undefined;
  onCancelGeneration?: (() => void) | undefined;
}

function parseMentionedAgents(text: string, agents: MentionableAgent[]): MentionableAgent[] {
  const mentionPattern = /@([\w.+-]+(?:\s[\w.+-]+)*(?:\s*\([^)]*\))?)/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = mentionPattern.exec(text)) !== null) {
    mentions.push(match[1]!.toLowerCase());
  }
  if (mentions.length === 0) return [];

  return agents.filter(a => {
    const name = a.displayName.toLowerCase();
    const nameWithRole = a.roleName ? `${a.displayName} (${a.roleName})`.toLowerCase() : null;
    return mentions.some(m => {
      const hasRoleSuffix = /\([^)]+\)/.test(m);
      // If mention includes a role, only match agents with that exact role
      if (hasRoleSuffix) {
        return nameWithRole !== null && (m.includes(nameWithRole) || nameWithRole.includes(m));
      }
      return name.includes(m) || m.includes(name);
    });
  });
}

export function MessageInput({
  onSend,
  disabled,
  isSending,
  agents = [],
  placeholder,
  chatMode,
  orchestratorEnabled,
  defaultContextSize = 30,
  isGenerating,
  onCancelGeneration,
}: MessageInputProps) {
  const [value, setValue] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [excludedAgentIds, setExcludedAgentIds] = useState<Set<string>>(new Set());
  const [contextSize, setContextSize] = useState<number | undefined>(undefined);
  const [showContextControl, setShowContextControl] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contextControlRef = useRef<HTMLDivElement>(null);
  const { t, isRtl } = useI18n();

  const addFiles = useCallback((files: FileList | File[]) => {
    const newAttachments: AttachmentPreview[] = [];
    for (const file of Array.from(files)) {
      const previewUrl = ACCEPTED_IMAGE_TYPES.includes(file.type)
        ? URL.createObjectURL(file)
        : undefined;
      newAttachments.push({ file, previewUrl });
    }
    setAttachments(prev => [...prev, ...newAttachments]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => {
      const removed = prev[index];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // Clean up preview URLs on unmount
  useEffect(() => {
    return () => {
      for (const att of attachments) {
        if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
      }
    };
  }, []);

  // Close context slider on click outside
  useEffect(() => {
    if (!showContextControl) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (contextControlRef.current && !contextControlRef.current.contains(e.target as Node)) {
        setShowContextControl(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showContextControl]);

  // Determine if we're in a mention-driven mode (tag_only or orchestrator)
  const isMentionDriven = chatMode === 'tag_only' || orchestratorEnabled === true;

  const filteredAgents = agents.filter((a) =>
    a.displayName.toLowerCase().includes(mentionFilter.toLowerCase()),
  );

  // Compute effective recipients based on mode
  const mentionedAgents = useMemo(() => parseMentionedAgents(value, agents), [value, agents]);

  const recipients = useMemo(() => {
    if (isMentionDriven) {
      return mentionedAgents;
    }
    // Broadcast modes: all agents minus excluded
    return agents.filter(a => !excludedAgentIds.has(a.id));
  }, [isMentionDriven, mentionedAgents, agents, excludedAgentIds]);

  // Reset excludedAgentIds when mode or agents change
  useEffect(() => {
    setExcludedAgentIds(new Set());
  }, [chatMode, orchestratorEnabled]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionFilter]);

  const removeMention = useCallback(
    (agent: MentionableAgent) => {
      const escaped = agent.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`@${escaped}(?:\\s*\\([^)]*\\))?\\s?`, 'gi');
      const newValue = value.replace(pattern, '');
      setValue(newValue);
    },
    [value],
  );

  const removeRecipient = useCallback(
    (agent: MentionableAgent) => {
      if (isMentionDriven) {
        removeMention(agent);
      } else {
        setExcludedAgentIds(prev => new Set([...prev, agent.id]));
      }
    },
    [isMentionDriven, removeMention],
  );

  const addRecipient = useCallback(
    (agent: MentionableAgent) => {
      if (isMentionDriven) {
        // Insert @mention at cursor
        const el = textareaRef.current;
        const mentionName = agent.roleName
          ? `${agent.displayName} (${agent.roleName})`
          : agent.displayName;
        const mention = `@${mentionName} `;
        if (el) {
          const pos = el.selectionStart;
          const newValue = value.slice(0, pos) + mention + value.slice(pos);
          setValue(newValue);
          setTimeout(() => {
            const newPos = pos + mention.length;
            el.focus();
            el.setSelectionRange(newPos, newPos);
          }, 0);
        } else {
          setValue(prev => mention + prev);
        }
      } else {
        setExcludedAgentIds(prev => {
          const next = new Set(prev);
          next.delete(agent.id);
          return next;
        });
      }
    },
    [isMentionDriven, value],
  );

  const insertMention = useCallback(
    (agent: MentionableAgent) => {
      const el = textareaRef.current;
      if (!el) return;

      const pos = el.selectionStart;
      const before = value.slice(0, pos);
      const after = value.slice(pos);

      const atIndex = before.lastIndexOf('@');
      if (atIndex === -1) return;

      const mentionText = agent.roleName
        ? `${agent.displayName} (${agent.roleName})`
        : agent.displayName;
      const newValue = before.slice(0, atIndex) + `@${mentionText} ` + after;
      setValue(newValue);
      setMentionOpen(false);
      setMentionFilter('');

      // Also remove from excluded set for broadcast modes
      if (!isMentionDriven) {
        setExcludedAgentIds(prev => {
          const next = new Set(prev);
          next.delete(agent.id);
          return next;
        });
      }

      setTimeout(() => {
        const newPos = atIndex + mentionText.length + 2;
        el.focus();
        el.setSelectionRange(newPos, newPos);
      }, 0);
    },
    [value, isMentionDriven],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setValue(newValue);

      const pos = e.target.selectionStart;
      const textBefore = newValue.slice(0, pos);
      const atIndex = textBefore.lastIndexOf('@');

      if (atIndex !== -1 && (atIndex === 0 || textBefore[atIndex - 1] === ' ')) {
        const query = textBefore.slice(atIndex + 1);
        if (!query.includes(' ')) {
          setMentionOpen(true);
          setMentionFilter(query);
          return;
        }
      }
      setMentionOpen(false);
    },
    [],
  );

  const noRecipients = agents.length > 1 && recipients.length === 0 && !orchestratorEnabled;

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || disabled || isSending || noRecipients) return;

    // Pass directed agent IDs when not sending to all agents
    const directedTo = recipients.length > 0 && recipients.length < agents.length
      ? recipients.map(r => r.id)
      : undefined;

    const files = attachments.length > 0 ? attachments.map(a => a.file) : undefined;
    onSend(value.trim(), contextSize, directedTo, files);
    setValue('');
    setMentionOpen(false);
    setExcludedAgentIds(new Set());
    setContextSize(undefined);
    setShowContextControl(false);
    // Clean up preview URLs
    for (const att of attachments) {
      if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
    }
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, isSending, noRecipients, onSend, recipients, agents, contextSize, attachments]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (mentionOpen && filteredAgents.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex((i) => (i + 1) % filteredAgents.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex((i) => (i - 1 + filteredAgents.length) % filteredAgents.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          insertMention(filteredAgents[mentionIndex]!);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setMentionOpen(false);
          return;
        }
      }
      if (e.key === 'Escape' && isGenerating && onCancelGeneration) {
        e.preventDefault();
        onCancelGeneration();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, mentionOpen, filteredAgents, mentionIndex, insertMention, isGenerating, onCancelGeneration],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      const imageFiles = Array.from(files).filter(f => ACCEPTED_IMAGE_TYPES.includes(f.type));
      if (imageFiles.length > 0) {
        e.preventDefault();
        addFiles(imageFiles);
      }
    }
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      addFiles(files);
    }
  }, [addFiles]);

  // Agents not currently in recipient list (for + button dropdown)
  const availableToAdd = useMemo(() => {
    const recipientIds = new Set(recipients.map(r => r.id));
    return agents.filter(a => !recipientIds.has(a.id));
  }, [agents, recipients]);

  // Recipient bar label for empty states
  const recipientLabel = useMemo(() => {
    if (orchestratorEnabled) return t('chat.orchestratorDecides');
    if (chatMode === 'tag_only') return t('chat.tagMention');
    if (recipients.length === agents.length && agents.length > 0) return null; // show chips
    return null;
  }, [orchestratorEnabled, chatMode, recipients.length, agents.length, t]);

  const effectiveContextSize = contextSize ?? defaultContextSize;

  return (
    <div
      className={`relative px-4 py-3 ${isDragOver ? 'ring-2 ring-indigo-500/50 rounded-xl' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* @mention dropdown */}
      {mentionOpen && filteredAgents.length > 0 && (
        <div className="absolute bottom-full start-4 end-4 mb-1 max-h-48 overflow-y-auto rounded-xl border border-zinc-700/60 bg-zinc-800/95 py-1 shadow-2xl backdrop-blur-sm">
          {filteredAgents.map((agent, i) => (
            <button
              key={agent.id}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(agent);
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm transition-colors ${
                i === mentionIndex
                  ? 'bg-indigo-600/20 text-zinc-100'
                  : 'text-zinc-300 hover:bg-zinc-700/50'
              }`}
            >
              {agent.avatarIcon ? (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-sm">{agent.avatarIcon}</span>
              ) : (
                <div
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                  style={{ backgroundColor: agent.avatarColor }}
                >
                  {agent.avatarLetter}
                </div>
              )}
              <span>{agent.displayName}</span>
              {agent.roleName && (
                <span className="text-[10px] text-indigo-400/50">{agent.roleName}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Recipient bar — always visible */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-medium text-zinc-500">{t('chat.to')}</span>
        {recipients.length > 0 ? (
          recipients.map((agent) => (
            <span
              key={agent.id}
              className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 py-0.5 ps-1.5 pe-1 text-[11px] font-medium text-indigo-400"
            >
              {agent.avatarIcon ? (
                <span className="flex h-3.5 w-3.5 items-center justify-center text-[10px]">{agent.avatarIcon}</span>
              ) : (
                <span
                  className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[7px] font-bold text-white"
                  style={{ backgroundColor: agent.avatarColor }}
                >
                  {agent.avatarLetter}
                </span>
              )}
              {agent.displayName}
              {agent.roleName && (
                <span className="text-[9px] text-indigo-400/50">{agent.roleName}</span>
              )}
              <button
                onClick={() => removeRecipient(agent)}
                className="ms-0.5 rounded-full p-0.5 text-indigo-400/60 transition-colors hover:bg-indigo-500/20 hover:text-indigo-300"
              >
                <X size={9} />
              </button>
            </span>
          ))
        ) : (
          <span className="text-[10px] text-zinc-500">
            {recipientLabel ?? 'All agents'}
          </span>
        )}

        {/* + button: add agent back */}
        {availableToAdd.length > 0 && !isMentionDriven && (
          <div className="group relative">
            <button
              className="flex h-5 w-5 items-center justify-center rounded-full border border-zinc-700/50 text-zinc-500 transition-colors hover:border-indigo-500/40 hover:text-indigo-400"
              title="Add agent"
            >
              <Plus size={10} />
            </button>
            <div className="absolute bottom-full start-0 mb-1 hidden min-w-[140px] rounded-lg border border-zinc-700/60 bg-zinc-800/95 py-1 shadow-xl group-hover:block">
              {availableToAdd.map((agent) => (
                <button
                  key={agent.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addRecipient(agent);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs text-zinc-300 transition-colors hover:bg-zinc-700/50"
                >
                  {agent.avatarIcon ? (
                    <span className="flex h-3.5 w-3.5 items-center justify-center text-[10px]">{agent.avatarIcon}</span>
                  ) : (
                    <span
                      className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[7px] font-bold text-white"
                      style={{ backgroundColor: agent.avatarColor }}
                    >
                      {agent.avatarLetter}
                    </span>
                  )}
                  {agent.displayName}
                  {agent.roleName && (
                    <span className="text-[9px] text-indigo-400/50">{agent.roleName}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Clear all / Restore all */}
        {!isMentionDriven && agents.length > 1 && (
          <>
            {excludedAgentIds.size > 0 && (
              <button
                onClick={() => setExcludedAgentIds(new Set())}
                className="flex h-5 items-center gap-0.5 rounded-full border border-zinc-700/50 px-1.5 text-[10px] text-zinc-500 transition-colors hover:border-emerald-500/40 hover:text-emerald-400"
                title="Restore all agents"
              >
                <Plus size={9} />
                All
              </button>
            )}
            {excludedAgentIds.size < agents.length && recipients.length > 0 && (
              <button
                onClick={() => setExcludedAgentIds(new Set(agents.map(a => a.id)))}
                className="flex h-5 items-center gap-0.5 rounded-full border border-zinc-700/50 px-1.5 text-[10px] text-zinc-500 transition-colors hover:border-red-500/40 hover:text-red-400"
                title="Clear all agents"
              >
                <XCircle size={9} />
                Clear
              </button>
            )}
          </>
        )}

        {/* Context size toggle */}
        <button
          onClick={() => setShowContextControl(!showContextControl)}
          className={`ms-auto flex h-5 items-center gap-1 rounded-full border px-1.5 text-[10px] transition-colors ${
            showContextControl
              ? 'border-indigo-500/40 text-indigo-400'
              : 'border-zinc-700/50 text-zinc-500 hover:text-zinc-400'
          }`}
          title="Adjust context window"
        >
          <SlidersHorizontal size={9} />
          <span>{effectiveContextSize}</span>
        </button>
      </div>

      {/* Context size slider */}
      {showContextControl && (
        <div ref={contextControlRef} className="mb-2 flex items-center gap-2 rounded-lg border border-zinc-700/40 bg-zinc-800/50 px-3 py-1.5">
          <span className="text-[10px] text-zinc-500">Context:</span>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={effectiveContextSize}
            onChange={(e) => setContextSize(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-indigo-500"
          />
          <input
            type="number"
            min={1}
            max={100}
            value={effectiveContextSize}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 1 && v <= 100) setContextSize(v);
            }}
            className="w-12 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-center text-[11px] text-zinc-300 focus:border-indigo-500 focus:outline-none"
          />
          <span className="text-[10px] text-zinc-600">msgs</span>
          {contextSize !== undefined && (
            <button
              onClick={() => setContextSize(undefined)}
              className="text-[10px] text-zinc-500 hover:text-zinc-300"
              title="Reset to default"
            >
              Reset
            </button>
          )}
        </div>
      )}

      {/* Attachment preview strip */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((att, i) => (
            <div key={i} className="relative group">
              {att.previewUrl ? (
                <img
                  src={att.previewUrl}
                  alt={att.file.name}
                  className="h-16 w-16 rounded-lg border border-zinc-700/50 object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-zinc-700/50 bg-zinc-800/50">
                  <Paperclip size={14} className="text-zinc-500" />
                </div>
              )}
              <button
                onClick={() => removeAttachment(i)}
                className="absolute -top-1.5 -end-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-700 text-zinc-300 opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"
              >
                <X size={8} />
              </button>
              <span className="absolute bottom-0 start-0 end-0 truncate rounded-b-lg bg-black/60 px-1 text-[8px] text-zinc-400">
                {att.file.name}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_EXTS}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            addFiles(e.target.files);
          }
          e.target.value = '';
        }}
      />

      <div className="flex items-end gap-2 rounded-xl border border-zinc-700/50 bg-zinc-900/80 px-3 py-2.5 transition-colors focus-within:border-indigo-500/50 focus-within:shadow-lg focus-within:shadow-indigo-500/5">
        {/* Attachment button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-700/50 hover:text-zinc-300 disabled:opacity-30"
          title="Attach file"
        >
          <Paperclip size={14} />
        </button>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
          placeholder={placeholder ?? (disabled ? t('chat.selectChannelPlaceholder') : t('chat.messagePlaceholder'))}
          disabled={disabled}
          rows={1}
          dir={value ? 'auto' : (isRtl ? 'rtl' : 'ltr')}
          className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:cursor-not-allowed"
        />
        {isGenerating && onCancelGeneration ? (
          <button
            onClick={onCancelGeneration}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white shadow-sm transition-all hover:bg-red-500"
            title={t('chat.stopGeneration')}
          >
            <Square size={12} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={(!value.trim() && attachments.length === 0) || disabled || isSending || noRecipients}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-sm shadow-indigo-500/20 transition-all hover:shadow-md hover:shadow-indigo-500/30 disabled:opacity-30 disabled:shadow-none"
          >
            <ArrowUp size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>
      {isGenerating && onCancelGeneration && (
        <div className="mt-1 text-center text-[10px] text-zinc-600">
          {t('chat.escToStop')}
        </div>
      )}
    </div>
  );
}
