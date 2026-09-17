import { createMMKV } from 'react-native-mmkv';

/**
 * Fast synchronous key-value store (react-native-mmkv v4, a Nitro module). Holds small app state:
 * settings and per-user view preferences. Server data lives in TanStack Query, not here.
 * The TanStack Query offline cache (Phase 3) will use a separate MMKV instance.
 */
export const storage = createMMKV({ id: 'pocket-drive' });

/** Keys used in {@link storage}. Centralised so they never collide or drift. */
export const StorageKey = {
  /** 'grid' | 'list' — how the file browser lays out entries. */
  viewMode: 'pref.viewMode',
  /** SortOrder — the chosen sort for listings. */
  sortOrder: 'pref.sortOrder',
  /** boolean — allow manual uploads on mobile data (Phase 4). */
  uploadOnMobileData: 'pref.uploadOnMobileData',
} as const;

/** Remove everything in {@link storage} — used on sign-out and user change. */
export function clearStorage() {
  storage.clearAll();
}
