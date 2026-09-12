import { Download, Eye, FolderInput, FolderOpen, Trash2, type LucideIcon } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { urls } from '../api';
import { locationOf } from '../lib/entries';
import { formatBytes, formatDateTime, plural } from '../lib/format';
import type { Entry } from '../types';
import { Thumb } from './FileIcon';
import { Modal } from './Modal';
import { Spinner, btn } from './ui';

// --- Actions sheet (long-press / ⋮) ---

interface ActionSheetProps {
  entry: Entry;
  showLocation: boolean;
  onClose: () => void;
  onOpen: (entry: Entry) => void;
  onReveal: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
}

export function ActionSheet({ entry, showLocation, onClose, onOpen, onReveal, onDelete }: ActionSheetProps) {
  const then = (fn: (e: Entry) => void) => () => {
    onClose();
    fn(entry);
  };
  const meta = entry.isDir
    ? `Folder${entry.childCount === null ? '' : ` · ${plural(entry.childCount, 'item')}`}`
    : `${formatBytes(entry.size)} · ${formatDateTime(entry.createdAt)}`;

  return (
    <Modal label={entry.name} onClose={onClose}>
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
          <Thumb entry={entry} iconClassName="size-6" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium">{entry.name}</p>
          <p className="truncate text-sm text-slate-500 dark:text-slate-400">{meta}</p>
        </div>
      </div>
      <div className="p-2">
        <SheetButton icon={entry.isDir ? FolderOpen : Eye} onClick={then(onOpen)}>
          {entry.isDir ? 'Open folder' : 'Open'}
        </SheetButton>
        {!entry.isDir && (
          <SheetButton icon={Download} href={urls.download(entry)} onClick={onClose}>
            Download
          </SheetButton>
        )}
        {showLocation && (
          <SheetButton icon={FolderInput} onClick={then(onReveal)}>
            Show in {locationOf(entry)}
          </SheetButton>
        )}
        <SheetButton icon={Trash2} danger onClick={then(onDelete)}>
          Delete
        </SheetButton>
      </div>
    </Modal>
  );
}

function SheetButton({
  icon: Icon,
  danger,
  href,
  onClick,
  children,
}: {
  icon: LucideIcon;
  danger?: boolean;
  href?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const className = `flex h-13 w-full items-center gap-4 rounded-xl px-4 text-left text-[15px] transition active:scale-[0.99] ${
    danger ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
  }`;
  const content = (
    <>
      <Icon className={`size-5 ${danger ? '' : 'text-slate-500 dark:text-slate-400'}`} />
      <span className="truncate">{children}</span>
    </>
  );
  // A plain link: the server answers with Content-Disposition: attachment, so the page stays put.
  return href ? (
    <a href={href} download onClick={onClick} className={className}>
      {content}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

// --- Delete confirmation ---

export function ConfirmDelete({ entry, onCancel, onConfirm }: { entry: Entry; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const count = entry.childCount ?? 0;

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal label={`Delete ${entry.name}?`} onClose={busy ? () => {} : onCancel}>
      <div className="p-6">
        <div className="flex size-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-500/15">
          <Trash2 className="size-6 text-red-600 dark:text-red-400" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">Delete {entry.isDir ? 'folder' : 'file'}?</h2>
        <p className="mt-2 text-sm break-words text-slate-600 dark:text-slate-400">
          <span className="font-medium text-slate-900 dark:text-slate-100">{entry.name}</span>
          {entry.isDir
            ? count
              ? ` and everything inside it (${plural(count, 'item')}) will be permanently deleted.`
              : ' will be permanently deleted.'
            : ' will be permanently deleted.'}{' '}
          This can’t be undone.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={btn.secondary} onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </button>
          <button type="button" className={btn.danger} onClick={confirm} disabled={busy}>
            {busy ? <Spinner className="size-5" /> : <Trash2 className="size-4" />}
            Delete
          </button>
        </div>
      </div>
    </Modal>
  );
}

// --- New folder ---

export function NewFolderDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await onCreate(name.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal label="New folder" onClose={onClose}>
      <form onSubmit={submit} className="p-6">
        <h2 className="text-lg font-semibold">New folder</h2>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Folder name"
          aria-label="Folder name"
          maxLength={200}
          enterKeyHint="done"
          className="mt-4 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-950"
        />
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={btn.secondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btn.primary} disabled={!name.trim() || busy}>
            {busy && <Spinner className="size-5" />}
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}
