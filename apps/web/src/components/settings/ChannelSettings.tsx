import { useState, useEffect } from 'react';
import { X, Archive, Sparkles, FolderOpen, SlidersHorizontal, FileText, GitBranch, ChevronUp, Folder } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { useI18n } from '../../lib/i18n';

type ChatMode = 'free_chat' | 'sequential' | 'tag_only' | 'role_based' | 'raw';

interface ChannelSettingsProps {
  channelId: string;
  name: string;
  subject: string | null;
  instructions: string | null;
  chatMode: string;
  orchestratorEnabled: boolean;
  orchestratorModel: string | null;
  contextLevel?: string | undefined;
  contextWindowSize?: number | undefined;
  includeSystemPrompt?: boolean | undefined;
  includeProjectContext?: boolean | undefined;
  includeModeGuidance?: boolean | undefined;
  includeTierGuidance?: boolean | undefined;
  includeRichComponents?: boolean | undefined;
  workingDir?: string | null | undefined;
  open: boolean;
  onClose: () => void;
}

export function ChannelSettings({
  channelId,
  name: initialName,
  subject: initialSubject,
  instructions: initialInstructions,
  chatMode: initialMode,
  orchestratorEnabled: initialOrchEnabled,
  orchestratorModel: initialOrchModel,
  contextLevel: initialContextLevel,
  contextWindowSize: initialContextWindowSize = 10,
  includeSystemPrompt: initialIncludeSystemPrompt = true,
  includeProjectContext: initialIncludeProjectContext = true,
  includeModeGuidance: initialIncludeModeGuidance = true,
  includeTierGuidance: initialIncludeTierGuidance = true,
  includeRichComponents: initialIncludeRichComponents = true,
  workingDir: initialWorkingDir,
  open,
  onClose,
}: ChannelSettingsProps) {
  const [name, setName] = useState(initialName);
  const [subject, setSubject] = useState(initialSubject ?? '');
  const [instructions, setInstructions] = useState(initialInstructions ?? '');
  const [chatMode, setChatMode] = useState<ChatMode>(initialMode as ChatMode);
  const [orchEnabled, setOrchEnabled] = useState(initialOrchEnabled);
  const [folderAccess, setFolderAccess] = useState(initialContextLevel !== 'none' && initialContextLevel !== undefined);
  const [ctxWindowSize, setCtxWindowSize] = useState(initialContextWindowSize);
  const [includeSystemPrompt, setIncludeSystemPrompt] = useState(initialIncludeSystemPrompt);
  const [includeProjectContext, setIncludeProjectContext] = useState(initialIncludeProjectContext);
  const [includeModeGuidance, setIncludeModeGuidance] = useState(initialIncludeModeGuidance);
  const [includeTierGuidance, setIncludeTierGuidance] = useState(initialIncludeTierGuidance);
  const [includeRichComponents, setIncludeRichComponents] = useState(initialIncludeRichComponents);
  const [workingDir, setWorkingDir] = useState(initialWorkingDir ?? '');
  const [browsing, setBrowsing] = useState(false);
  const [browsePath, setBrowsePath] = useState('');
  const { t } = useI18n();

  const [orchGroup, setOrchGroup] = useState('');
  const [orchModel, setOrchModel] = useState('');

  const CHAT_MODES = [
    { value: 'free_chat', label: t('mode.freeChat'), desc: t('mode.freeChatDesc') },
    { value: 'sequential', label: t('mode.sequential'), desc: t('mode.sequentialDesc') },
    { value: 'tag_only', label: t('mode.tagOnly'), desc: t('mode.tagOnlyDesc') },
    { value: 'raw', label: t('mode.raw'), desc: t('mode.rawDesc') },
  ] as const;

  const projectRootQuery = trpc.workspace.getProjectRoot.useQuery(undefined, {
    enabled: open && folderAccess,
  });
  const effectiveDir = workingDir.trim() || projectRootQuery.data?.path || '';
  const gitInfoQuery = trpc.workspace.getGitInfo.useQuery(
    { workingDir: effectiveDir || undefined },
    { enabled: open && folderAccess && effectiveDir.length > 0 },
  );
  const browseDirsQuery = trpc.workspace.browseDirs.useQuery(
    { path: browsePath || undefined },
    { enabled: open && folderAccess && browsing },
  );
  const providersQuery = trpc.agent.listProviders.useQuery(undefined, {
    enabled: open,
  });
  const providers = providersQuery.data ?? [];
  const selectedProvider = providers.find((p) => p.groupKey === orchGroup);
  const models = selectedProvider?.models ?? [];

  // Resolve initial stored "provider/modelId" to the matching groupKey once providers load
  useEffect(() => {
    if (!providers.length || !initialOrchModel || orchGroup) return;
    const [storedProvider, ...modelParts] = initialOrchModel.split('/');
    const storedModelId = modelParts.join('/');
    const match = providers.find(
      (p) => p.provider === storedProvider && p.models.some((m) => m.id === storedModelId),
    );
    if (match) {
      setOrchGroup(match.groupKey);
      setOrchModel(storedModelId);
    }
  }, [providers, initialOrchModel, orchGroup]);

  const utils = trpc.useUtils();
  const updateMutation = trpc.channel.update.useMutation({
    onSuccess: () => {
      utils.channel.list.invalidate();
      utils.channel.get.invalidate({ channelId });
      onClose();
    },
  });

  const archiveMutation = trpc.channel.archive.useMutation({
    onSuccess: () => {
      utils.channel.list.invalidate();
      onClose();
    },
  });

  if (!open) return null;

  const handleSave = () => {
    updateMutation.mutate({
      channelId,
      name: name.trim(),
      subject: subject.trim() || undefined,
      instructions: instructions.trim() || undefined,
      chatMode,
      orchestratorEnabled: orchEnabled,
      orchestratorModel: orchEnabled && orchModel && selectedProvider
        ? `${selectedProvider.provider}/${orchModel}`
        : undefined,
      contextLevel: folderAccess ? 'minimal' : 'none',
      workingDir: folderAccess && workingDir.trim() ? workingDir.trim() : null,
      contextWindowSize: ctxWindowSize,
      includeSystemPrompt,
      includeProjectContext,
      includeModeGuidance,
      includeTierGuidance,
      includeRichComponents,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">{t('settings.title')}</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-zinc-800">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">{t('settings.name')}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">{t('settings.subject')}</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">{t('settings.instructions')}</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">{t('settings.chatMode')}</label>
            <select
              value={chatMode}
              onChange={(e) => {
                setChatMode(e.target.value as ChatMode);
                if (e.target.value === 'raw') {
                  setIncludeSystemPrompt(false);
                  setIncludeProjectContext(false);
                  setIncludeModeGuidance(false);
                  setIncludeTierGuidance(false);
                  setIncludeRichComponents(false);
                }
              }}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none"
            >
              {CHAT_MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label} — {m.desc}</option>
              ))}
            </select>
          </div>

          {/* Orchestrator section */}
          {chatMode !== 'tag_only' && (
            <div className="space-y-2 rounded border border-zinc-700 p-3">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={orchEnabled}
                  onChange={(e) => setOrchEnabled(e.target.checked)}
                  className="rounded"
                />
                <Sparkles size={14} className="text-amber-400" />
                <span className="text-sm text-zinc-200">{t('settings.orchestrator')}</span>
              </label>
              <p className="text-[11px] text-zinc-500">
                {t('settings.orchestratorDesc')}
              </p>
              {orchEnabled && (
                <div className="mt-2 space-y-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-zinc-400">
                      {t('settings.orchestratorModel')}
                    </label>
                    {providersQuery.isLoading ? (
                      <p className="text-xs text-zinc-500">{t('addAgent.loading')}</p>
                    ) : (
                      <select
                        value={orchGroup}
                        onChange={(e) => { setOrchGroup(e.target.value); setOrchModel(''); }}
                        className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="">{t('settings.selectProvider')}</option>
                        {providers.map((p) => (
                          <option key={p.groupKey} value={p.groupKey}>
                            {p.displayName} ({p.models.length})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {orchGroup && (
                    <select
                      value={orchModel}
                      onChange={(e) => setOrchModel(e.target.value)}
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

          {/* Context window size */}
          <div className="space-y-2 rounded border border-zinc-700 p-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={14} className="text-indigo-400" />
              <span className="text-sm text-zinc-200">Context Window</span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Number of recent messages sent to AI models as context.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={ctxWindowSize}
                onChange={(e) => setCtxWindowSize(Number(e.target.value))}
                className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-indigo-500"
              />
              <input
                type="number"
                min={1}
                max={100}
                value={ctxWindowSize}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v >= 1 && v <= 100) setCtxWindowSize(v);
                }}
                className="w-16 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-center text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
              />
              <span className="text-xs text-zinc-500">msgs</span>
            </div>
          </div>

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
                <span className="text-[10px] text-zinc-600">— base identity, rules, addressing</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={includeProjectContext} onChange={(e) => setIncludeProjectContext(e.target.checked)} className="rounded" />
                <span className="text-xs text-zinc-300">Project Context</span>
                <span className="text-[10px] text-zinc-600">— CLAUDE.md, directory tree, git info</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={includeModeGuidance} onChange={(e) => setIncludeModeGuidance(e.target.checked)} className="rounded" />
                <span className="text-xs text-zinc-300">Mode Guidance</span>
                <span className="text-[10px] text-zinc-600">— chat mode behavior instructions</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={includeTierGuidance} onChange={(e) => setIncludeTierGuidance(e.target.checked)} className="rounded" />
                <span className="text-xs text-zinc-300">Model Tier Guidance</span>
                <span className="text-[10px] text-zinc-600">— model-specific quality hints</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={includeRichComponents} onChange={(e) => setIncludeRichComponents(e.target.checked)} className="rounded" />
                <span className="text-xs text-zinc-300">Rich UI Components</span>
                <span className="text-[10px] text-zinc-600">— polls, charts, forms, diagrams</span>
              </label>
            </div>
          </div>

          {/* Folder access section */}
          <div className="space-y-2 rounded border border-zinc-700 p-3">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={folderAccess}
                onChange={(e) => setFolderAccess(e.target.checked)}
                className="rounded"
              />
              <FolderOpen size={14} className="text-emerald-400" />
              <span className="text-sm text-zinc-200">{t('permissions.folderAccess')}</span>
            </label>
            <p className="text-[11px] text-zinc-500">
              {t('permissions.folderAccessDesc')}
            </p>
            {folderAccess && (
              <div className="space-y-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-zinc-400">Working Directory <span className="text-zinc-600">(leave empty for workspace default)</span></label>
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
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => archiveMutation.mutate({ channelId })}
              className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-amber-500 hover:bg-amber-500/10"
            >
              <Archive size={14} />
              {t('settings.archive')}
            </button>
            <button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {updateMutation.isPending ? t('settings.saving') : t('settings.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
