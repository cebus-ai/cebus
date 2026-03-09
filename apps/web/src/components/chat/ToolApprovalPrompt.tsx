import { Shield } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { useI18n } from '../../lib/i18n';
import type { PendingApproval } from '../../hooks/useStream';

interface ToolApprovalPromptProps {
  channelId: string;
  approval: PendingApproval;
  onResolved: (approvalId: string) => void;
}

function describeDetail(params: Record<string, unknown>): string | undefined {
  const path = params['path'] ?? params['filePath'] ?? params['file'];
  if (typeof path === 'string') return path;
  const command = params['command'] ?? params['cmd'];
  if (typeof command === 'string') return command;
  return undefined;
}

type PermissionKey = 'permissions.shell' | 'permissions.write' | 'permissions.read' | 'permissions.mcp' | 'permissions.url';

const KIND_TO_KEY: Record<string, PermissionKey> = {
  shell: 'permissions.shell',
  write: 'permissions.write',
  read: 'permissions.read',
  mcp: 'permissions.mcp',
  url: 'permissions.url',
};

export function ToolApprovalPrompt({ channelId, approval, onResolved }: ToolApprovalPromptProps) {
  const { t } = useI18n();
  const respondMutation = trpc.message.respondToApproval.useMutation({
    onSuccess: () => onResolved(approval.approvalId),
  });

  const detail = describeDetail(approval.parameters);
  const kindKey = KIND_TO_KEY[approval.permissionKind] ?? 'permissions.mcp';

  const respond = (approved: boolean, budget: number) => {
    respondMutation.mutate({
      channelId,
      approvalId: approval.approvalId,
      approved,
      budget,
    });
  };

  return (
    <div className="mx-4 my-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-400">
        <Shield size={14} />
        <span>
          <bdi className="font-semibold">{approval.displayName}</bdi>{' '}
          {t('permissions.wantsTo')} {t(kindKey)}
        </span>
      </div>
      {detail && (
        <div dir="ltr" className="mt-1 rounded bg-zinc-800/60 px-2 py-1 text-left font-mono text-xs text-zinc-300" style={{ unicodeBidi: 'isolate-override' }}>
          {detail}
        </div>
      )}
      {!detail && approval.toolName && (
        <div className="mt-1 text-xs text-zinc-500">{approval.toolName}</div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          onClick={() => respond(true, 1)}
          disabled={respondMutation.isPending}
          className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {t('permissions.allowOnce')}
        </button>
        <button
          onClick={() => respond(true, -1)}
          disabled={respondMutation.isPending}
          className="rounded bg-emerald-600/70 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {t('permissions.allowSession')}
        </button>
        <button
          onClick={() => respond(false, 0)}
          disabled={respondMutation.isPending}
          className="rounded bg-zinc-700 px-3 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
        >
          {t('permissions.deny')}
        </button>
      </div>
    </div>
  );
}
