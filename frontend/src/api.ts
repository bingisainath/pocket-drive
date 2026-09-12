import type { Entry, StorageInfo } from './types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class UploadCancelled extends Error {}

let unauthorizedHandler = () => {};
/** Called whenever the server says the session is gone (expired, signed out elsewhere, password changed). */
export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

async function request<T>(
  method: string,
  url: string,
  { body, signal }: { body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'Can’t reach the server');
  }
  if (res.status === 401 && !url.startsWith('/api/auth/')) unauthorizedHandler();
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error ?? `Request failed (HTTP ${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const enc = encodeURIComponent;

export const api = {
  me: () => request<{ authenticated: boolean }>('GET', '/api/auth/me'),
  login: (password: string) => request<void>('POST', '/api/auth/login', { body: { password } }),
  logout: () => request<void>('POST', '/api/auth/logout'),
  list: (path: string) => request<{ path: string; entries: Entry[] }>('GET', `/api/list?path=${enc(path)}`),
  search: (text: string, signal?: AbortSignal) =>
    request<{ entries: Entry[] }>('GET', `/api/search?q=${enc(text)}`, { signal }),
  createFolder: (parentPath: string, name: string) =>
    request<Entry>('POST', '/api/folders', { body: { parentPath, name } }),
  remove: (id: number) => request<{ deleted: number }>('DELETE', `/api/entries/${id}`),
  storage: () => request<StorageInfo>('GET', '/api/storage'),
  rescan: () => request<{ added: number; updated: number; removed: number }>('POST', '/api/rescan'),
};

export const urls = {
  raw: (e: Entry) => `/api/files/${e.id}/raw`,
  download: (e: Entry) => `/api/files/${e.id}/download`,
  thumb: (e: Entry) => `/api/files/${e.id}/thumb`,
};

/** Upload one file with progress (fetch can't report upload progress, XHR can). */
export function uploadFile(file: File, folder: string, onProgress: (loaded: number) => void) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<Entry>((resolve, reject) => {
    xhr.open('POST', `/api/upload?path=${enc(folder)}`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status === 401) unauthorizedHandler();
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response.files[0]);
      else reject(new ApiError(xhr.status, xhr.response?.error ?? `Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Connection lost during upload'));
    xhr.onabort = () => reject(new UploadCancelled('Cancelled'));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}
