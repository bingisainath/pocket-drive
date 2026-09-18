import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/drive';
import { sortEntries, type SortOrder } from '../shared/lib/entries';
import type { Entry, FolderAccess } from '../shared/types';

interface FolderState {
  entries: Entry[];
  access: FolderAccess | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}

/** Loads one folder's listing, sorted (folders first), with pull-to-refresh support. */
export function useFolder(path: string, order: SortOrder = 'newest') {
  const [state, setState] = useState<FolderState>({ entries: [], access: null, loading: true, refreshing: false, error: null });
  const current = useRef<AbortController | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      current.current?.abort();
      const ctrl = new AbortController();
      current.current = ctrl;
      setState((s) => ({ ...s, loading: mode === 'initial', refreshing: mode === 'refresh', error: null }));
      try {
        const { entries, access } = await api.list(path, ctrl.signal);
        if (!ctrl.signal.aborted) {
          setState({ entries: sortEntries(entries, order), access, loading: false, refreshing: false, error: null });
        }
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setState((s) => ({ ...s, loading: false, refreshing: false, error: (err as Error).message }));
      }
    },
    [path, order],
  );

  useEffect(() => {
    load('initial');
    return () => current.current?.abort();
  }, [load]);

  return { ...state, refresh: () => load('refresh') };
}
