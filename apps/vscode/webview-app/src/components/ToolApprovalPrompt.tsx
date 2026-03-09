import React from 'react';
import type { PendingApproval } from '../hooks/useVSCodeMessages';

interface ToolApprovalPromptProps {
  approval: PendingApproval;
  onResolve: (approvalId: string, approved: boolean, budget: number) => void;
}

export function ToolApprovalPrompt({
  approval,
  onResolve,
}: ToolApprovalPromptProps): React.ReactElement {
  const { approvalId, toolName, permissionKind } = approval;

  const kindLabel =
    permissionKind === 'shell'
      ? 'run a command'
      : permissionKind === 'write'
        ? 'write a file'
        : permissionKind === 'mcp'
          ? 'use a tool'
          : permissionKind === 'url'
            ? 'fetch a URL'
            : 'perform an action';

  return (
    <div className="rounded-md border border-[#e8a84880] bg-[#e8a84810] p-3">
      <div className="mb-2 text-sm">
        <span className="font-semibold">{toolName}</span>
        <span className="text-muted"> wants to {kindLabel}</span>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onResolve(approvalId, true, 1)}
          className="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Allow once
        </button>
        <button
          onClick={() => onResolve(approvalId, true, -1)}
          className="rounded bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground hover:opacity-80"
        >
          Allow for session
        </button>
        <button
          onClick={() => onResolve(approvalId, false, 0)}
          className="rounded border border-border px-2.5 py-1 text-xs font-medium text-muted hover:text-foreground"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
