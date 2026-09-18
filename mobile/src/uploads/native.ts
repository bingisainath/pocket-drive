import { NativeEventEmitter, NativeModules } from 'react-native';
import { API_BASE_URL } from '../config';
import { currentToken } from '../lib/auth-token';

/** The native uploader module (Kotlin). Untyped over the bridge, wrapped with types here. */
const Native = NativeModules.PocketDriveUploader as {
  enqueue(
    id: string,
    uri: string,
    name: string,
    size: number,
    lastModified: number,
    folder: string,
    baseUrl: string,
    token: string,
  ): void;
  cancel(id: string): void;
  addListener(event: string): void;
  removeListeners(count: number): void;
};

export type UploadEvent =
  | { id: string; type: 'progress'; uploaded: number; total: number }
  | { id: string; type: 'reconnecting'; reconnecting: boolean }
  | { id: string; type: 'done'; file: string }
  | { id: string; type: 'error'; message: string }
  | { id: string; type: 'cancelled' };

export interface UploadItem {
  id: string;
  uri: string;
  name: string;
  size: number;
  lastModified: number;
  folder: string;
}

const emitter = new NativeEventEmitter(Native as unknown as never);

/** Start a resumable upload of one picked file, sending the current Bearer token. */
export function enqueueUpload(item: UploadItem) {
  Native.enqueue(item.id, item.uri, item.name, item.size, item.lastModified, item.folder, API_BASE_URL, currentToken() ?? '');
}

export function cancelUpload(id: string) {
  Native.cancel(id);
}

/** Subscribe to progress/done/error/cancelled events; returns an unsubscribe function. */
export function onUploadEvent(listener: (event: UploadEvent) => void): () => void {
  const sub = emitter.addListener('PocketDriveUpload', (event) => listener(event as UploadEvent));
  return () => sub.remove();
}
