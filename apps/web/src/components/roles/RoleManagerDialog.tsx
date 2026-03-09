import { useState } from 'react';
import { X, Plus, Pencil, Trash2, Shield } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { RoleEditorDialog } from './RoleEditorDialog';
import { useI18n } from '../../lib/i18n';

interface RoleManagerDialogProps {
  open: boolean;
  onClose: () => void;
}

export function RoleManagerDialog({ open, onClose }: RoleManagerDialogProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<{
    id: string;
    name: string;
    description: string;
    instructions: string;
  } | null>(null);
  const { t } = useI18n();

  const rolesQuery = trpc.role.list.useQuery();
  const deleteMutation = trpc.role.delete.useMutation({
    onSuccess: () => rolesQuery.refetch(),
  });

  const roles = rolesQuery.data ?? [];
  const customRoles = roles.filter((r) => r.source === 'custom');
  const builtinRoles = roles.filter((r) => r.source === 'builtin');

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <div className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <Shield size={16} className="text-indigo-400" />
              <h2 className="text-sm font-semibold text-zinc-100">{t('roles.title')}</h2>
            </div>
            <button
              onClick={onClose}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            >
              <X size={16} />
            </button>
          </div>

          {/* Role list */}
          <div className="max-h-[60vh] overflow-y-auto p-3">
            {/* Custom roles */}
            {customRoles.length > 0 && (
              <div className="mb-3">
                <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {t('roles.custom')}
                </div>
                <div className="space-y-1">
                  {customRoles.map((role) => (
                    <div
                      key={role.id}
                      className="group flex items-start gap-2 rounded-md border border-zinc-800 bg-zinc-800/40 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-zinc-200">{role.name}</div>
                        {role.description && (
                          <div className="mt-0.5 text-xs text-zinc-500">{role.description}</div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => {
                            setEditingRole({
                              id: role.id,
                              name: role.name,
                              description: role.description,
                              instructions: role.instructions,
                            });
                            setEditorOpen(true);
                          }}
                          title={t('roles.editRole')}
                          className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => deleteMutation.mutate({ roleId: role.id })}
                          title={t('roles.deleteRole')}
                          className="rounded p-1 text-zinc-500 hover:bg-red-500/20 hover:text-red-400"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Built-in roles */}
            {builtinRoles.length > 0 && (
              <div>
                <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {t('roles.builtIn')}
                </div>
                <div className="space-y-1">
                  {builtinRoles.map((role) => (
                    <div
                      key={role.id}
                      className="flex items-start gap-2 rounded-md border border-zinc-800/50 bg-zinc-900/50 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-zinc-300">{role.name}</div>
                        {role.description && (
                          <div className="mt-0.5 text-xs text-zinc-600">{role.description}</div>
                        )}
                      </div>
                      <span className="shrink-0 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">
                        {t('roles.builtIn')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {roles.length === 0 && (
              <p className="py-8 text-center text-sm text-zinc-600">{t('roles.empty')}</p>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-zinc-800 px-4 py-3">
            <button
              onClick={() => {
                setEditingRole(null);
                setEditorOpen(true);
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
            >
              <Plus size={14} />
              {t('roles.createNew')}
            </button>
          </div>
        </div>
      </div>

      <RoleEditorDialog
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditingRole(null);
        }}
        onSaved={() => {
          setEditorOpen(false);
          setEditingRole(null);
          rolesQuery.refetch();
        }}
        editRole={editingRole}
      />
    </>
  );
}
