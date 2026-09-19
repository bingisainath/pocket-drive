import { createMMKV } from 'react-native-mmkv';

/**
 * Fast synchronous key-value store (react-native-mmkv v4, a Nitro module). Holds small app state
 * (view prefs, the cached user) and the persisted TanStack Query cache (under its own key).
 * Everything here is wiped on sign-out / user change via {@link clearStorage}.
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
  /** JSON User — the last signed-in user, so a cold offline launch stays signed in. */
  lastUser: 'auth.lastUser',
  /** string — this device's FCM push token, kept so we can unregister it on sign-out. */
  pushToken: 'push.token',
} as const;

/** Remove everything in {@link storage} — used on sign-out and user change. */
export function clearStorage() {
  storage.clearAll();
}
