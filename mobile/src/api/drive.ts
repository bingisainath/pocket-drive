import { API_BASE_URL } from '../config';
import { authHeaders } from '../lib/auth-token';
import type { ActivityItem, Entry, FolderAccess, Me, Person, Role, Share, StorageInfo, User } from '../shared/types';
import { request } from './client';

export { authHeaders };

const enc = encodeURIComponent;

/** Typed calls to the drive API (see backend/src/routes). */
export const api = {
  health: () => request<{ status: string }>('GET', '/api/health'),
  me: () => request<Me>('GET', '/api/auth/me'),
  /** Owner password sign-in for the app: returns a Bearer token instead of setting a cookie. */
  tokenLogin: (password: string) =>
    request<{ token: string; user: User }>('POST', '/api/auth/token/password', { body: { password } }),
  /** Native Google sign-in: exchange a Google ID token for a Bearer token. */
  tokenGoogle: (idToken: string) =>
    request<{ token: string; user: User }>('POST', '/api/auth/token/google', { body: { idToken } }),
  logout: () => request<void>('POST', '/api/auth/logout'),
  /** Register this device's FCM token for push notifications. */
  registerDevice: (token: string) =>
    request<void>('POST', '/api/devices', { body: { token, platform: 'android' } }),
  /** Remove this device's FCM token (on sign-out or token rotation). */
  unregisterDevice: (token: string) => request<void>('DELETE', '/api/devices', { body: { token } }),
  /** Delete the signed-in (non-owner) account. */
  deleteAccount: () => request<{ deleted: boolean; message: string }>('DELETE', '/api/auth/account'),
  list: (path: string, signal?: AbortSignal) =>
    request<{ path: string; entries: Entry[]; access: FolderAccess }>('GET', `/api/list?path=${enc(path)}`, { signal }),
  search: (text: string, signal?: AbortSignal) =>
    request<{ entries: Entry[] }>('GET', `/api/search?q=${enc(text)}`, { signal }),
  createFolder: (parentPath: string, name: string) =>
    request<Entry>('POST', '/api/folders', { body: { parentPath, name } }),
  remove: (id: number) => request<{ deleted: number }>('DELETE', `/api/entries/${id}`),
  storage: () => request<StorageInfo>('GET', '/api/storage'),
  /** Owner-only: re-scan the storage folder for files added outside the app. */
  rescan: () => request<Record<string, number>>('POST', '/api/rescan'),

  // --- Owner-only admin ---
  /** Who a folder is shared with: `direct` shares on it, plus `inherited` shares from its ancestors. */
  shares: (path: string) =>
    request<{ path: string; direct: Share[]; inherited: Share[] }>('GET', `/api/admin/shares?path=${enc(path)}`),
  addShare: (path: string, email: string, role: Role) =>
    request<Share>('POST', '/api/admin/shares', { body: { path, email, role } }),
  removeShare: (id: number) => request<{ ok: boolean }>('DELETE', `/api/admin/shares/${id}`),
  users: () => request<{ users: Person[] }>('GET', '/api/admin/users'),
  removeUser: (id: number) => request<{ ok: boolean }>('DELETE', `/api/admin/users/${id}`),
  activity: (before?: number, limit = 50) =>
    request<{ items: ActivityItem[] }>('GET', `/api/admin/activity?limit=${limit}${before ? `&before=${before}` : ''}`),
};

/** Absolute URLs for file content. Pass {@link authHeaders} as request headers so these carry the token. */
export const urls = {
  raw: (e: Entry) => `${API_BASE_URL}/api/files/${e.id}/raw`,
  download: (e: Entry) => `${API_BASE_URL}/api/files/${e.id}/download`,
  thumb: (e: Entry) => `${API_BASE_URL}/api/files/${e.id}/thumb`,
  preview: (e: Entry) => `${API_BASE_URL}/api/files/${e.id}/preview`,
  /** Adaptive (HLS) streaming version of a video; 404 until the server has made it. */
  stream: (e: Entry) => `${API_BASE_URL}/api/files/${e.id}/stream/master.m3u8`,
};
