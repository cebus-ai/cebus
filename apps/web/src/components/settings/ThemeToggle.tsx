import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';
import { useI18n } from '../../lib/i18n';

export function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('theme') !== 'light';
  });
  const { t } = useI18n();

  useEffect(() => {
    const html = document.documentElement;
    if (dark) {
      html.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      html.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [dark]);

  return (
    <button
      onClick={() => setDark(!dark)}
      className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
      title={dark ? t('theme.light') : t('theme.dark')}
    >
      {dark ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
