import { ChevronDown, ChevronUp, CircleAlert, CircleCheck, RotateCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { UploadItem } from '../hooks/useUploads';
import { formatBytes, plural } from '../lib/format';
import { FileIcon } from './FileIcon';
import { Spinner } from './ui';

interface Props {
  items: UploadItem[];
  onCancel: (id: number) => void;
  onRetry: (id: number) => void;
  onClear: () => void;
}

export function UploadPanel({ items, onCancel, onRetry, onClear }: Props) {
  const [expanded, setExpanded] = useState(true);
  const active = items.filter((i) => i.status === 'queued' || i.status === 'uploading');
  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'error').length;
  const busy = active.length > 0;

  // Show the details while uploading (or when something failed, to retry). Once everything is
  // through, shrink to the summary line so the panel stops covering the photos just added.
  useEffect(() => {
    setExpanded(busy || failed > 0);
  }, [busy, failed]);

  if (!items.length) return null;
  const total = active.reduce((sum, i) => sum + i.file.size, 0);
  const loaded = active.reduce((sum, i) => sum + i.loaded, 0);
  const percent = total ? Math.round((loaded / total) * 100) : 0;

  const title = active.length
    ? `Uploading ${plural(active.length, 'file')} · ${percent}%`
    : failed
      ? `${done} uploaded, ${failed} failed`
      : `${plural(done, 'upload')} complete`;

  return (
    <section
      aria-label="Uploads"
      className="pointer-events-auto w-full animate-sheet-up overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 sm:w-96 dark:bg-slate-900 dark:ring-white/10"
    >
      <div className="flex items-center gap-2 py-1.5 pr-1.5 pl-4">
        {active.length ? (
          <Spinner className="size-5 text-blue-600" />
        ) : failed ? (
          <CircleAlert className="size-5 text-red-500" />
        ) : (
          <CircleCheck className="size-5 text-emerald-500" />
        )}
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{title}</p>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? 'Collapse uploads' : 'Expand uploads'}
          aria-expanded={expanded}
          className="flex size-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          {expanded ? <ChevronDown className="size-5" /> : <ChevronUp className="size-5" />}
        </button>
        {!active.length && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Dismiss uploads"
            className="flex size-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="size-5" />
          </button>
        )}
      </div>
      {active.length > 0 && (
        <div className="h-1 bg-slate-100 dark:bg-slate-800">
          <div className="h-full bg-blue-600 transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
      )}
      {expanded && (
        <ul className="max-h-[38dvh] overflow-y-auto overscroll-contain border-t border-slate-100 dark:border-slate-800">
          {items.map((item) => (
            <UploadRow key={item.id} item={item} onCancel={onCancel} onRetry={onRetry} />
          ))}
        </ul>
      )}
    </section>
  );
}

function UploadRow({ item, onCancel, onRetry }: { item: UploadItem; onCancel: (id: number) => void; onRetry: (id: number) => void }) {
  const { file, status, loaded } = item;
  const percent = file.size ? Math.min(100, Math.round((loaded / file.size) * 100)) : 0;
  const detail = {
    queued: 'Waiting…',
    uploading: `${percent}% · ${formatBytes(loaded)} of ${formatBytes(file.size)}`,
    done: `${formatBytes(file.size)} · Uploaded`,
    error: item.error ?? 'Failed',
    cancelled: 'Cancelled',
  }[status];
  const iconBtn = 'flex size-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800';

  return (
    <li className="flex items-center gap-3 py-2 pr-1.5 pl-4">
      <FileIcon entry={{ name: file.name, mime: file.type, isDir: false }} className="size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{file.name}</p>
        {status === 'uploading' && (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-blue-600 transition-[width] duration-300" style={{ width: `${percent}%` }} />
          </div>
        )}
        <p className={`mt-0.5 truncate text-xs ${status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
          {detail}
        </p>
      </div>
      {(status === 'queued' || status === 'uploading') && (
        <button type="button" onClick={() => onCancel(item.id)} aria-label={`Cancel ${file.name}`} className={iconBtn}>
          <X className="size-4" />
        </button>
      )}
      {(status === 'error' || status === 'cancelled') && item.retryable && (
        <button type="button" onClick={() => onRetry(item.id)} aria-label={`Retry ${file.name}`} className={iconBtn}>
          <RotateCw className="size-4" />
        </button>
      )}
      {status === 'done' && <CircleCheck className="mr-3 size-5 shrink-0 text-emerald-500" />}
    </li>
  );
}
