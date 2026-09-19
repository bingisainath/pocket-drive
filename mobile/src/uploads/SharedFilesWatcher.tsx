import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import { plural } from '../shared/lib/format';
import { getSharedFiles } from './native';
import { uploads } from './store';

/**
 * Watches for files shared into the app from other apps (Android share sheet) and enqueues them.
 * The native side has already copied them to cache, so this just drains the buffer on launch and
 * whenever the app returns to the foreground. Rendered only while signed in (uploads need a token).
 * Shared files go to the drive's root; the user can move them afterwards.
 */
export function SharedFilesWatcher() {
  const busy = useRef(false);

  useEffect(() => {
    const drain = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const files = await getSharedFiles();
        if (files.length) {
          uploads.add('', files);
          Alert.alert('Uploading', `${plural(files.length, 'file')} added to Pocket Drive.`);
        }
      } catch {
        // Nothing shared, or the bridge isn't ready yet — ignore.
      } finally {
        busy.current = false;
      }
    };

    drain();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') drain();
    });
    return () => sub.remove();
  }, []);

  return null;
}
