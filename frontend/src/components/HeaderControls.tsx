import { ArrowDownUp, EllipsisVertical, LayoutGrid, List, LogOut, RefreshCw, Search, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { SORTS, SORT_LABELS, type SortOrder } from '../lib/entries';
import { btn } from './ui';

export const VIEWS = ['grid', 'list'] as const;
export type View = (typeof VIEWS)[number];

export function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div role="search" className="relative min-w-0 flex-1 sm:max-w-xl">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onChange('')}
        placeholder="Search files"
        aria-label="Search all files"
        enterKeyHint="search"
        className="h-11 w-full rounded-full bg-slate-200/60 pr-10 pl-11 text-base outline-none transition placeholder:text-slate-500 focus:bg-white focus:ring-2 focus:ring-blue-500/40 sm:text-sm dark:bg-slate-800/80 dark:focus:bg-slate-900 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 hover:bg-slate-300/50 dark:hover:bg-slate-700"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function SortSelect({ value, onChange }: { value: SortOrder; onChange: (value: SortOrder) => void }) {
  return (
    <label className="relative flex h-10 shrink-0 items-center rounded-lg text-sm text-slate-600 transition hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800">
      <ArrowDownUp className="pointer-events-none absolute left-2.5 size-4" aria-hidden="true" />
      <span className="sr-only">Sort by</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortOrder)}
        className="h-full cursor-pointer appearance-none bg-transparent pr-3 pl-8 outline-none"
      >
        {SORTS.map((s) => (
          <option key={s} value={s}>
            {SORT_LABELS[s]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ViewToggle({ value, onChange }: { value: View; onChange: (value: View) => void }) {
  const option = (view: View, Icon: LucideIcon, label: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={value === view}
      onClick={() => onChange(view)}
      className={`flex size-9 items-center justify-center rounded-md transition ${
        value === view
          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
          : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
      }`}
    >
      <Icon className="size-4" />
    </button>
  );
  return (
    <div className="flex shrink-0 rounded-lg bg-slate-200/70 p-0.5 dark:bg-slate-800">
      {option('grid', LayoutGrid, 'Grid view')}
      {option('list', List, 'List view')}
    </div>
  );
}

export function Menu({ onRescan, onSignOut }: { onRescan: () => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item =
    'flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition hover:bg-slate-100 dark:hover:bg-slate-800';
  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        className={btn.icon}
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <EllipsisVertical className="size-5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-40 mt-1 w-60 animate-fade-in rounded-xl bg-white p-1.5 shadow-xl ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10"
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onRescan();
            }}
          >
            <RefreshCw className="size-4 text-slate-500" />
            <span>
              Sync with disk
              <span className="block text-xs text-slate-500">Pick up files added outside the app</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <LogOut className="size-4 text-slate-500" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
