import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/drive';
import type { Entry, FolderAccess } from '../shared/types';

type Listing = { path: string; entries: Entry[]; access: FolderAccess };

/** Deletes sent in parallel during a multi-delete. */
const BATCH = 4;

/** Create-folder and delete mutations for one folder, keeping the ['list', path] cache in step. */
export function useFolderActions(path: string) {
  const qc = useQueryClient();
  const key = ['list', path];

  const createFolder = useMutation({
    mutationFn: (name: string) => api.createFolder(path, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  // Optimistic delete: drop the row immediately, restore it if the server rejects.
  const remove = useMutation({
    mutationFn: (id: number) => api.remove(id),
    onMutate: async (id: number) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Listing>(key);
      if (previous) {
        qc.setQueryData<Listing>(key, { ...previous, entries: previous.entries.filter((e) => e.id !== id) });
      }
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  // Delete several entries (multi-select): drop them all at once, then delete a few at a time so a
  // big selection doesn't flood the server. Resolves with the entries that could not be deleted.
  const removeMany = useMutation({
    mutationFn: async (entries: Entry[]) => {
      const failed: { entry: Entry; message: string }[] = [];
      for (let i = 0; i < entries.length; i += BATCH) {
        const batch = entries.slice(i, i + BATCH);
        const results = await Promise.allSettled(batch.map((e) => api.remove(e.id)));
        results.forEach((r, j) => {
          if (r.status === 'rejected') failed.push({ entry: batch[j], message: (r.reason as Error).message });
        });
      }
      return failed;
    },
    onMutate: async (entries: Entry[]) => {
      await qc.cancelQueries({ queryKey: key });
      const ids = new Set(entries.map((e) => e.id));
      const previous = qc.getQueryData<Listing>(key);
      if (previous) {
        qc.setQueryData<Listing>(key, { ...previous, entries: previous.entries.filter((e) => !ids.has(e.id)) });
      }
      return { previous };
    },
    onError: (_err, _entries, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key }); // brings back anything that failed
      qc.invalidateQueries({ queryKey: ['storage'] });
    },
  });

  return { createFolder, remove, removeMany };
}
