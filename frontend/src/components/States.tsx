import { CircleAlert, CloudUpload, SearchX, Upload } from 'lucide-react';
import type { View } from './HeaderControls';
import { btn } from './ui';

export function Skeleton({ view }: { view: View }) {
  const pulse = 'animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-800/70';
  if (view === 'list') {
    return (
      <div className="space-y-2" aria-label="Loading">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`h-16 ${pulse}`} />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" aria-label="Loading">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className={`aspect-[4/5] ${pulse}`} />
      ))}
    </div>
  );
}

export function EmptyState({ query, onUpload }: { query: string | null; onUpload: () => void }) {
  if (query) {
    return (
      <div className="flex flex-col items-center py-20 text-center">
        <SearchX className="size-12 text-slate-300 dark:text-slate-700" />
        <p className="mt-4 font-medium">No matches</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Nothing is named like “{query}”.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto mt-6 flex max-w-sm flex-col items-center rounded-3xl border-2 border-dashed border-slate-200 px-6 py-14 text-center dark:border-slate-800">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-500/10">
        <CloudUpload className="size-8 text-blue-600 dark:text-blue-400" />
      </div>
      <p className="mt-5 text-lg font-semibold">This folder is empty</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        <span className="sm:hidden">Tap + to upload photos and files.</span>
        <span className="hidden sm:inline">Drag files here, or use the Upload button.</span>
      </p>
      <button type="button" onClick={onUpload} className={`${btn.primary} mt-6`}>
        <Upload className="size-5" />
        Upload files
      </button>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <CircleAlert className="size-12 text-red-400" />
      <p className="mt-4 font-medium">Couldn’t load this folder</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{message}</p>
      <button type="button" onClick={onRetry} className={`${btn.secondary} mt-6`}>
        Try again
      </button>
    </div>
  );
}
