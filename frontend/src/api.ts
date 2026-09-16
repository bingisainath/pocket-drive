import type { ActivityItem, Entry, FolderAccess, Me, Person, Role, Share, StorageInfo } from './types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class UploadCancelled extends Error {}

let unauthorizedHandler = () => {};
/** Called whenever the server says the session is gone (expired, signed out elsewhere, access removed). */
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
  me: () => request<Me>('GET', '/api/auth/me'),
  login: (password: string) => request<void>('POST', '/api/auth/login', { body: { password } }),
  logout: () => request<void>('POST', '/api/auth/logout'),
  list: (path: string) =>
    request<{ path: string; entries: Entry[]; access: FolderAccess }>('GET', `/api/list?path=${enc(path)}`),
  search: (text: string, signal?: AbortSignal) =>
    request<{ entries: Entry[] }>('GET', `/api/search?q=${enc(text)}`, { signal }),
  createFolder: (parentPath: string, name: string) =>
    request<Entry>('POST', '/api/folders', { body: { parentPath, name } }),
  remove: (id: number) => request<{ deleted: number }>('DELETE', `/api/entries/${id}`),
  storage: () => request<StorageInfo>('GET', '/api/storage'),
  rescan: () => request<{ added: number; updated: number; removed: number }>('POST', '/api/rescan'),

  /** Owner only. */
  admin: {
    shares: (path: string) =>
      request<{ path: string; direct: Share[]; inherited: Share[] }>('GET', `/api/admin/shares?path=${enc(path)}`),
    share: (path: string, email: string, role: Role) =>
      request<Share>('POST', '/api/admin/shares', { body: { path, email, role } }),
    unshare: (id: number) => request<{ ok: true }>('DELETE', `/api/admin/shares/${id}`),
    people: () => request<{ users: Person[] }>('GET', '/api/admin/users'),
    removePerson: (id: number) => request<{ ok: true }>('DELETE', `/api/admin/users/${id}`),
    activity: (before?: number) =>
      request<{ items: ActivityItem[] }>('GET', `/api/admin/activity?limit=50${before ? `&before=${before}` : ''}`),
  },
};

export const urls = {
  raw: (e: Entry) => `/api/files/${e.id}/raw`,
  download: (e: Entry) => `/api/files/${e.id}/download`,
  thumb: (e: Entry) => `/api/files/${e.id}/thumb`,
  preview: (e: Entry) => `/api/files/${e.id}/preview`,
  /** Adaptive (HLS) streaming version of a video; 404 until the server has made it. */
  stream: (e: Entry) => `/api/files/${e.id}/stream/master.m3u8`,
};

/** Starts "Sign in with Google" from this address, coming back to `returnTo` afterwards. */
export const googleSignInUrl = (returnTo: string) =>
  `/api/auth/google/start?origin=${enc(window.location.origin)}&returnTo=${enc(returnTo)}`;

/** A link that opens a folder in the drive (people still need access to see it). */
export const folderLink = (path: string) => `${window.location.origin}/?p=${enc(path).replace(/%2F/g, '/')}`;

interface UploadSession {
  id: string;
  offset: number;
  chunkSize: number;
}

/** Statuses worth retrying: connection trouble (0), timeouts, rate limits and server hiccups. */
const RETRYABLE = new Set([0, 408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
const MAX_ATTEMPTS = 10; // consecutive failures before giving up (~5 minutes of backoff)

export interface UploadHandlers {
  onProgress: (loaded: number) => void;
  /** True while waiting to reconnect after a dropped connection. */
  onReconnecting?: (reconnecting: boolean) => void;
}

/**
 * Upload one file in chunks (each one request, below Cloudflare's 100 MB limit) with progress.
 * Dropped connections are retried with backoff, continuing from the last byte the server stored.
 * If the tab is closed, adding the same file again resumes it (the server matches name, size and
 * modification time); cancelling discards the partial upload.
 */
export function uploadFile(file: File, folder: string, { onProgress, onReconnecting = () => {} }: UploadHandlers) {
  let xhr: XMLHttpRequest | null = null;
  let session: UploadSession | null = null;
  let cancelled = false;
  let wake = () => {};

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  /** PUT one chunk; resolves to the server's reply ({ offset } or, for the last chunk, { offset, file }). */
  const sendChunk = (id: string, offset: number, chunk: Blob) =>
    new Promise<{ offset: number; file?: Entry }>((resolve, reject) => {
      const req = new XMLHttpRequest();
      xhr = req;
      req.open('PUT', `/api/uploads/${id}`);
      req.responseType = 'json';
      req.setRequestHeader('Content-Type', 'application/octet-stream');
      req.setRequestHeader('Upload-Offset', String(offset));
      req.upload.onprogress = (e) => onProgress(offset + e.loaded);
      req.onload = () => {
        if (req.status === 401) unauthorizedHandler();
        if (req.status >= 200 && req.status < 300) resolve(req.response);
        else {
          const err = new ApiError(req.status, req.response?.error ?? `Upload failed (HTTP ${req.status})`);
          reject(Object.assign(err, { offset: req.response?.offset }));
        }
      };
      req.onerror = () => reject(new ApiError(0, 'Connection lost during upload'));
      req.onabort = () => reject(new UploadCancelled('Cancelled'));
      req.send(chunk);
    });

  const start = () =>
    request<UploadSession>('POST', '/api/uploads', {
      body: { path: folder, name: file.name, size: file.size, lastModified: file.lastModified },
    });

  async function run(): Promise<Entry> {
    session = await start();
    let { offset } = session;
    if (cancelled) {
      await request('DELETE', `/api/uploads/${session.id}`).catch(() => {}); // cancelled before it began
      throw new UploadCancelled('Cancelled');
    }
    onProgress(offset);
    let failures = 0;
    for (;;) {
      if (cancelled) throw new UploadCancelled('Cancelled');
      try {
        const end = Math.min(offset + session.chunkSize, file.size);
        const reply = await sendChunk(session.id, offset, file.slice(offset, end));
        if (reply.file) return reply.file;
        offset = reply.offset;
        onProgress(offset);
        if (failures) onReconnecting(false);
        failures = 0;
      } catch (err) {
        if (cancelled || err instanceof UploadCancelled) throw new UploadCancelled('Cancelled');
        const status = err instanceof ApiError ? err.status : 0;
        const serverOffset = (err as { offset?: number }).offset;
        if (status === 409 && typeof serverOffset === 'number') {
          offset = serverOffset; // out of step with the server (e.g. a chunk half-arrived): continue from its offset
          if (++failures < MAX_ATTEMPTS) continue;
        }
        if (status === 404) {
          session = await start(); // expired or cleaned up on the server: start over
          offset = session.offset;
          if (++failures < MAX_ATTEMPTS) continue;
        }
        if (!RETRYABLE.has(status) || ++failures >= MAX_ATTEMPTS) {
          if (failures) onReconnecting(false);
          throw err;
        }
        onReconnecting(true);
        await sleep(Math.min(30_000, 1000 * 2 ** (failures - 1)));
        // Ask where the server got to: part of the failed chunk may have been stored.
        try {
          offset = (await request<{ offset: number }>('GET', `/api/uploads/${session.id}`)).offset;
          onProgress(offset);
        } catch {
          // still offline; the next attempt will find out
        }
      }
    }
  }

  const promise = run();
  const abort = () => {
    cancelled = true;
    xhr?.abort();
    wake();
    if (session) request('DELETE', `/api/uploads/${session.id}`).catch(() => {});
  };
  return { promise, abort };
}
