import { useSyncExternalStore } from 'react';
import { queryClient } from '../lib/query';
import {
  cancelUpload,
  clearFinishedUploads,
  enqueueUpload,
  getQueue,
  onUploadEvent,
  retryUpload,
  type NativeQueueItem,
  type UploadEvent,
} from './native';
import type { PickedFile } from './pick';

export type UploadStatus = 'queued' | 'uploading' | 'reconnecting' | 'done' | 'error' | 'cancelled';

export interface UploadTask extends PickedFile {
  id: string;
  folder: string;
  status: UploadStatus;
  uploaded: number;
  error?: string;
}

let tasks: UploadTask[] = [];
const listeners = new Set<() => void>();
let wired = false;

/** Map the native queue's status strings onto the JS status union. */
function toStatus(native: string): UploadStatus {
  switch (native) {
    case 'running':
      return 'uploading';
    case 'pending':
      return 'queued';
    case 'done':
    case 'error':
    case 'cancelled':
      return native;
    default:
      return 'queued';
  }
}

const fromNative = (row: NativeQueueItem): UploadTask => ({
  id: row.id,
  uri: row.uri,
  name: row.name,
  size: row.size,
  lastModified: row.lastModified,
  folder: row.folder,
  status: toStatus(row.status),
  uploaded: row.uploaded,
  error: row.error,
});

/** New array reference so useSyncExternalStore re-renders. */
function emit() {
  tasks = [...tasks];
  listeners.forEach((l) => l());
}

function patch(id: string, changes: Partial<UploadTask>) {
  const task = tasks.find((t) => t.id === id);
  if (task) Object.assign(task, changes);
  emit();
}

/**
 * Subscribe to native upload events and hydrate from the durable native queue. The native side
 * owns the queue, concurrency and scheduling (foreground and background); this store is a live
 * mirror for the UI. Runs once.
 */
function wire() {
  if (wired) return;
  wired = true;

  // Hydrate from anything already queued/uploading (e.g. a background upload started before launch).
  getQueue()
    .then((rows) => {
      const known = new Set(tasks.map((t) => t.id));
      const hydrated = rows.filter((r) => !known.has(r.id)).map(fromNative);
      if (hydrated.length) {
        tasks = [...tasks, ...hydrated];
        emit();
      }
    })
    .catch(() => {});

  onUploadEvent((e: UploadEvent) => {
    if (e.type === 'progress') return patch(e.id, { status: 'uploading', uploaded: e.uploaded });
    if (e.type === 'reconnecting') return patch(e.id, { status: e.reconnecting ? 'reconnecting' : 'uploading' });
    const task = tasks.find((t) => t.id === e.id);
    if (e.type === 'done') {
      patch(e.id, { status: 'done', uploaded: task?.size ?? 0 });
      if (task) {
        queryClient.invalidateQueries({ queryKey: ['list', task.folder] });
        queryClient.invalidateQueries({ queryKey: ['storage'] });
      }
    } else if (e.type === 'error') {
      patch(e.id, { status: 'error', error: e.message });
    } else if (e.type === 'cancelled') {
      patch(e.id, { status: 'cancelled' });
    }
  });
}

export const uploads = {
  add(folder: string, files: PickedFile[]) {
    wire();
    const stamp = Date.now();
    files.forEach((f, i) => {
      const task: UploadTask = {
        ...f,
        id: `${stamp}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        folder,
        status: 'queued',
        uploaded: 0,
      };
      tasks.push(task);
      enqueueUpload(task); // native persists it and (re)starts the background drainer
    });
    emit();
  },
  cancel(id: string) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    cancelUpload(id); // native emits 'cancelled' whether the file was in flight or still queued
  },
  retry(id: string) {
    retryUpload(id); // native requeues + reschedules
    patch(id, { status: 'queued', uploaded: 0, error: undefined });
  },
  clearFinished() {
    clearFinishedUploads();
    tasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
    emit();
  },
};

export function useUploads(): UploadTask[] {
  wire();
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => tasks,
  );
}
