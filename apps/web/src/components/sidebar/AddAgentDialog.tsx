import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { useI18n } from '../../lib/i18n';

interface AddAgentDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AddAgentDialog({ open, onClose }: AddAgentDialogProps) {
  const [selectedGroup, setSelectedGroup] = useState('');
  const [model, setModel] = useState('');
  const [displayName, setDisplayName] = useState('');
  const { t } = useI18n();

  const providersQuery = trpc.agent.listProviders.useQuery(undefined, { enabled: open });
  const createMutation = trpc.agent.create.useMutation();
  const utils = trpc.useUtils();

  const providers = providersQuery.data ?? [];
  const selectedProvider = providers.find((p) => p.groupKey === selectedGroup);
  const models = selectedProvider?.models ?? [];

  function handleProviderChange(value: string) {
    setSelectedGroup(value);
    setModel('');
    setDisplayName('');
  }

  function handleModelChange(value: string) {
    setModel(value);
    const m = models.find((x) => x.id === value);
    if (m) {
      setDisplayName(m.name || m.id);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedProvider || !model || !displayName) return;
    await createMutation.mutateAsync({ provider: selectedProvider.provider, model, displayName });
    utils.agent.list.invalidate();
    setSelectedGroup('');
    setModel('');
    setDisplayName('');
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">{t('addAgent.title')}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Provider select */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">{t('addAgent.provider')}</label>
            {providersQuery.isLoading ? (
              <p className="text-sm text-zinc-500">{t('addAgent.loading')}</p>
            ) : (
              <select
                value={selectedGroup}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
              >
                <option value="">{t('agentList.selectProvider')}</option>
                {providers.map((p) => (
                  <option key={p.groupKey} value={p.groupKey}>
                    {p.displayName} ({p.models.length})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Model select */}
          {selectedGroup && (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">{t('addAgent.model')}</label>
              {models.length === 0 ? (
                <p className="text-sm text-zinc-500">{t('addAgent.noModels')}</p>
              ) : (
                <select
                  value={model}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">{t('agentList.selectModel')}</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Display name */}
          {model && (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">{t('addAgent.displayName')}</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={32}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          )}

          {createMutation.error && (
            <p className="text-sm text-red-400">{createMutation.error.message}</p>
          )}

          <button
            type="submit"
            disabled={!selectedGroup || !model || !displayName || createMutation.isPending}
            className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600"
          >
            {createMutation.isPending ? t('addAgent.adding') : t('addAgent.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
