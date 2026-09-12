import { LoaderCircle } from 'lucide-react';

const base =
  'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50';

export const btn = {
  primary: `${base} bg-blue-600 text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700`,
  secondary: `${base} bg-slate-200/70 text-slate-900 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700`,
  danger: `${base} bg-red-600 text-white hover:bg-red-700`,
  icon: 'inline-flex size-11 shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-200/70 active:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800 dark:active:bg-slate-700',
};

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
