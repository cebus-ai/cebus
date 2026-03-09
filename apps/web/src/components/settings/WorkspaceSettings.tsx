import { useState, useEffect, useMemo } from 'react';
import { X, SlidersHorizontal, FileText, Wallet, FolderOpen, ChevronUp, Folder, GitBranch } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { useI18n } from '../../lib/i18n';
import mascotAvatar from '../../assets/images/cebus-mascot-avatar-sq.png';

interface WorkspaceSettingsProps {
  open: boolean;
  onClose: () => void;
}

export function WorkspaceSettings({ open, onClose }: WorkspaceSettingsProps) {
  const { t } = useI18n();
  const creditsQuery = trpc.agent.getCredits.useQuery(undefined, { enabled: open });
  const creditsColor = useMemo(() => {
    const r = creditsQuery.data?.remaining;
    if (r === undefined || r === null) return 'text-zinc-400';
    if (r < 1) return 'text-red-400';
    if (r <= 5) return 'text-yellow-400';
    return 'text-emerald-400';
  }, [creditsQuery.data?.remaining]);

  const projectRootQuery = trpc.workspace.getProjectRoot.useQuery(undefined, { enabled: open });
  const workspaceQuery = trpc.workspace.get.useQuery(undefined, { enabled: open });
  const utils = trpc.useUtils();
  const updateMutation = trpc.workspace.update.useMutation({
    onSuccess: () => {
      workspaceQuery.refetch();
      utils.workspace.getProjectRoot.invalidate();
      onClose();
    },
  });

  const [ctxWindowSize, setCtxWindowSize] = useState(10);
  const [includeSystemPrompt, setIncludeSystemPrompt] = useState(true);
  const [includeProjectContext, setIncludeProjectContext] = useState(true);
  const [includeModeGuidance, setIncludeModeGuidance] = useState(true);
  const [includeTierGuidance, setIncludeTierGuidance] = useState(true);
  const [includeRichComponents, setIncludeRichComponents] = useState(true);
  const [defaultWorkingDir, setDefaultWorkingDir] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [browsePath, setBrowsePath] = useState('');

  const effectiveDir = defaultWorkingDir.trim() || projectRootQuery.data?.path || '';
  const gitInfoQuery = trpc.workspace.getGitInfo.useQuery(
    { workingDir: effectiveDir || undefined },
    { enabled: open && effectiveDir.length > 0 },
  );
  const browseDirsQuery = trpc.workspace.browseDirs.useQuery(
    { path: browsePath || undefined },
    { enabled: open && browsing },
  );

  useEffect(() => {
    if (workspaceQuery.data) {
      setCtxWindowSize(workspaceQuery.data.defaultContextWindowSize);
      setIncludeSystemPrompt(workspaceQuery.data.defaultIncludeSystemPrompt);
      setIncludeProjectContext(workspaceQuery.data.defaultIncludeProjectContext);
      setIncludeModeGuidance(workspaceQuery.data.defaultIncludeModeGuidance);
      setIncludeTierGuidance(workspaceQuery.data.defaultIncludeTierGuidance);
      setIncludeRichComponents(workspaceQuery.data.defaultIncludeRichComponents);
      setDefaultWorkingDir(workspaceQuery.data.defaultWorkingDir ?? '');
    }
  }, [workspaceQuery.data]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900 px-4 py-3">
          <div className="flex items-center justify-end">
            <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-zinc-800">
              <X size={16} />
            </button>
          </div>
          <div className="flex flex-col items-center pb-2">
            <img src={mascotAvatar} alt="Cebus" className="mb-2 h-16 w-16 rounded-full shadow-lg shadow-indigo-500/20" />
            <span className="text-sm font-bold tracking-tight text-zinc-100">Cebus</span>
            <h2 className="text-xs text-zinc-500">{t('settings.workspaceDefaults')}</h2>
          </div>
        </div>
        <div className="space-y-3 p-4">
          {/* Context window */}
          <div className="space-y-2 rounded border border-zinc-700 p-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={14} className="text-indigo-400" />
              <span className="text-sm text-zinc-200">{t('settings.defaultContextWindow')}</span>
            </div>
            <p className="text-[11px] text-zinc-500">
              {t('settings.defaultContextWindowDesc')}
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
              <span className="text-sm font-medium text-zinc-200">Default System Prompt</span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Default prompt components for new channels. Each channel can override these.
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

          {/* Provider balances */}
          {creditsQuery.data && (
            <div className="space-y-2 rounded border border-zinc-700 p-3">
              <div className="flex items-center gap-2">
                <Wallet size={14} className="text-emerald-400" />
                <span className="text-sm font-medium text-zinc-200">Provider Balances</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">OpenRouter credit</span>
                <span className={`text-sm font-semibold ${creditsColor}`}>
                  ${creditsQuery.data.remaining.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Default Working Directory */}
          <div className="space-y-2 rounded border border-zinc-700 p-3">
            <div className="flex items-center gap-2">
              <FolderOpen size={14} className="text-emerald-400" />
              <span className="text-sm font-medium text-zinc-200">Default Working Directory</span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Default folder for all channels. Each channel can override this.
            </p>
            <div className="flex gap-1.5">
              <input
                value={defaultWorkingDir}
                onChange={(e) => setDefaultWorkingDir(e.target.value)}
                placeholder="Auto-detect (server cwd)"
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
            {browsing && (
              browseDirsQuery.isLoading ? (
                <p className="px-2 py-2 text-[11px] text-zinc-500">Loading…</p>
              ) : browseDirsQuery.isError ? (
                <p className="px-2 py-2 text-[11px] text-red-400">Cannot browse this location.</p>
              ) : browseDirsQuery.data ? (
                <div className="max-h-40 overflow-y-auto rounded border border-zinc-700 bg-zinc-800/50">
                  <div className="sticky top-0 flex items-center gap-1.5 border-b border-zinc-700 bg-zinc-800 px-2 py-1">
                    <FolderOpen size={11} className="shrink-0 text-emerald-400" />
                    <span className="truncate font-mono text-[10px] text-zinc-400">{browseDirsQuery.data.current}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setDefaultWorkingDir(browseDirsQuery.data!.current);
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
              ) : null
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

          <div className="flex justify-end pt-2">
            <button
              onClick={() => updateMutation.mutate({
                defaultContextWindowSize: ctxWindowSize,
                defaultIncludeSystemPrompt: includeSystemPrompt,
                defaultIncludeProjectContext: includeProjectContext,
                defaultIncludeModeGuidance: includeModeGuidance,
                defaultIncludeTierGuidance: includeTierGuidance,
                defaultIncludeRichComponents: includeRichComponents,
                defaultWorkingDir: defaultWorkingDir.trim() || null,
              })}
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
