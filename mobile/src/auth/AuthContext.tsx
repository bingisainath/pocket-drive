import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onUnauthorized } from '../api/client';
import { api } from '../api/drive';
import type { User } from '../shared/types';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; error?: string }
  | { status: 'signedIn'; user: User };

interface AuthValue {
  state: AuthState;
  signIn: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-check the session with the server (e.g. after the app comes back online). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setState(me.authenticated && me.user ? { status: 'signedIn', user: me.user } : { status: 'signedOut' });
    } catch (err) {
      setState({ status: 'signedOut', error: (err as Error).message });
    }
  }, []);

  const signIn = useCallback(
    async (password: string) => {
      await api.login(password); // throws ApiError with the server's message ("Wrong password", rate limit…)
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    await api.logout().catch(() => {}); // signed out locally even if the server can't be reached
    setState({ status: 'signedOut' });
  }, []);

  useEffect(() => {
    refresh();
    onUnauthorized(() => setState({ status: 'signedOut', error: 'Your session ended. Please sign in again.' }));
  }, [refresh]);

  const value = useMemo(() => ({ state, signIn, signOut, refresh }), [state, signIn, signOut, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
