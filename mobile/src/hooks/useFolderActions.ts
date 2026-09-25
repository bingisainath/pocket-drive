import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/drive';
import type { Entry, FolderAccess } from '../shared/types';

type Listing = { path: string; entries: Entry[]; access: FolderAccess };

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

  return { createFolder, remove };
}
