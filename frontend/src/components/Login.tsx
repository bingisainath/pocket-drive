import { CircleAlert, Eye, EyeOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { Logo, Spinner, btn } from './ui';

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setPassword('');
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-xl ring-1 shadow-slate-900/5 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="size-14" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Drive</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Enter your password to continue</p>
        </div>

        {/* Lets password managers file the saved password under a stable "username". */}
        <input type="text" name="username" autoComplete="username" value="drive" readOnly hidden />
        <label htmlFor="password" className="sr-only">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={reveal ? 'text' : 'password'}
            autoComplete="current-password"
            autoFocus
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 w-full rounded-xl border border-slate-300 bg-white pr-12 pl-4 text-base outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-950"
          />
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? 'Hide password' : 'Show password'}
            className="absolute top-1 right-1 flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {reveal ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <CircleAlert className="size-4 shrink-0" />
            {error}
          </p>
        )}

        <button type="submit" disabled={!password || busy} className={`${btn.primary} mt-6 h-12 w-full text-base`}>
          {busy ? <Spinner className="size-5" /> : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
