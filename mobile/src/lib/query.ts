import NetInfo from '@react-native-community/netinfo';
import { defaultShouldDehydrateQuery, onlineManager, QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import { APP_VERSION } from '../config';
import { storage } from './storage';

/**
 * Tell TanStack Query whether the device is online, from NetInfo. With this wired, queries made
 * while offline don't fail-and-retry forever; they wait and run when connectivity returns.
 */
onlineManager.setEventListener((setOnline) => {
  return NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected);
  });
});

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Serve cached data first and reconcile in the background — the drive is behind a ~0.5 s tunnel,
      // so a cached folder paints instantly.
      networkMode: 'offlineFirst',
      staleTime: 30_000,
      // Keep cached data at least as long as we persist it, so restored queries aren't dropped.
      gcTime: WEEK_MS,
      retry: 2,
    },
    mutations: {
      networkMode: 'offlineFirst',
    },
  },
});

// Persist the query cache to MMKV (synchronous) so folders show instantly and work offline.
const persister = createSyncStoragePersister({
  key: 'pd-query-cache',
  storage: {
    getItem: (key) => storage.getString(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.remove(key),
  },
});

// Only persist what's safe and useful offline: the current user, folder listings and the storage meter.
const PERSISTED_KEYS = new Set(['me', 'list', 'storage']);

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  maxAge: WEEK_MS,
  buster: APP_VERSION, // drop the whole cache when the app version changes
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => defaultShouldDehydrateQuery(query) && PERSISTED_KEYS.has(query.queryKey[0] as string),
  },
};
