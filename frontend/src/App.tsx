import { useEffect, useState } from 'react';
import { api, onUnauthorized } from './api';
import Drive from './components/Drive';
import Login from './components/Login';
import { Spinner } from './components/ui';

type AuthState = 'checking' | 'signed-in' | 'signed-out';

export default function App() {
  const [auth, setAuth] = useState<AuthState>('checking');

  useEffect(() => {
    onUnauthorized(() => setAuth('signed-out'));
    api.me().then(
      (res) => setAuth(res.authenticated ? 'signed-in' : 'signed-out'),
      () => setAuth('signed-out'),
    );
  }, []);

  if (auth === 'checking') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-8 text-slate-400" />
      </div>
    );
  }
  if (auth === 'signed-out') return <Login onSuccess={() => setAuth('signed-in')} />;
  return <Drive onSignedOut={() => setAuth('signed-out')} />;
}
