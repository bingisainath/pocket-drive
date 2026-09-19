import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, onUnauthorized } from '../api/client';
import { api } from '../api/drive';
import { clearToken, currentToken, loadToken, saveToken } from '../lib/auth-token';
import { queryClient } from '../lib/query';
import { clearStorage, storage, StorageKey } from '../lib/storage';
import { registerDeviceToken, unregisterDeviceToken } from '../push/push';
import type { User } from '../shared/types';

const saveLastUser = (user: User) => storage.set(StorageKey.lastUser, JSON.stringify(user));
function loadLastUser(): User | null {
  const raw = storage.getString(StorageKey.lastUser);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

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
      if (me.authenticated && me.user) {
        saveLastUser(me.user);
        setState({ status: 'signedIn', user: me.user });
      } else {
        setState({ status: 'signedOut' });
      }
    } catch (err) {
      // Offline with a valid token: trust the last known user instead of signing out. A real 401
      // goes through onUnauthorized (which clears the token), not here.
      const cached = loadLastUser();
      if ((err as ApiError).status === 0 && cached) setState({ status: 'signedIn', user: cached });
      else setState({ status: 'signedOut', error: (err as Error).message });
    }
  }, []);

  const finishSignIn = useCallback(async (result: { token: string; user: User }) => {
    await saveToken(result.token);
    saveLastUser(result.user);
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
    await unregisterDeviceToken().catch(() => {}); // needs the token, so before clearLocalData
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

  // Keep this device's push token registered whenever signed in (covers fresh sign-in and a cold
  // launch that restores the session). The refresh listener is torn down when we sign out.
  useEffect(() => {
    if (state.status !== 'signedIn') return;
    let unsub: (() => void) | undefined;
    registerDeviceToken()
      .then((u) => {
        unsub = u;
      })
      .catch(() => {});
    return () => unsub?.();
  }, [state.status]);

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
