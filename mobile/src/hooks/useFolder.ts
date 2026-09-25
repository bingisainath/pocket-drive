import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../api/drive';
import { sortEntries, type SortOrder } from '../shared/lib/entries';

/**
 * One folder's listing via TanStack Query (key ['list', path]), sorted folders-first.
 * Query owns caching, dedup and background refetch; Phase 3 adds offline persistence and the sort pref.
 */
export function useFolder(path: string, order: SortOrder = 'newest') {
  const query = useQuery({
    queryKey: ['list', path],
    queryFn: ({ signal }) => api.list(path, signal),
  });

  const entries = useMemo(() => (query.data ? sortEntries(query.data.entries, order) : []), [query.data, order]);

  return {
    entries,
    access: query.data?.access ?? null,
    loading: query.isPending,
    refreshing: query.isRefetching,
    error: query.isError ? (query.error as Error).message : null,
    refresh: async () => {
      await query.refetch();
    },
  };
}
