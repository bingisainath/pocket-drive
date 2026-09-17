import NetInfo from '@react-native-community/netinfo';
import { onlineManager, QueryClient } from '@tanstack/react-query';

/**
 * Tell TanStack Query whether the device is online, from NetInfo. With this wired, queries made
 * while offline don't fail-and-retry forever; they wait and run when connectivity returns.
 */
onlineManager.setEventListener((setOnline) => {
  return NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected);
  });
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Serve cached data first and reconcile in the background — the drive is behind a ~0.5 s tunnel,
      // so a cached folder should paint instantly. Offline persistence is added in Phase 3.
      networkMode: 'offlineFirst',
      staleTime: 30_000,
      retry: 2,
    },
    mutations: {
      networkMode: 'offlineFirst',
    },
  },
});
