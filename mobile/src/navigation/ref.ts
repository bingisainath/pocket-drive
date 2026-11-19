import { createNavigationContainerRef } from '@react-navigation/native';
import { useSyncExternalStore } from 'react';
import type { RootStackParamList } from './types';

/** App-wide navigation handle, so non-component code (push taps) can navigate. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Open a folder by its drive-relative path (used when a push notification is tapped). */
export function navigateToFolder(path: string, title: string) {
  if (!navigationRef.isReady()) return;
  // Nested: Root('Main') -> Tabs('Files') -> Stack('Folder'). Cast because Main carries no static params.
  const navigate = navigationRef.navigate as (name: string, params: object) => void;
  navigate('Main', { screen: 'Files', params: { screen: 'Folder', params: { path, title } } });
}

/** The focused screen's name, for UI that lives outside the navigator (e.g. the upload panel). */
export function useCurrentRouteName(): string | undefined {
  return useSyncExternalStore(
    (onChange) => navigationRef.addListener('state', onChange),
    () => (navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined),
  );
}
