import { useState } from 'react';
import { X, Sparkles, FileText, FolderOpen, ChevronUp, Folder, GitBranch } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { useI18n } from '../../lib/i18n';

interface CreateChannelDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: {
    name: string;
    subject?: string | undefined;
    instructions?: string | undefined;
    chatMode?: string | undefined;
    orchestratorEnabled?: boolean | undefined;
    orchestratorModel?: string | undefined;
    includeSystemPrompt?: boolean | undefined;
    includeProjectContext?: boolean | undefined;
    includeModeGuidance?: boolean | undefined;
    includeTierGuidance?: boolean | undefined;
    includeRichComponents?: boolean | undefined;
    workingDir?: string | null | undefined;
  }) => void;
  isCreating: boolean;
}

export function CreateChannelDialog({ open, onClose, onCreate, isCreating }: CreateChannelDialogProps) {
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [instructions, setInstructions] = useState('');
  const [chatMode, setChatMode] = useState('free_chat');
  const [orchestratorEnabled, setOrchestratorEnabled] = useState(false);
  const [orchestratorProvider, setOrchestratorProvider] = useState('');
  const [orchestratorModel, setOrchestratorModel] = useState('');
  const [includeSystemPrompt, setIncludeSystemPrompt] = useState(true);
  const [includeProjectContext, setIncludeProjectContext] = useState(true);
  const [includeModeGuidance, setIncludeModeGuidance] = useState(true);
  const [includeTierGuidance, setIncludeTierGuidance] = useState(true);
  const [includeRichComponents, setIncludeRichComponents] = useState(true);
  const [workingDir, setWorkingDir] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [browsePath, setBrowsePath] = useState('');
  const { t } = useI18n();

  const CHAT_MODES = [
    { value: 'free_chat', label: t('mode.freeChat'), desc: t('mode.freeChatDesc') },
    { value: 'sequential', label: t('mode.sequential'), desc: t('mode.sequentialDesc') },
    { value: 'tag_only', label: t('mode.tagOnly'), desc: t('mode.tagOnlyDesc') },
    { value: 'raw', label: t('mode.raw'), desc: t('mode.rawDesc') },
  ] as const;

  const providersQuery = trpc.agent.listProviders.useQuery(undefined, {
    enabled: open,
  });
  const providers = providersQuery.data ?? [];
  const selectedProviderGroup = providers.find((p) => p.groupKey === orchestratorProvider);
  const models = selectedProviderGroup?.models ?? [];

  const projectRootQuery = trpc.workspace.getProjectRoot.useQuery(undefined, { enabled: open });
  const effectiveDir = workingDir.trim() || projectRootQuery.data?.path || '';
  const gitInfoQuery = trpc.workspace.getGitInfo.useQuery(
    { workingDir: effectiveDir || undefined },
    { enabled: open && effectiveDir.length > 0 },
  );
  const browseDirsQuery = trpc.workspace.browseDirs.useQuery(
    { path: browsePath || undefined },
    { enabled: open && browsing },
  );

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({
      name: name.trim(),
      subject: subject.trim() || undefined,
      instructions: instructions.trim() || undefined,
      chatMode,
      orchestratorEnabled: orchestratorEnabled || undefined,
      orchestratorModel: orchestratorEnabled && orchestratorModel && selectedProviderGroup
        ? `${selectedProviderGroup.provider}/${orchestratorModel}`
        : undefined,
      includeSystemPrompt,
      includeProjectContext,
      includeModeGuidance,
      includeTierGuidance,
      includeRichComponents,
      workingDir: workingDir.trim() || null,
    });
    setName('');
    setSubject('');
    setInstructions('');
    setChatMode('free_chat');
    setOrchestratorEnabled(false);
    setOrchestratorProvider('');
    setOrchestratorModel('');
    setIncludeSystemPrompt(true);
    setIncludeProjectContext(true);
    setIncludeModeGuidance(true);
    setIncludeTierGuidance(true);
    setIncludeRichComponents(true);
    setWorkingDir('');
    setBrowsing(false);
    setBrowsePath('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">{t('create.title')}</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-zinc-800">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">{t('create.channelName')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. architecture-review"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              {t('create.subject')}
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Discussing system design patterns"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">{t('settings.instructions')}</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Always respond in bullet points, focus on code quality"
              rows={2}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">{t('settings.chatMode')}</label>
            <div className="space-y-1">
              {CHAT_MODES.map((mode) => (
                <label
                  key={mode.value}
                  className={`flex cursor-pointer items-start gap-2 rounded border px-3 py-2 transition-colors ${
                    chatMode === mode.value
                      ? 'border-indigo-500 bg-indigo-500/10'
                      : 'border-zinc-700 hover:border-zinc-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="chatMode"
                    value={mode.value}
                    checked={chatMode === mode.value}
                    onChange={(e) => {
                      setChatMode(e.target.value);
                      if (e.target.value === 'raw') {
                        setIncludeSystemPrompt(false);
                        setIncludeProjectContext(false);
                        setIncludeModeGuidance(false);
                        setIncludeTierGuidance(false);
                        setIncludeRichComponents(false);
                      }
                    }}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm text-zinc-200">{mode.label}</div>
                    <div className="text-xs text-zinc-500">{mode.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          {/* Orchestrator toggle */}
          {chatMode !== 'tag_only' && (
            <div className="space-y-2 rounded border border-zinc-700 p-3">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={orchestratorEnabled}
                  onChange={(e) => setOrchestratorEnabled(e.target.checked)}
                  className="rounded"
                />
                <Sparkles size={14} className="text-amber-400" />
                <span className="text-sm text-zinc-200">{t('settings.orchestrator')}</span>
              </label>
              <p className="text-[11px] text-zinc-500">
                {t('settings.orchestratorDesc')}
              </p>
              {orchestratorEnabled && (
                <div className="mt-2 space-y-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-zinc-400">
                      {t('settings.orchestratorModel')}
                    </label>
                    {providersQuery.isLoading ? (
                      <p className="text-xs text-zinc-500">{t('addAgent.loading')}</p>
                    ) : (
                      <select
                        value={orchestratorProvider}
                        onChange={(e) => { setOrchestratorProvider(e.target.value); setOrchestratorModel(''); }}
                        className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="">{t('settings.selectProvider')}</option>
                        {providers.map((p) => (
                          <option key={p.groupKey} value={p.groupKey}>{p.displayName}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  {orchestratorProvider && (
                    <select
                      value={orchestratorModel}
                      onChange={(e) => setOrchestratorModel(e.target.value)}
                      className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="">{t('settings.selectModel')}</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          )}

          {/* System prompt components */}
          <div className="space-y-2 rounded border border-zinc-700 p-3">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-blue-400" />
              <span className="text-sm font-medium text-zinc-200">System Prompt Components</span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Control what is sent to models. Turn off to reduce token costs.
            </p>
            <div className="mt-1 space-y-1.5">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={includeSystemPrompt} onChange={(e) => setIncludeSystemPrompt(e.target.checked)} className="rounded" />
                <span className="text-xs text-zinc-300">System Instructions</span>
                <span className="text-[10px] text-zinc-600">— base identity, rules</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={includeProjectContext} onChange={(e) => setIncludeProjectContext(e.target.checked)} className="rounded" />
                <span className="text-xs text-zinc-300">Project Context</span>
                <span className="text-[10px] text-zinc-600">— CLAUDE.md, directory, git</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={includeModeGuidance} onChange={(e) => setIncludeModeGuidance(e.target.checked)} className="rounded" />
                <span className="text-xs text-zinc-300">Mode Guidance</span>
                <span className="text-[10px] text-zinc-600">— chat mode behavior</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={includeTierGuidance} onChange={(e) => setIncludeTierGuidance(e.target.checked)} className="rounded" />
                <span className="text-xs text-zinc-300">Model Tier Guidance</span>
                <span className="text-[10px] text-zinc-600">— quality hints per model</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={includeRichComponents} onChange={(e) => setIncludeRichComponents(e.target.checked)} className="rounded" />
                <span className="text-xs text-zinc-300">Rich UI Components</span>
                <span className="text-[10px] text-zinc-600">— polls, charts, forms, diagrams</span>
              </label>
            </div>
          </div>

          {/* Working Directory */}
          <div className="space-y-2 rounded border border-zinc-700 p-3">
            <div className="flex items-center gap-2">
              <FolderOpen size={14} className="text-emerald-400" />
              <span className="text-sm font-medium text-zinc-200">Working Directory</span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Project folder for this channel. Leave empty for workspace default.
            </p>
            <div className="flex gap-1.5">
              <input
                value={workingDir}
                onChange={(e) => setWorkingDir(e.target.value)}
                placeholder={projectRootQuery.data?.path ? `Default: ${projectRootQuery.data.path}` : 'Workspace default'}
                className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  setBrowsePath(effectiveDir);
                  setBrowsing(!browsing);
                }}
                className={`shrink-0 rounded border px-2 py-1.5 text-xs ${browsing ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300' : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'}`}
              >
                Browse
              </button>
            </div>
            {browsing && browseDirsQuery.data && (
              <div className="max-h-40 overflow-y-auto rounded border border-zinc-700 bg-zinc-800/50">
                <div className="sticky top-0 flex items-center gap-1.5 border-b border-zinc-700 bg-zinc-800 px-2 py-1">
                  <FolderOpen size={11} className="shrink-0 text-emerald-400" />
                  <span className="truncate font-mono text-[10px] text-zinc-400">{browseDirsQuery.data.current}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setWorkingDir(browseDirsQuery.data!.current);
                      setBrowsing(false);
                    }}
                    className="ml-auto shrink-0 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] text-white hover:bg-indigo-500"
                  >
                    Select
                  </button>
                </div>
                {browseDirsQuery.data.parent && (
                  <button
                    type="button"
                    onClick={() => setBrowsePath(browseDirsQuery.data!.parent!)}
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs text-zinc-400 hover:bg-zinc-700/50"
                  >
                    <ChevronUp size={11} className="shrink-0" />
                    <span>..</span>
                  </button>
                )}
                {browseDirsQuery.data.dirs.map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => setBrowsePath(browseDirsQuery.data!.current + browseDirsQuery.data!.sep + dir)}
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-700/50"
                  >
                    <Folder size={11} className="shrink-0 text-zinc-500" />
                    <span className="truncate">{dir}</span>
                  </button>
                ))}
                {browseDirsQuery.data.dirs.length === 0 && (
                  <p className="px-2 py-1.5 text-[11px] text-zinc-600">No subdirectories</p>
                )}
              </div>
            )}
            <p className="truncate font-mono text-[11px] text-zinc-500">
              {effectiveDir}
            </p>
            {gitInfoQuery.data?.branch && (
              <div className="flex items-center gap-1.5">
                <GitBranch size={12} className="text-orange-400" />
                <span className="font-mono text-[11px] text-zinc-400">{gitInfoQuery.data.branch}</span>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
            >
              {t('create.cancel')}
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isCreating}
              className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {isCreating ? t('create.creating') : t('create.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
