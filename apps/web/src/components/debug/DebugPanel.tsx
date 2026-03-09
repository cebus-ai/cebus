import { useState } from 'react';
import { Bug, ChevronLeft, FileText, RefreshCw } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { useI18n } from '../../lib/i18n';

interface DebugPanelProps {
  channelId?: string | null | undefined;
}

export function DebugPanel({ channelId }: DebugPanelProps) {
  const [selectedScope, setSelectedScope] = useState<{ type: 'channel' | 'dm'; id: string; label: string } | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const { t } = useI18n();

  const isEnabled = trpc.debug.isEnabled.useQuery();
  const scopes = trpc.debug.listScopes.useQuery(undefined, { enabled: isEnabled.data === true });

  const files = trpc.debug.listFiles.useQuery(
    { type: selectedScope?.type ?? 'channel', id: selectedScope?.id ?? '' },
    { enabled: selectedScope !== null },
  );

  const fileContent = trpc.debug.readFile.useQuery(
    { type: selectedScope?.type ?? 'channel', id: selectedScope?.id ?? '', filename: selectedFile ?? '' },
    { enabled: selectedScope !== null && selectedFile !== null },
  );

  if (!isEnabled.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Bug size={32} className="text-zinc-600" />
        <p className="text-sm text-zinc-500">{t('debug.notEnabled')}</p>
        <p className="text-xs text-zinc-600">
          <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-amber-400">CEBUS_DEBUG=true</code> {t('debug.enableHint')}
        </p>
      </div>
    );
  }

  // File viewer
  if (selectedScope && selectedFile) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-zinc-800/60 px-3 py-2">
          <button
            onClick={() => setSelectedFile(null)}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
          >
            <ChevronLeft size={14} />
            {t('debug.back')}
          </button>
          <span className="truncate text-xs font-medium text-zinc-300">{selectedFile}</span>
          <button
            onClick={() => fileContent.refetch()}
            className="ms-auto text-zinc-500 hover:text-zinc-300"
            title={t('debug.refresh')}
          >
            <RefreshCw size={12} className={fileContent.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-3">
          {fileContent.isLoading ? (
            <p className="text-xs text-zinc-500">{t('debug.loading')}</p>
          ) : fileContent.error ? (
            <p className="text-xs text-red-400">{fileContent.error.message}</p>
          ) : (
            <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-zinc-300">
              {fileContent.data}
            </pre>
          )}
        </div>
      </div>
    );
  }

  // File list for selected scope
  if (selectedScope) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-zinc-800/60 px-3 py-2">
          <button
            onClick={() => setSelectedScope(null)}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
          >
            <ChevronLeft size={14} />
            {t('debug.back')}
          </button>
          <span className="truncate text-xs font-medium text-zinc-300">{selectedScope.label}</span>
          <button
            onClick={() => files.refetch()}
            className="ms-auto text-zinc-500 hover:text-zinc-300"
            title={t('debug.refresh')}
          >
            <RefreshCw size={12} className={files.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {files.isLoading ? (
            <p className="px-2 text-xs text-zinc-500">{t('debug.loading')}</p>
          ) : !files.data || files.data.length === 0 ? (
            <p className="px-2 text-xs text-zinc-500">{t('debug.noFiles')}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {files.data.map((filename) => (
                <button
                  key={filename}
                  onClick={() => setSelectedFile(filename)}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-start text-xs text-zinc-300 transition-colors hover:bg-zinc-800/60"
                >
                  <FileText size={13} className={getFileColor(filename)} />
                  <span className="truncate">{formatFileName(filename, t)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Scope list — auto-select current channel if available
  const currentChannelScope = channelId
    ? scopes.data?.find(s => s.type === 'channel' && s.id === channelId)
    : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800/60 px-3 py-2">
        <Bug size={13} className="text-amber-400" />
        <span className="text-xs font-medium text-zinc-300">{t('debug.title')}</span>
        <button
          onClick={() => scopes.refetch()}
          className="ms-auto text-zinc-500 hover:text-zinc-300"
          title={t('debug.refresh')}
        >
          <RefreshCw size={12} className={scopes.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {currentChannelScope && (
        <div className="border-b border-zinc-800/40 p-2">
          <button
            onClick={() => setSelectedScope({ type: currentChannelScope.type, id: currentChannelScope.id, label: currentChannelScope.label })}
            className="flex w-full items-center gap-2 rounded-lg bg-amber-500/10 px-2.5 py-2 text-start text-xs text-amber-400 transition-colors hover:bg-amber-500/20"
          >
            <FileText size={13} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t('debug.currentChannel')}</div>
              <div className="truncate text-[10px] text-amber-400/60">{currentChannelScope.label} — {currentChannelScope.files.length} {t('debug.files')}</div>
            </div>
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {scopes.isLoading ? (
          <p className="px-2 text-xs text-zinc-500">{t('debug.loading')}</p>
        ) : !scopes.data || scopes.data.length === 0 ? (
          <p className="px-2 text-xs text-zinc-500">{t('debug.noSessions')}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {scopes.data.map((scope) => (
              <button
                key={`${scope.type}:${scope.id}`}
                onClick={() => setSelectedScope({ type: scope.type, id: scope.id, label: scope.label })}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-start text-xs transition-colors hover:bg-zinc-800/60 ${
                  scope.id === channelId ? 'text-amber-400' : 'text-zinc-300'
                }`}
              >
                <Bug size={13} className="shrink-0 text-zinc-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{scope.label}</div>
                  <div className="text-[10px] text-zinc-500">
                    {scope.type} — {scope.files.length} {t('debug.files')}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function getFileColor(filename: string): string {
  if (filename === 'team-leader.md') return 'text-purple-400';
  if (filename === 'chat-transcript.md') return 'text-emerald-400';
  if (filename === 'debug.log') return 'text-zinc-500';
  if (filename.includes('--')) return 'text-sky-400';
  return 'text-zinc-400';
}

function formatFileName(filename: string, t: (key: 'debug.fileTeamLeader' | 'debug.fileTranscript' | 'debug.fileDebugLog') => string): string {
  if (filename === 'team-leader.md') return t('debug.fileTeamLeader');
  if (filename === 'chat-transcript.md') return t('debug.fileTranscript');
  if (filename === 'debug.log') return t('debug.fileDebugLog');
  if (filename.includes('--')) {
    const [provider, model] = filename.replace('.md', '').split('--');
    return `${provider} / ${model}`;
  }
  return filename;
}
