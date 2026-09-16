import { useCallback, useEffect, useRef, useState } from 'react';
import { UploadCancelled, uploadFile } from '../api';
import { formatBytes } from '../lib/format';
import type { Entry } from '../types';

// The server stores a photo in ~0.1 s, so the sender's connection is the limit; four at a time
// cuts per-file connection overhead on big batches. Thumbnailing is queued separately on the server.
const MAX_PARALLEL = 4;
const PROGRESS_INTERVAL_MS = 150;

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';

export interface UploadItem {
  id: number;
  file: File;
  folder: string;
  loaded: number;
  status: UploadStatus;
  /** Waiting to reconnect after the connection dropped mid-upload. */
  reconnecting?: boolean;
  error?: string;
  retryable: boolean;
}

let nextId = 1;

/** Upload queue: each file sent in resumable chunks, a few files in parallel, with progress, cancel and retry. */
export function useUploads(onUploaded: (entry: Entry) => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const aborts = useRef(new Map<number, () => void>());
  const started = useRef(new Set<number>());
  const onUploadedRef = useRef(onUploaded);

  useEffect(() => {
    onUploadedRef.current = onUploaded;
  });

  const update = useCallback((id: number, patch: Partial<UploadItem>) => {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  useEffect(() => {
    let active = items.filter((i) => i.status === 'uploading').length;
    for (const item of items) {
      if (active >= MAX_PARALLEL) break;
      if (item.status !== 'queued' || started.current.has(item.id)) continue;
      started.current.add(item.id);
      active++;
      update(item.id, { status: 'uploading', loaded: 0, error: undefined });

      let lastPaint = 0;
      const { promise, abort } = uploadFile(item.file, item.folder, {
        onProgress: (loaded) => {
          const now = performance.now();
          if (now - lastPaint < PROGRESS_INTERVAL_MS) return;
          lastPaint = now;
          update(item.id, { loaded });
        },
        onReconnecting: (reconnecting) => update(item.id, { reconnecting }),
      });
      aborts.current.set(item.id, abort);
      promise
        .then(
          (entry) => {
            update(item.id, { status: 'done', loaded: item.file.size, reconnecting: false });
            onUploadedRef.current(entry);
          },
          (err: Error) => {
            update(
              item.id,
              err instanceof UploadCancelled
                ? { status: 'cancelled', reconnecting: false }
                : { status: 'error', error: err.message, reconnecting: false },
            );
          },
        )
        .finally(() => aborts.current.delete(item.id));
    }
  }, [items, update]);

  const add = useCallback((files: File[], folder: string, maxBytes: number) => {
    const added = files.map((file): UploadItem => {
      const tooBig = file.size > maxBytes;
      return {
        id: nextId++,
        file,
        folder,
        loaded: 0,
        status: tooBig ? 'error' : 'queued',
        error: tooBig ? `Larger than the ${formatBytes(maxBytes)} limit` : undefined,
        retryable: !tooBig,
      };
    });
    setItems((list) => [...list, ...added]);
  }, []);

  const cancel = useCallback(
    (id: number) => {
      const abort = aborts.current.get(id);
      if (abort) abort();
      else update(id, { status: 'cancelled' });
    },
    [update],
  );

  const retry = useCallback(
    (id: number) => {
      started.current.delete(id);
      update(id, { status: 'queued', loaded: 0, error: undefined });
    },
    [update],
  );

  const clearFinished = useCallback(() => {
    setItems((list) => list.filter((i) => i.status === 'queued' || i.status === 'uploading'));
  }, []);

  return { items, add, cancel, retry, clearFinished };
}
