import { useState, useEffect, useRef } from 'react';
import { Plus, ChevronDown, Trash2, Settings, MessageCircle, GripVertical } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { AddAgentDialog } from './AddAgentDialog';
import { RoleManagerDialog } from '../roles/RoleManagerDialog';
import { useI18n } from '../../lib/i18n';
import { resolveProviderStyle } from '../../lib/provider-styles';
import { AgentName } from '../shared/AgentName';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Agent {
  id: string;
  provider: string;
  model: string;
  displayName: string;
  avatarLetter: string;
  avatarColor: string;
  isFavorite: boolean;
}

interface AgentListProps {
  channelId: string | null;
  onAddAgent?: ((agentId: string, roleTemplate?: string) => void) | undefined;
  onOpenDM?: ((agentId: string) => void) | undefined;
}

function SortableAgentItem({
  agent,
  channelId,
  onAddAgent,
  onOpenDM,
  onDelete,
  onAddClick,
  rolePickerAgentId: _rolePickerAgentId,
}: {
  agent: Agent;
  channelId: string | null;
  onAddAgent?: ((agentId: string, roleTemplate?: string) => void) | undefined;
  onOpenDM?: ((agentId: string) => void) | undefined;
  onDelete: (agentId: string) => void;
  onAddClick: (agentId: string) => void;
  rolePickerAgentId: string | null;
}) {
  const { t } = useI18n();
  const rolesQuery = trpc.role.list.useQuery();
  const roles = rolesQuery.data ?? [];

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: agent.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const s = resolveProviderStyle(agent.provider, agent.model);

  return (
    <div ref={setNodeRef} style={style}>
      <div className="group flex items-center gap-0.5 rounded px-1 py-1 text-sm text-zinc-400 hover:bg-zinc-800">
        <button
          className="flex shrink-0 cursor-grab touch-none items-center p-0.5 text-zinc-700 opacity-0 transition-opacity hover:text-zinc-400 group-hover:opacity-100 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={12} />
        </button>
        <div
          draggable
          onClick={() => onOpenDM?.(agent.id)}
          onDragStart={(e) => {
            e.dataTransfer.setData('application/cebus-agent', agent.id);
            e.dataTransfer.effectAllowed = 'copy';
            (e.currentTarget as HTMLElement).style.opacity = '0.4';
          }}
          onDragEnd={(e) => {
            (e.currentTarget as HTMLElement).style.opacity = '';
          }}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
        >
          {s.icon ? (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center text-base">
              {s.icon}
            </span>
          ) : (
            <div
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ backgroundColor: s.color }}
            >
              {agent.avatarLetter}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-sm"
              style={{ color: resolveProviderStyle(agent.provider, agent.model).color }}
            >
              <AgentName displayName={agent.displayName} provider={agent.provider} modelId={agent.model} />
            </div>
            <div className="truncate text-[10px] text-zinc-600">{agent.model}</div>
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          {onOpenDM && (
            <button
              onClick={() => onOpenDM(agent.id)}
              title="DM"
              className="rounded p-0.5 text-zinc-600 hover:bg-indigo-500/20 hover:text-indigo-400"
            >
              <MessageCircle size={12} />
            </button>
          )}
          {channelId && onAddAgent && (
            <button
              onClick={() => onAddClick(agent.id)}
              title={t('addAgent.addToChannel')}
              className="flex items-center rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300"
            >
              <Plus size={12} />
              {roles.length > 0 && <ChevronDown size={10} />}
            </button>
          )}
          <button
            onClick={() => onDelete(agent.id)}
            title={t('addAgent.deleteAgent')}
            className="rounded p-0.5 text-zinc-600 hover:bg-red-500/20 hover:text-red-400"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AgentList({ channelId, onAddAgent, onOpenDM }: AgentListProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [roleManagerOpen, setRoleManagerOpen] = useState(false);
  const [rolePickerAgentId, setRolePickerAgentId] = useState<string | null>(null);
  const agentsQuery = trpc.agent.list.useQuery();
  const rolesQuery = trpc.role.list.useQuery();
  const deleteMutation = trpc.agent.delete.useMutation({
    onSuccess: () => agentsQuery.refetch(),
  });
  const reorderMutation = trpc.agent.reorder.useMutation({
    onSuccess: () => agentsQuery.refetch(),
  });
  const agents = agentsQuery.data ?? [];
  const roles = rolesQuery.data ?? [];
  const customRoles = roles.filter((r) => r.source === 'custom');
  const builtinRoles = roles.filter((r) => r.source === 'builtin');
  const { t } = useI18n();
  const rolePickerRef = useRef<HTMLDivElement>(null);
  const mouseLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (!rolePickerAgentId) return;
    function handleClickOutside(e: MouseEvent) {
      if (rolePickerRef.current && !rolePickerRef.current.contains(e.target as Node)) {
        setRolePickerAgentId(null);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setRolePickerAgentId(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      if (mouseLeaveTimerRef.current) clearTimeout(mouseLeaveTimerRef.current);
    };
  }, [rolePickerAgentId]);

  function handleAddClick(agentId: string) {
    if (roles.length > 0) {
      setRolePickerAgentId(rolePickerAgentId === agentId ? null : agentId);
    } else {
      onAddAgent?.(agentId);
    }
  }

  function handleRoleSelect(agentId: string, role?: string) {
    onAddAgent?.(agentId, role);
    setRolePickerAgentId(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = agents.findIndex((a) => a.id === active.id);
    const newIndex = agents.findIndex((a) => a.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(agents, oldIndex, newIndex);
    reorderMutation.mutate({ orderedIds: reordered.map((a) => a.id) });
  }

  return (
    <div className="px-2">
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          {t('sidebar.agents')} ({agents.length})
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setRoleManagerOpen(true)}
            title={t('roles.manageRoles')}
            className="rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300"
          >
            <Settings size={12} />
          </button>
          <button
            onClick={() => setDialogOpen(true)}
            title={t('addAgent.title')}
            className="rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={agents.map((a) => a.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-0.5">
            {agents.map((agent) => (
              <div key={agent.id}>
                <SortableAgentItem
                  agent={agent}
                  channelId={channelId}
                  onAddAgent={onAddAgent}
                  onOpenDM={onOpenDM}
                  onDelete={(id) => deleteMutation.mutate({ agentId: id })}
                  onAddClick={handleAddClick}
                  rolePickerAgentId={rolePickerAgentId}
                />
                {rolePickerAgentId === agent.id && (
                  <div
                    ref={rolePickerRef}
                    className="ms-8 me-1 mt-0.5 max-h-48 overflow-y-auto rounded border border-zinc-700 bg-zinc-800 py-1"
                    onMouseEnter={() => {
                      if (mouseLeaveTimerRef.current) {
                        clearTimeout(mouseLeaveTimerRef.current);
                        mouseLeaveTimerRef.current = null;
                      }
                    }}
                    onMouseLeave={() => {
                      mouseLeaveTimerRef.current = setTimeout(
                        () => setRolePickerAgentId(null),
                        1500
                      );
                    }}
                  >
                    <button
                      onClick={() => handleRoleSelect(agent.id)}
                      className="w-full px-3 py-1 text-start text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                    >
                      {t('addAgent.noRole')}
                    </button>
                    {customRoles.length > 0 && (
                      <>
                        <div className="my-1 border-t border-zinc-700" />
                        <div className="px-3 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
                          {t('roles.custom')}
                        </div>
                        {customRoles.map((role) => (
                          <button
                            key={role.id}
                            onClick={() => handleRoleSelect(agent.id, role.id)}
                            className="w-full px-3 py-1 text-start text-xs text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
                          >
                            <div className="font-medium">{role.name}</div>
                            {role.description && (
                              <div className="truncate text-zinc-500">{role.description}</div>
                            )}
                          </button>
                        ))}
                      </>
                    )}
                    {builtinRoles.length > 0 && (
                      <>
                        <div className="my-1 border-t border-zinc-700" />
                        <div className="px-3 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
                          {t('roles.builtIn')}
                        </div>
                        {builtinRoles.map((role) => (
                          <button
                            key={role.id}
                            onClick={() => handleRoleSelect(agent.id, role.id)}
                            className="w-full px-3 py-1 text-start text-xs text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
                          >
                            <div className="font-medium">{role.name}</div>
                            {role.description && (
                              <div className="truncate text-zinc-500">{role.description}</div>
                            )}
                          </button>
                        ))}
                      </>
                    )}
                    <div className="my-1 border-t border-zinc-700" />
                    <button
                      onClick={() => {
                        setRolePickerAgentId(null);
                        setRoleManagerOpen(true);
                      }}
                      className="w-full px-3 py-1 text-start text-[10px] font-medium text-indigo-400 hover:bg-zinc-700 hover:text-indigo-300"
                    >
                      {t('roles.manageRoles')}...
                    </button>
                  </div>
                )}
              </div>
            ))}
            {agents.length === 0 && (
              <p className="px-2 py-2 text-xs text-zinc-600">{t('sidebar.noAgents')}</p>
            )}
          </div>
        </SortableContext>
      </DndContext>

      <AddAgentDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
      <RoleManagerDialog open={roleManagerOpen} onClose={() => setRoleManagerOpen(false)} />
    </div>
  );
}
