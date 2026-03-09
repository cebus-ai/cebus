import { useState, useEffect } from 'react';
import { X, Trash2 } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { useI18n } from '../../lib/i18n';

interface AgentEditorDialogProps {
  open: boolean;
  onClose: () => void;
  channelId: string;
  agent: {
    agentId: string;
    displayName: string;
    originalDisplayName?: string | undefined;
    displayNameOverride?: string | null | undefined;
    roleTemplate?: string | null | undefined;
    roleName?: string | null | undefined;
    roleInstructions?: string | null | undefined;
    avatarLetter: string;
    avatarColor: string;
  };
  onRemoveAgent?: ((agentId: string) => void) | undefined;
}

export function AgentEditorDialog({ open, onClose, channelId, agent, onRemoveAgent }: AgentEditorDialogProps) {
  const [displayName, setDisplayName] = useState('');
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [customInstructions, setCustomInstructions] = useState('');
  const { t } = useI18n();

  const rolesQuery = trpc.role.list.useQuery(undefined, { enabled: open });
  const roles = rolesQuery.data ?? [];
  const utils = trpc.useUtils();

  const updateMutation = trpc.channel.updateAgent.useMutation({
    onSuccess: () => {
      utils.channel.get.invalidate({ channelId });
      onClose();
    },
  });

  useEffect(() => {
    if (open) {
      setDisplayName(agent.displayNameOverride ?? '');
      setSelectedRole(agent.roleTemplate ?? null);
      setCustomInstructions(agent.roleInstructions ?? '');
    }
  }, [open, agent.displayNameOverride, agent.roleTemplate, agent.roleInstructions]);

  if (!open) return null;

  const handleSave = () => {
    const nameOverride = displayName.trim() || null;
    const roleChanged = selectedRole !== (agent.roleTemplate ?? null);

    updateMutation.mutate({
      channelId,
      agentId: agent.agentId,
      displayNameOverride: nameOverride,
      roleTemplate: roleChanged ? selectedRole : undefined,
      customInstructions: customInstructions.trim() || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ backgroundColor: agent.avatarColor }}
          >
            {agent.avatarLetter}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-zinc-100">{t('agentEditor.title')}</h2>
            <p className="truncate text-[11px] text-zinc-500">{agent.originalDisplayName ?? agent.displayName}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="space-y-4 p-4">
          {/* Display Name Override */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">{t('agentEditor.displayName')}</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={64}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
              placeholder={agent.originalDisplayName ?? agent.displayName}
            />
            <p className="mt-0.5 text-[10px] text-zinc-600">{t('agentEditor.displayNameHint')}</p>
          </div>

          {/* Role Selector */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">{t('agentEditor.role')}</label>
            <select
              value={selectedRole ?? ''}
              onChange={(e) => setSelectedRole(e.target.value || null)}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">{t('agentEditor.noRole')}</option>
              {roles.filter((r) => r.source === 'custom').map((role) => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
              {roles.filter((r) => r.source === 'builtin').map((role) => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
          </div>

          {/* Custom Instructions */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">{t('agentEditor.customInstructions')}</label>
            <textarea
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              maxLength={8000}
              rows={4}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
              placeholder="You are an expert in..."
            />
            <p className="mt-0.5 text-[10px] text-zinc-600">{t('agentEditor.customInstructionsHint')}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-3">
          {onRemoveAgent ? (
            <button
              onClick={() => { onRemoveAgent(agent.agentId); onClose(); }}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-500/10"
            >
              <Trash2 size={12} />
              {t('agentEditor.remove')}
            </button>
          ) : (
            <div />
          )}
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {updateMutation.isPending ? t('agentEditor.saving') : t('agentEditor.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
