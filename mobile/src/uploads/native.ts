import { NativeEventEmitter, NativeModules } from 'react-native';
import { API_BASE_URL } from '../config';
import { currentToken } from '../lib/auth-token';

/** One row of the durable native queue, as returned by getQueue() on app start. */
export interface NativeQueueItem {
  id: string;
  uri: string;
  name: string;
  size: number;
  lastModified: number;
  folder: string;
  /** Native status: 'pending' | 'running' | 'done' | 'error' | 'cancelled'. */
  status: string;
  uploaded: number;
  error?: string;
}

/** A file another app shared into Pocket Drive, already copied to cache (see SharedImport.kt). */
export interface SharedFileItem {
  uri: string;
  name: string;
  size: number;
  lastModified: number;
}

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
  retry(id: string): void;
  remove(id: string): void;
  clearFinished(): void;
  getQueue(): Promise<NativeQueueItem[]>;
  getSharedFiles(): Promise<SharedFileItem[]>;
  getWifiOnly(): Promise<boolean>;
  setWifiOnly(value: boolean): void;
  getCameraBackup(): Promise<{ enabled: boolean; folder: string }>;
  setCameraBackup(enabled: boolean, folder: string): void;
  scanCameraBackup(baseUrl: string, token: string): Promise<number>;
  download(url: string, filename: string, mimeType: string, token: string): Promise<boolean>;
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

/** Requeue a failed/cancelled upload (native re-schedules the drainer). */
export function retryUpload(id: string) {
  Native.retry(id);
}

/** Drop a finished/cancelled row from the native queue. */
export function removeUpload(id: string) {
  Native.remove(id);
}

/** Clear all done/cancelled rows from the native queue. */
export function clearFinishedUploads() {
  Native.clearFinished();
}

/** Read the persisted queue (used to hydrate the panel on app start). */
export function getQueue(): Promise<NativeQueueItem[]> {
  return Native.getQueue();
}

/** Pull (and clear) any files shared into the app from other apps. */
export function getSharedFiles(): Promise<SharedFileItem[]> {
  return Native.getSharedFiles();
}

/** Background uploads network policy: true = Wi-Fi (unmetered) only. */
export function getWifiOnly(): Promise<boolean> {
  return Native.getWifiOnly();
}

export function setWifiOnly(value: boolean) {
  Native.setWifiOnly(value);
}

/** Camera backup on/off + the drive folder new media is uploaded to. */
export function getCameraBackup(): Promise<{ enabled: boolean; folder: string }> {
  return Native.getCameraBackup();
}

export function setCameraBackup(enabled: boolean, folder: string) {
  Native.setCameraBackup(enabled, folder);
}

/** Scan for new photos/videos and enqueue them; resolves with the number queued. */
export function scanCameraBackup(): Promise<number> {
  return Native.scanCameraBackup(API_BASE_URL, currentToken() ?? '');
}

/** Download a file to the device's Downloads folder (DownloadManager, with the Bearer token). */
export function downloadFile(url: string, filename: string, mimeType: string | null): Promise<boolean> {
  return Native.download(url, filename, mimeType ?? '', currentToken() ?? '');
}

/** Subscribe to progress/done/error/cancelled events; returns an unsubscribe function. */
export function onUploadEvent(listener: (event: UploadEvent) => void): () => void {
  const sub = emitter.addListener('PocketDriveUpload', (event) => listener(event as UploadEvent));
  return () => sub.remove();
}
