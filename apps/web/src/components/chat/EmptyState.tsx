import { MessageCircle } from 'lucide-react';
import { useI18n } from '../../lib/i18n';

export function EmptyState() {
  const { t } = useI18n();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="rounded-full bg-zinc-800 p-4">
        <MessageCircle size={32} className="text-zinc-600" />
      </div>
      <div>
        <p className="text-sm font-medium text-zinc-400">{t('chat.noMessages')}</p>
        <p className="mt-1 text-xs text-zinc-600">{t('chat.startConversation')}</p>
      </div>
    </div>
  );
}
