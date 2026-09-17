import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onUnauthorized } from '../api/client';
import { api } from '../api/drive';
import { clearToken, currentToken, loadToken, saveToken } from '../lib/auth-token';
import { queryClient } from '../lib/query';
import { clearStorage } from '../lib/storage';
import type { User } from '../shared/types';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; error?: string }
  | { status: 'signedIn'; user: User };

interface AuthValue {
  state: AuthState;
  signIn: (password: string) => Promise<void>;
  signInWithGoogle: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-check the session with the server (e.g. after the app comes back online). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Wipe every trace of the signed-in user: token, settings/prefs and cached server data. */
async function clearLocalData() {
  await clearToken();
  clearStorage();
  queryClient.clear();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    if (!currentToken()) return setState({ status: 'signedOut' });
    try {
      const me = await api.me();
      setState(me.authenticated && me.user ? { status: 'signedIn', user: me.user } : { status: 'signedOut' });
    } catch (err) {
      setState({ status: 'signedOut', error: (err as Error).message });
    }
  }, []);

  const finishSignIn = useCallback(async (result: { token: string; user: User }) => {
    await saveToken(result.token);
    setState({ status: 'signedIn', user: result.user });
  }, []);

  const signIn = useCallback(
    async (password: string) => {
      await finishSignIn(await api.tokenLogin(password)); // throws ApiError with the server's message
    },
    [finishSignIn],
  );

  const signInWithGoogle = useCallback(
    async (idToken: string) => {
      await finishSignIn(await api.tokenGoogle(idToken));
    },
    [finishSignIn],
  );

  const signOut = useCallback(async () => {
    await api.logout().catch(() => {}); // revoke server-side if reachable; sign out locally regardless
    await clearLocalData();
    setState({ status: 'signedOut' });
  }, []);

  useEffect(() => {
    (async () => {
      await loadToken(); // restore the Keystore token into memory before the first request
      await refresh();
    })();
    onUnauthorized(async () => {
      await clearLocalData();
      setState({ status: 'signedOut', error: 'Your session ended. Please sign in again.' });
    });
  }, [refresh]);

  const value = useMemo(
    () => ({ state, signIn, signInWithGoogle, signOut, refresh }),
    [state, signIn, signInWithGoogle, signOut, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
