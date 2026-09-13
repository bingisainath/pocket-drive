import { CircleAlert, Eye, EyeOff, KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError, api, googleSignInUrl } from '../api';
import type { Me } from '../types';
import { GoogleLogo, Logo, Spinner, btn } from './ui';

const LOGIN_ERRORS: Record<string, string> = {
  not_invited: 'This Google account doesn’t have access. Ask the owner to share a folder with this email.',
  account_mismatch: 'This email is already linked to a different Google account.',
  unverified: 'Your Google account’s email address isn’t verified.',
  cancelled: 'Sign-in was cancelled.',
  expired: 'Sign-in took too long or was interrupted. Please try again.',
  failed: 'Google sign-in didn’t work. Please try again.',
};

/** A failed Google sign-in comes back as /?login_error=…; read it once and tidy the URL. */
function takeLoginError(): string {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('login_error');
  if (!code) return '';
  params.delete('login_error');
  const query = params.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  return LOGIN_ERRORS[code] ?? LOGIN_ERRORS.failed;
}
const initialError = takeLoginError(); // at page load, before anything else touches the URL

export default function Login({ google, onSuccess }: { google: Me['google']; onSuccess: () => void }) {
  const googleHere = google.enabled && google.origins.includes(window.location.origin);
  const [showPassword, setShowPassword] = useState(!googleHere);
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState(initialError);
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

  const returnTo = `${window.location.pathname}${window.location.search}`;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-xl ring-1 shadow-slate-900/5 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="size-14" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Drive</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {googleHere ? 'Sign in with the Google account the owner shared with' : 'Enter the owner password to continue'}
          </p>
        </div>

        {googleHere && (
          <a
            href={googleSignInUrl(returnTo)}
            className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white text-base font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 active:scale-[0.98] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <GoogleLogo />
            Continue with Google
          </a>
        )}
        {!googleHere && google.enabled && google.origins[0] && (
          <p className="mb-5 rounded-xl bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-500/10 dark:text-blue-200">
            Google sign-in works at{' '}
            <a className="font-medium underline" href={google.origins[0]}>
              {google.origins[0].replace(/^https?:\/\//, '')}
            </a>
            .
          </p>
        )}

        {error && (
          <p role="alert" className="mt-4 flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}

        {googleHere && !showPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(true)}
            className="mx-auto mt-6 flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            <KeyRound className="size-4" />
            Owner? Use your password
          </button>
        )}

        {showPassword && (
          <form onSubmit={submit} className={googleHere ? 'mt-6 border-t border-slate-100 pt-6 dark:border-slate-800' : ''}>
            {/* Lets password managers file the saved password under a stable "username". */}
            <input type="text" name="username" autoComplete="username" value="drive-owner" readOnly hidden />
            <label htmlFor="password" className="sr-only">
              Owner password
            </label>
            <div className="relative">
              <input
                id="password"
                type={reveal ? 'text' : 'password'}
                autoComplete="current-password"
                autoFocus
                placeholder="Owner password"
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
            <button type="submit" disabled={!password || busy} className={`${btn.primary} mt-4 h-12 w-full text-base`}>
              {busy ? <Spinner className="size-5" /> : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
