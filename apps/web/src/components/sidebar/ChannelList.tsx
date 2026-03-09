import { Hash, Plus, Archive, Trash2, GripVertical } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
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

interface Channel {
  id: string;
  name: string;
  status: string;
}

interface ChannelListProps {
  channels: Channel[];
  selectedId: string | null;
  unreadCounts?: Record<string, number> | undefined;
  onSelect: (id: string) => void;
  onCreateClick: () => void;
  onArchive?: ((channelId: string) => void) | undefined;
  onDelete?: ((channelId: string) => void) | undefined;
  onReorder?: ((orderedIds: string[]) => void) | undefined;
}

function SortableChannelItem({
  channel,
  selectedId,
  unreadCount,
  onSelect,
  onArchive,
  onDelete,
}: {
  channel: Channel;
  selectedId: string | null;
  unreadCount: number;
  onSelect: (id: string) => void;
  onArchive?: ((channelId: string) => void) | undefined;
  onDelete?: ((channelId: string) => void) | undefined;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: channel.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="group flex items-center">
      <button
        className="flex shrink-0 cursor-grab touch-none items-center p-0.5 text-zinc-700 opacity-0 transition-opacity hover:text-zinc-400 group-hover:opacity-100 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={12} />
      </button>
      <button
        onClick={() => onSelect(channel.id)}
        className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1 text-sm transition-colors ${
          selectedId === channel.id
            ? 'bg-indigo-500/15 text-indigo-400'
            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
        }`}
      >
        <Hash size={14} className="shrink-0" />
        <span className="truncate">{channel.name}</span>
        {unreadCount > 0 && selectedId !== channel.id && (
          <span className="ml-auto shrink-0 rounded-full bg-indigo-500 px-1.5 text-[10px] font-bold leading-4 text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {(onArchive || onDelete) && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {onArchive && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onArchive(channel.id);
              }}
              title="Archive"
              className="rounded p-0.5 text-zinc-600 hover:bg-amber-500/20 hover:text-amber-400"
            >
              <Archive size={11} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(channel.id);
              }}
              title="Delete"
              className="rounded p-0.5 text-zinc-600 hover:bg-red-500/20 hover:text-red-400"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ChannelList({
  channels,
  selectedId,
  unreadCounts,
  onSelect,
  onCreateClick,
  onArchive,
  onDelete,
  onReorder,
}: ChannelListProps) {
  const { t } = useI18n();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = channels.findIndex((c) => c.id === active.id);
    const newIndex = channels.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(channels, oldIndex, newIndex);
    onReorder?.(reordered.map((c) => c.id));
  }

  return (
    <div className="px-2">
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          {t('sidebar.channels')}
        </span>
        <button
          onClick={onCreateClick}
          className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        >
          <Plus size={14} />
        </button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={channels.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-0.5">
            {channels.map((ch) => (
              <SortableChannelItem
                key={ch.id}
                channel={ch}
                selectedId={selectedId}
                unreadCount={unreadCounts?.[ch.id] ?? 0}
                onSelect={onSelect}
                onArchive={onArchive}
                onDelete={onDelete}
              />
            ))}
            {channels.length === 0 && (
              <p className="px-2 py-2 text-xs text-zinc-600">{t('channel.noChannels')}</p>
            )}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
