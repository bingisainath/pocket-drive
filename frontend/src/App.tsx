import { useCallback, useEffect, useState } from 'react';
import { api, onUnauthorized } from './api';
import Drive from './components/Drive';
import Login from './components/Login';
import { Spinner } from './components/ui';
import type { Me } from './types';

const SIGNED_OUT: Me = { authenticated: false, user: null, google: { enabled: false, origins: [] } };

export default function App() {
  const [me, setMe] = useState<Me | null>(null); // null while checking

  const refresh = useCallback(() => {
    api.me().then(setMe, () => setMe(SIGNED_OUT));
  }, []);

  useEffect(() => {
    onUnauthorized(() => setMe((current) => current && { ...current, authenticated: false, user: null }));
    refresh();
  }, [refresh]);

  if (!me) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-8 text-slate-400" />
      </div>
    );
  }
  if (!me.authenticated || !me.user) return <Login google={me.google} onSuccess={refresh} />;
  return <Drive key={me.user.id} user={me.user} onSignedOut={() => setMe({ ...me, authenticated: false, user: null })} />;
}
