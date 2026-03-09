import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../../lib/i18n';
import mascotAvatar from '../../assets/images/cebus-mascot-avatar-sq.png';

export function SignUpPage() {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const { t, locale, setLocale, isRtl } = useI18n();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await signUp(username, password, displayName || username);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div dir={isRtl ? 'rtl' : 'ltr'} className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-8">
        <div className="mb-6 flex flex-col items-center">
          <img src={mascotAvatar} alt="Cebus" className="mb-3 h-20 w-20 rounded-full shadow-lg shadow-indigo-500/20" />
          <span className="mb-1 text-lg font-bold tracking-tight text-zinc-100">Cebus</span>
          <h1 className="text-2xl font-bold text-zinc-100">{t('auth.createAccount')}</h1>
        </div>
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setLocale(locale === 'en' ? 'he' : 'en')}
            className="rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            {locale === 'en' ? 'HE' : 'EN'}
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder={t('auth.username')}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
          />
          <input
            type="text"
            placeholder={t('auth.displayName')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
          />
          <input
            type="password"
            placeholder={t('auth.password')}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" className="w-full rounded-lg bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-500">
            {t('auth.createAccount')}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-zinc-500">
          {t('auth.haveAccount')}{' '}
          <Link to="/login" className="text-indigo-400 hover:text-indigo-300">{t('auth.signInLink')}</Link>
        </p>
      </div>
    </div>
  );
}
