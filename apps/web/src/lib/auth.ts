const AUTH_BASE = '/api/auth';

interface AuthUser {
  id: string;
  name: string;
  email?: string | undefined;
}

interface SessionResponse {
  user: AuthUser | null;
}

function formatAuthError(raw: string, fallback: string): string {
  if (!raw || /\[body\.\w+\]/.test(raw)) return fallback;
  return raw;
}

export async function getSession(): Promise<SessionResponse> {
  const response = await fetch(`${AUTH_BASE}/get-session`, { credentials: 'include' });
  if (!response.ok) return { user: null };
  return response.json() as Promise<SessionResponse>;
}

export async function signUp(username: string, password: string, displayName: string): Promise<AuthUser> {
  const response = await fetch(`${AUTH_BASE}/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email: `${username}@cebus.local.dev`, password, name: displayName }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(formatAuthError(body?.message ?? '', 'Sign up failed'));
  }
  const data = await response.json() as { user: AuthUser };
  return data.user;
}

export async function signIn(username: string, password: string): Promise<AuthUser> {
  const response = await fetch(`${AUTH_BASE}/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email: `${username}@cebus.local.dev`, password }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(formatAuthError(body?.message ?? '', 'Invalid credentials'));
  }
  const data = await response.json() as { user: AuthUser };
  return data.user;
}

export async function signOut(): Promise<void> {
  await fetch(`${AUTH_BASE}/sign-out`, { method: 'POST', credentials: 'include' });
}
