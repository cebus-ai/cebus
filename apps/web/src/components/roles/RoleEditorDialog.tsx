import { useState, useEffect } from 'react';
import { X, Sparkles } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { useI18n } from '../../lib/i18n';

interface RoleEditorDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editRole?: {
    id: string;
    name: string;
    description: string;
    instructions: string;
  } | null | undefined;
}

export function RoleEditorDialog({ open, onClose, onSaved, editRole }: RoleEditorDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [aiProvider, setAiProvider] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [showAiPicker, setShowAiPicker] = useState(false);
  const { t } = useI18n();

  const providersQuery = trpc.agent.listProviders.useQuery(undefined, { enabled: open && showAiPicker });
  const createMutation = trpc.role.create.useMutation({ onSuccess: onSaved });
  const updateMutation = trpc.role.update.useMutation({ onSuccess: onSaved });
  const generateMutation = trpc.role.generateInstructions.useMutation({
    onSuccess: (data) => {
      setInstructions(data.instructions);
      setShowAiPicker(false);
    },
  });

  const isEditing = !!editRole;
  const providers = providersQuery.data ?? [];
  const selectedProvider = providers.find((p) => p.provider === aiProvider);

  useEffect(() => {
    if (open && editRole) {
      setName(editRole.name);
      setDescription(editRole.description);
      setInstructions(editRole.instructions);
    } else if (open) {
      setName('');
      setDescription('');
      setInstructions('');
    }
    setShowAiPicker(false);
    setAiProvider('');
    setAiModel('');
  }, [open, editRole]);

  if (!open) return null;

  const handleSave = () => {
    const trimmedName = name.trim();
    const trimmedInstructions = instructions.trim();
    if (!trimmedName || !trimmedInstructions) return;

    if (isEditing && editRole) {
      updateMutation.mutate({
        roleId: editRole.id,
        name: trimmedName,
        description: description.trim(),
        instructions: trimmedInstructions,
      });
    } else {
      createMutation.mutate({
        name: trimmedName,
        description: description.trim() || undefined,
        instructions: trimmedInstructions,
      });
    }
  };

  const handleGenerate = () => {
    if (!aiProvider || !aiModel || !name.trim()) return;
    generateMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      provider: aiProvider,
      model: aiModel,
    });
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">
            {isEditing ? t('roles.editRole') : t('roles.createNew')}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="space-y-3 p-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">{t('roles.name')}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              autoFocus
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
              placeholder="API Designer, Code Reviewer..."
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">{t('roles.description')}</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={256}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
              placeholder="Expert in designing RESTful APIs..."
            />
          </div>

          {/* Instructions */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-400">{t('roles.instructions')}</label>
              <button
                onClick={() => setShowAiPicker(!showAiPicker)}
                className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400 transition-colors hover:bg-amber-500/20"
              >
                <Sparkles size={10} />
                {t('roles.generateAI')}
              </button>
            </div>

            {/* AI model picker */}
            {showAiPicker && (
              <div className="mb-2 space-y-2 rounded border border-amber-500/20 bg-amber-500/5 p-2">
                <div className="flex gap-2">
                  <select
                    value={aiProvider}
                    onChange={(e) => { setAiProvider(e.target.value); setAiModel(''); }}
                    className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">{t('agentList.selectProvider')}</option>
                    {providers.map((p) => (
                      <option key={p.provider} value={p.provider}>{p.provider}</option>
                    ))}
                  </select>
                  <select
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    disabled={!aiProvider}
                    className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                  >
                    <option value="">{t('agentList.selectModel')}</option>
                    {selectedProvider?.models.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={!aiProvider || !aiModel || !name.trim() || generateMutation.isPending}
                  className="w-full rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-50"
                >
                  {generateMutation.isPending ? t('roles.generating') : t('roles.generateAI')}
                </button>
              </div>
            )}

            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength={8000}
              rows={6}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
              placeholder="You are an expert API designer. You focus on clean, RESTful design patterns..."
            />
            <p className="mt-0.5 text-[10px] text-zinc-600">{t('roles.instructionsHint')}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
          >
            {t('roles.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !instructions.trim() || isSaving}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {isSaving ? t('roles.saving') : t('roles.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
