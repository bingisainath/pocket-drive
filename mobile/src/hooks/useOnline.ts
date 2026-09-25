import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/** Reactive online/offline state, from the same source (NetInfo → onlineManager) that gates queries. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
    () => true,
  );
}
