import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';

const base =
  'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50';

export const btn = {
  primary: `${base} bg-blue-600 text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700`,
  secondary: `${base} bg-slate-200/70 text-slate-900 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700`,
  danger: `${base} bg-red-600 text-white hover:bg-red-700`,
  icon: 'inline-flex size-11 shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-200/70 active:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800 dark:active:bg-slate-700',
};

export const inputClass =
  'h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-base outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 sm:text-sm dark:border-slate-700 dark:bg-slate-950';

export function Spinner({ className = 'size-6' }: { className?: string }) {
  return <LoaderCircle className={`animate-spin ${className}`} aria-label="Loading" />;
}

export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="16" className="fill-blue-600" />
      <path d="M20 44h25a9 9 0 0 0 1.5-17.9A13 13 0 0 0 21.3 29 7.5 7.5 0 0 0 20 44z" fill="#fff" />
    </svg>
  );
}

const AVATAR_COLORS = ['bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500', 'bg-teal-500', 'bg-sky-500', 'bg-indigo-500', 'bg-fuchsia-500'];

/** Google profile photo when there is one, otherwise a colored initial. */
export function Avatar({
  email,
  name,
  picture,
  className = 'size-9',
}: {
  email: string;
  name?: string | null;
  picture?: string | null;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (picture && !broken) {
    return (
      <img
        src={picture}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={`${className} shrink-0 rounded-full object-cover`}
      />
    );
  }
  let hash = 0;
  for (const c of email) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden="true"
      className={`${className} ${AVATAR_COLORS[hash % AVATAR_COLORS.length]} flex shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white`}
    >
      {(name || email).trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

export function GoogleLogo({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
