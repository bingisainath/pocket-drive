import { CloudUpload, FolderPlus, Plus, Upload, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type ApiError } from '../api';
import { useFolderPath } from '../hooks/useFolderPath';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useToasts } from '../hooks/useToasts';
import { useUploads } from '../hooks/useUploads';
import { SORTS, sortEntries, type SortOrder } from '../lib/entries';
import { plural } from '../lib/format';
import type { Entry, StorageInfo } from '../types';
import { Breadcrumbs } from './Breadcrumbs';
import { ActionSheet, ConfirmDelete, NewFolderDialog } from './Dialogs';
import { GridView, ListView } from './EntryViews';
import { Menu, SearchBox, SortSelect, VIEWS, ViewToggle, type View } from './HeaderControls';
import { PreviewModal } from './PreviewModal';
import { EmptyState, ErrorState, Skeleton } from './States';
import { StorageMeter } from './StorageMeter';
import { ToastStack } from './ToastStack';
import { UploadPanel } from './UploadPanel';
import { Logo, btn } from './ui';

export default function Drive({ onSignedOut }: { onSignedOut: () => void }) {
  const [folder, navigate] = useFolderPath();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Entry[] | null>(null);
  const [view, setView] = useLocalStorage<View>('drive.view', 'grid', VIEWS);
  const [sort, setSort] = useLocalStorage<SortOrder>('drive.sort', 'newest', SORTS);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [preview, setPreview] = useState<Entry | null>(null);
  const [actionsFor, setActionsFor] = useState<Entry | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const { toasts, toast, dismiss } = useToasts();
  const fileInput = useRef<HTMLInputElement>(null);
  const storageTimer = useRef<number | undefined>(undefined);

  const trimmed = query.trim();
  const searching = trimmed !== '';

  // --- Data ---

  const refreshStorage = useCallback((delay = 0) => {
    window.clearTimeout(storageTimer.current);
    storageTimer.current = window.setTimeout(() => {
      api.storage().then(setStorage, () => {});
    }, delay);
  }, []);

  useEffect(() => {
    refreshStorage();
  }, [refreshStorage]);

  useEffect(() => {
    let stale = false;
    setEntries(null);
    setLoadError(null);
    api.list(folder).then(
      (res) => {
        if (!stale) setEntries(res.entries);
      },
      (err: ApiError) => {
        if (stale) return;
        if (err.status === 404 && folder) {
          toast('That folder no longer exists', 'error');
          navigate('', { replace: true });
        } else {
          setLoadError(err.message);
        }
      },
    );
    return () => {
      stale = true;
    };
  }, [folder, reloadKey, navigate, toast]);

  useEffect(() => {
    if (!trimmed) {
      setResults(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      api.search(trimmed, ctrl.signal).then(
        (res) => setResults(res.entries),
        (err: Error) => err.name !== 'AbortError' && toast(err.message, 'error'),
      );
    }, 250);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [trimmed, toast]);

  const shown = useMemo(() => sortEntries((searching ? results : entries) ?? [], sort), [searching, results, entries, sort]);
  const files = useMemo(() => shown.filter((e) => !e.isDir), [shown]);

  // --- Uploads ---

  const uploads = useUploads((entry) => {
    if (entry.parentPath === folder) {
      setEntries((list) => (list && !list.some((e) => e.id === entry.id) ? [entry, ...list] : list));
    }
    refreshStorage(800);
  });
  const { items: uploadItems, add: addUploads, clearFinished } = uploads;
  const uploadsActive = uploadItems.some((i) => i.status === 'queued' || i.status === 'uploading');
  const uploadsFailed = uploadItems.some((i) => i.status === 'error');

  // Tuck the panel away a few seconds after everything finished cleanly.
  useEffect(() => {
    if (uploadsActive || uploadsFailed || !uploadItems.length) return;
    const timer = window.setTimeout(clearFinished, 5000);
    return () => window.clearTimeout(timer);
  }, [uploadsActive, uploadsFailed, uploadItems.length, clearFinished]);

  // Leaving the page would kill in-flight uploads.
  useEffect(() => {
    if (!uploadsActive) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploadsActive]);

  const startUpload = useCallback(
    (list: File[]) => {
      if (list.length) addUploads(list, folder, storage?.maxUploadBytes ?? Number.POSITIVE_INFINITY);
    },
    [addUploads, folder, storage],
  );
  const pickFiles = () => fileInput.current?.click();

  // Drag-and-drop anywhere on the page (desktop).
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes('Files'));
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const dropped: File[] = [];
      let folders = 0;
      for (const item of Array.from(e.dataTransfer!.items)) {
        if (item.kind !== 'file') continue;
        if (item.webkitGetAsEntry?.()?.isDirectory) {
          folders++;
          continue;
        }
        const file = item.getAsFile();
        if (file) dropped.push(file);
      }
      if (folders) toast(`Skipped ${plural(folders, 'folder')} — folder upload isn’t supported, drop the files instead`, 'error');
      startUpload(dropped);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [startUpload, toast]);

  // --- Preview (gets its own history entry so the phone's back button closes it) ---

  useEffect(() => {
    if (window.history.state?.preview) window.history.replaceState(null, '');
    const onPop = () => {
      if (!window.history.state?.preview) setPreview(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const open = useCallback(
    (entry: Entry) => {
      if (entry.isDir) {
        setQuery('');
        navigate(entry.path);
        return;
      }
      if (!window.history.state?.preview) window.history.pushState({ preview: true }, '');
      setPreview(entry);
    },
    [navigate],
  );

  const closePreview = useCallback(() => {
    if (window.history.state?.preview) window.history.back();
    else setPreview(null);
  }, []);

  // --- Actions ---

  const reveal = (entry: Entry) => {
    setQuery('');
    navigate(entry.parentPath);
  };

  async function removeEntry(entry: Entry) {
    try {
      await api.remove(entry.id);
    } catch (err) {
      toast((err as Error).message, 'error');
      setDeleting(null);
      return;
    }
    const gone = (e: Entry) => e.id === entry.id || (entry.isDir && e.path.startsWith(`${entry.path}/`));
    setEntries((list) => list && list.filter((e) => !gone(e)));
    setResults((list) => list && list.filter((e) => !gone(e)));
    if (preview && gone(preview)) {
      // Deleting from the previewer moves on to the next file, for quick photo culling.
      const i = files.findIndex((e) => e.id === preview.id);
      const neighbor = files[i + 1] ?? files[i - 1];
      if (neighbor) setPreview(neighbor);
      else closePreview();
    }
    setDeleting(null);
    toast(`Deleted “${entry.name}”`, 'success');
    refreshStorage();
  }

  async function createFolder(name: string) {
    const entry = await api.createFolder(folder, name);
    setEntries((list) => list && [entry, ...list]);
    toast(`Created “${entry.name}”`, 'success');
  }

  async function rescan() {
    try {
      const r = await api.rescan();
      toast(r.added + r.updated + r.removed ? `Synced: ${r.added} added, ${r.updated} changed, ${r.removed} removed` : 'Already in sync with disk', 'success');
      setReloadKey((k) => k + 1);
      refreshStorage();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function signOut() {
    await api.logout().catch(() => {});
    onSignedOut();
  }

  // --- Render ---

  let content: ReactNode;
  if (!searching && loadError) content = <ErrorState message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />;
  else if (searching ? results === null : entries === null) content = <Skeleton view={view} />;
  else if (!shown.length) content = <EmptyState query={searching ? trimmed : null} onUpload={pickFiles} />;
  else {
    const viewProps = { entries: shown, showLocation: searching, onOpen: open, onActions: setActionsFor };
    content = view === 'grid' ? <GridView {...viewProps} /> : <ListView {...viewProps} />;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-slate-50/85 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/85">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 pt-2 sm:gap-3 sm:px-6">
          <button
            type="button"
            onClick={() => {
              setQuery('');
              navigate('');
            }}
            aria-label="My Drive"
            className="flex shrink-0 items-center gap-2 rounded-xl p-1 transition hover:bg-slate-200/60 dark:hover:bg-slate-800"
          >
            <Logo className="size-9" />
            <span className="hidden pr-1 text-lg font-semibold tracking-tight md:inline">Drive</span>
          </button>
          <SearchBox value={query} onChange={setQuery} />
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <button type="button" className={btn.secondary} onClick={() => setCreatingFolder(true)} aria-label="New folder">
              <FolderPlus className="size-5" />
              <span className="hidden lg:inline">New folder</span>
            </button>
            <button type="button" className={btn.primary} onClick={pickFiles}>
              <Upload className="size-5" />
              Upload
            </button>
          </div>
          <Menu onRescan={rescan} onSignOut={signOut} />
        </div>
        <div className="mx-auto flex max-w-7xl items-center gap-1 px-3 py-2 sm:px-6">
          {searching ? (
            <p className="min-w-0 flex-1 truncate px-2 text-sm text-slate-500 dark:text-slate-400">
              {results === null ? 'Searching…' : `${plural(results.length, 'result')} for “${trimmed}”`}
            </p>
          ) : (
            <Breadcrumbs path={folder} onNavigate={navigate} />
          )}
          <SortSelect value={sort} onChange={setSort} />
          <ViewToggle value={view} onChange={setView} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-3 pt-4 pb-40 sm:px-6">
        <StorageMeter info={storage} className="mb-5 sm:max-w-sm" />
        {content}
      </main>

      {/* Bottom-right stack: floating action button (phones) above the upload progress panel. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-end gap-3 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
        <div className="pointer-events-auto relative sm:hidden">
          {fabOpen && (
            <>
              <div className="fixed inset-0 animate-fade-in bg-slate-950/20" onClick={() => setFabOpen(false)} />
              <div className="absolute right-0 bottom-20 flex animate-sheet-up flex-col items-end gap-3">
                <FabAction
                  icon={FolderPlus}
                  label="New folder"
                  onClick={() => {
                    setFabOpen(false);
                    setCreatingFolder(true);
                  }}
                />
                <FabAction
                  icon={Upload}
                  label="Upload files"
                  onClick={() => {
                    setFabOpen(false);
                    pickFiles();
                  }}
                />
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => setFabOpen((o) => !o)}
            aria-label={fabOpen ? 'Close menu' : 'Upload or create'}
            aria-expanded={fabOpen}
            className="relative flex size-16 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/30 transition active:scale-95"
          >
            <Plus className={`size-7 transition-transform duration-200 ${fabOpen ? 'rotate-45' : ''}`} />
          </button>
        </div>
        <UploadPanel items={uploadItems} onCancel={uploads.cancel} onRetry={uploads.retry} onClear={clearFinished} />
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          startUpload(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 m-3 flex items-center justify-center rounded-3xl border-2 border-dashed border-blue-500 bg-blue-500/10 backdrop-blur-sm">
          <div className="rounded-2xl bg-white px-8 py-5 text-center shadow-xl dark:bg-slate-900">
            <CloudUpload className="mx-auto size-10 text-blue-600" />
            <p className="mt-2 font-medium">Drop to upload</p>
            <p className="text-sm text-slate-500">to {folder ? folder.split('/').pop() : 'My Drive'}</p>
          </div>
        </div>
      )}

      {preview && (
        <PreviewModal entry={preview} siblings={files} onClose={closePreview} onNavigate={setPreview} onDelete={setDeleting} />
      )}
      {actionsFor && (
        <ActionSheet
          entry={actionsFor}
          showLocation={searching}
          onClose={() => setActionsFor(null)}
          onOpen={open}
          onReveal={reveal}
          onDelete={setDeleting}
        />
      )}
      {deleting && <ConfirmDelete entry={deleting} onCancel={() => setDeleting(null)} onConfirm={() => removeEntry(deleting)} />}
      {creatingFolder && <NewFolderDialog onClose={() => setCreatingFolder(false)} onCreate={createFolder} />}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function FabAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-3">
      <span className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white shadow-lg dark:bg-white dark:text-slate-900">
        {label}
      </span>
      <span className="flex size-12 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-lg dark:bg-slate-800 dark:text-blue-400">
        <Icon className="size-5" />
      </span>
    </button>
  );
}
