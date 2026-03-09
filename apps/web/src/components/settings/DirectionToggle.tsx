import { useI18n } from '../../lib/i18n';

export function DirectionToggle() {
  const { locale, setLocale, t } = useI18n();

  return (
    <button
      onClick={() => setLocale(locale === 'en' ? 'he' : 'en')}
      className="rounded px-1.5 py-0.5 text-[10px] font-bold text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
      title={locale === 'he' ? 'Switch to LTR (English)' : 'Switch to RTL (Hebrew)'}
    >
      {t('dir.toggle')}
    </button>
  );
}
