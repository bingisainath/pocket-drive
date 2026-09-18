import { useSyncExternalStore } from 'react';
import { queryClient } from '../lib/query';
import { cancelUpload, enqueueUpload, onUploadEvent, type UploadEvent } from './native';
import type { PickedFile } from './pick';

export type UploadStatus = 'queued' | 'uploading' | 'reconnecting' | 'done' | 'error' | 'cancelled';

export interface UploadTask extends PickedFile {
  id: string;
  folder: string;
  status: UploadStatus;
  uploaded: number;
  error?: string;
}

const MAX_ACTIVE = 4; // "up to 4 files at once"

let tasks: UploadTask[] = [];
const listeners = new Set<() => void>();
let wired = false;

const isActive = (s: UploadStatus) => s === 'uploading' || s === 'reconnecting';
const activeCount = () => tasks.filter((t) => isActive(t.status)).length;

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

/** Start queued tasks up to the concurrency limit. */
function pump() {
  for (const task of tasks) {
    if (activeCount() >= MAX_ACTIVE) break;
    if (task.status === 'queued') {
      task.status = 'uploading';
      enqueueUpload(task);
    }
  }
  emit();
}

function wire() {
  if (wired) return;
  wired = true;
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
    pump(); // a slot freed
  });
}

export const uploads = {
  add(folder: string, files: PickedFile[]) {
    wire();
    const stamp = Date.now();
    files.forEach((f, i) =>
      tasks.push({ ...f, id: `${stamp}-${i}-${Math.random().toString(36).slice(2, 8)}`, folder, status: 'queued', uploaded: 0 }),
    );
    pump();
  },
  cancel(id: string) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    if (isActive(task.status)) cancelUpload(id); // native emits 'cancelled'
    else patch(id, { status: 'cancelled' });
  },
  retry(id: string) {
    patch(id, { status: 'queued', uploaded: 0, error: undefined });
    pump();
  },
  clearFinished() {
    tasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
    emit();
  },
};

export function useUploads(): UploadTask[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => tasks,
  );
}
