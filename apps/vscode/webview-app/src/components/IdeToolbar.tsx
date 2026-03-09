import React, { useState, useEffect, useCallback } from 'react';
import type { IdeActionResultData } from '../hooks/useVSCodeMessages';

interface IdeToolbarProps {
  onIdeAction: (action: string, params?: Record<string, unknown>) => void;
  ideActionResult: IdeActionResultData | null;
  onClearResult: () => void;
}

export function IdeToolbar({
  onIdeAction,
  ideActionResult,
  onClearResult,
}: IdeToolbarProps): React.ReactElement {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [resultPanel, setResultPanel] = useState<IdeActionResultData | null>(null);

  useEffect(() => {
    if (ideActionResult) {
      setLoadingAction(null);
      setResultPanel(ideActionResult);
      onClearResult();
    }
  }, [ideActionResult, onClearResult]);

  const handleAction = useCallback(
    (action: string, params?: Record<string, unknown>) => {
      setLoadingAction(action);
      setResultPanel(null);
      onIdeAction(action, params);
    },
    [onIdeAction]
  );

  return (
    <div className="border-t border-border">
      {/* Action buttons row */}
      <div className="flex items-center gap-1 px-2 py-1.5">
        <span className="text-[10px] text-muted mr-0.5">IDE</span>

        <ToolbarButton
          icon={<GitIcon />}
          label="Git Changes"
          loading={loadingAction === 'getGitStatus'}
          onClick={() => handleAction('getGitStatus')}
        />
        <ToolbarButton
          icon={<DiffIcon />}
          label="View Diff"
          loading={loadingAction === 'openDiffView'}
          onClick={() => handleAction('openDiffView')}
        />
        <ToolbarButton
          icon={<ErrorIcon />}
          label="Errors"
          loading={loadingAction === 'getDiagnostics'}
          onClick={() => handleAction('getDiagnostics')}
        />
        <ToolbarButton
          icon={<FilesIcon />}
          label="Open Files"
          loading={loadingAction === 'getOpenFiles'}
          onClick={() => handleAction('getOpenFiles')}
        />
        <ToolbarButton
          icon={<LogIcon />}
          label="Git Log"
          loading={loadingAction === 'getGitLog'}
          onClick={() => handleAction('getGitLog')}
        />
      </div>

      {/* Result panel */}
      {resultPanel && (
        <div className="border-t border-border">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[10px] font-medium text-muted">
              {formatActionLabel(resultPanel.action)}
            </span>
            <button
              onClick={() => setResultPanel(null)}
              className="text-[10px] text-muted hover:text-foreground"
            >
              &#x2715;
            </button>
          </div>
          <div className="max-h-40 overflow-y-auto px-2 pb-2">
            {resultPanel.success ? (
              <ResultView action={resultPanel.action} data={resultPanel.data} />
            ) : (
              <span className="text-xs text-error">{resultPanel.error}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  loading,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  loading: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted hover:bg-badge/40 hover:text-foreground disabled:opacity-50"
      title={label}
    >
      {loading ? <Spinner /> : icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function ResultView({ action, data }: { action: string; data?: unknown }): React.ReactElement {
  if (!data || typeof data !== 'object') {
    return <span className="text-xs text-muted">No data</span>;
  }

  switch (action) {
    case 'getGitStatus':
      return <GitStatusResult data={data as Record<string, unknown>} />;
    case 'getDiagnostics':
      return <DiagnosticsResult data={data as Record<string, unknown>} />;
    case 'getOpenFiles':
      return <OpenFilesResult data={data as Record<string, unknown>} />;
    case 'getGitLog':
      return <GitLogResult data={data as Record<string, unknown>} />;
    default:
      return <pre className="text-[11px] text-foreground whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>;
  }
}

function GitStatusResult({ data }: { data: Record<string, unknown> }): React.ReactElement {
  const branch = data['branch'] as string;
  const modified = (data['modified'] ?? []) as Array<{ path: string; status: string }>;
  const staged = (data['staged'] ?? []) as Array<{ path: string; status: string }>;
  const untracked = (data['untracked'] ?? []) as string[];

  return (
    <div className="space-y-1 text-[11px]">
      <div className="text-muted">
        Branch: <span className="text-foreground font-medium">{branch}</span>
      </div>
      {staged.length > 0 && (
        <div>
          <span className="text-green-400">Staged ({staged.length})</span>
          {staged.map(f => (
            <div key={f.path} className="pl-2 text-foreground">{f.status[0]} {f.path}</div>
          ))}
        </div>
      )}
      {modified.length > 0 && (
        <div>
          <span className="text-yellow-400">Modified ({modified.length})</span>
          {modified.map(f => (
            <div key={f.path} className="pl-2 text-foreground">{f.status[0]} {f.path}</div>
          ))}
        </div>
      )}
      {untracked.length > 0 && (
        <div>
          <span className="text-muted">Untracked ({untracked.length})</span>
          {untracked.map(f => (
            <div key={f} className="pl-2 text-foreground">? {f}</div>
          ))}
        </div>
      )}
      {staged.length === 0 && modified.length === 0 && untracked.length === 0 && (
        <div className="text-muted">Working tree clean</div>
      )}
    </div>
  );
}

function DiagnosticsResult({ data }: { data: Record<string, unknown> }): React.ReactElement {
  const errorCount = data['errorCount'] as number;
  const warningCount = data['warningCount'] as number;
  const files = (data['files'] ?? []) as Array<{
    file: string;
    diagnostics: Array<{ severity: string; message: string; line: number; column: number }>;
  }>;

  return (
    <div className="space-y-1 text-[11px]">
      <div className="flex gap-3 text-muted">
        <span className={errorCount > 0 ? 'text-error' : ''}>{errorCount} errors</span>
        <span className={warningCount > 0 ? 'text-yellow-400' : ''}>{warningCount} warnings</span>
      </div>
      {files.map(f => (
        <div key={f.file}>
          <div className="font-medium text-foreground">{f.file}</div>
          {f.diagnostics.map((d, i) => (
            <div key={i} className="pl-2">
              <span className={d.severity === 'Error' ? 'text-error' : 'text-yellow-400'}>
                {d.severity}
              </span>
              <span className="text-muted"> L{d.line}:{d.column} </span>
              <span className="text-foreground">{d.message}</span>
            </div>
          ))}
        </div>
      ))}
      {files.length === 0 && (
        <div className="text-muted">No problems found</div>
      )}
    </div>
  );
}

function OpenFilesResult({ data }: { data: Record<string, unknown> }): React.ReactElement {
  const files = (data['files'] ?? []) as Array<{ path: string; isActive: boolean }>;

  return (
    <div className="space-y-0.5 text-[11px]">
      {files.map((f, i) => (
        <div key={i} className={`text-foreground ${f.isActive ? 'font-medium' : ''}`}>
          {f.isActive && <span className="text-primary mr-1">&#x25B6;</span>}
          {f.path}
        </div>
      ))}
      {files.length === 0 && <div className="text-muted">No files open</div>}
    </div>
  );
}

function GitLogResult({ data }: { data: Record<string, unknown> }): React.ReactElement {
  const commits = (data['commits'] ?? []) as Array<{
    hash: string;
    message: string;
    author: string;
    date: string | null;
  }>;

  return (
    <div className="space-y-0.5 text-[11px]">
      {commits.map(c => (
        <div key={c.hash} className="flex gap-2">
          <span className="flex-shrink-0 font-mono text-primary">{c.hash}</span>
          <span className="truncate text-foreground">{c.message}</span>
        </div>
      ))}
      {commits.length === 0 && <div className="text-muted">No commits</div>}
    </div>
  );
}

function formatActionLabel(action: string): string {
  const labels: Record<string, string> = {
    getGitStatus: 'Git Status',
    getGitDiff: 'Git Diff',
    getFileDiff: 'File Diff',
    getDiagnostics: 'Diagnostics',
    getOpenFiles: 'Open Files',
    getGitLog: 'Git Log',
    getSymbols: 'Symbols',
    getWorkspaceFiles: 'Workspace Files',
    searchFiles: 'Search Results',
    readFile: 'File Content',
    getActiveFile: 'Active File',
  };
  return labels[action] ?? action;
}

function Spinner(): React.ReactElement {
  return (
    <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20" strokeDashoffset="5" />
    </svg>
  );
}

function GitIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="3" cy="3" r="1.5" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="M3 4.5V7.5C3 8.33 3.67 9 4.5 9H7.5" />
    </svg>
  );
}

function DiffIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 2V10" />
      <path d="M8 2V10" />
      <path d="M2 6H6" />
      <path d="M9.5 4.5L6.5 7.5" />
      <path d="M6.5 4.5L9.5 7.5" />
    </svg>
  );
}

function ErrorIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M5.13 1.86L0.92 9.5C0.68 9.93 0.99 10.5 1.5 10.5H10.5C11.01 10.5 11.32 9.93 11.08 9.5L6.87 1.86C6.63 1.43 6.37 1.43 6.13 1.86Z" />
      <path d="M6 4.5V7" />
      <circle cx="6" cy="8.5" r="0.5" fill="currentColor" />
    </svg>
  );
}

function FilesIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1H2.5C1.67 1 1 1.67 1 2.5V9.5C1 10.33 1.67 11 2.5 11H7.5" />
      <path d="M5 1H9.5C10.33 1 11 1.67 11 2.5V9.5C11 10.33 10.33 11 9.5 11H5" />
    </svg>
  );
}

function LogIcon(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 3H10" />
      <path d="M2 6H8" />
      <path d="M2 9H6" />
    </svg>
  );
}
