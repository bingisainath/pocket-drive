import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { scanCameraBackup } from './native';

/**
 * Triggers a camera-backup scan on launch and whenever the app returns to the foreground. The
 * native side is a no-op when backup is off, so this is safe to run unconditionally while signed in;
 * newly taken photos/videos get enqueued into the durable upload queue.
 */
export function CameraBackupWatcher() {
  const busy = useRef(false);

  useEffect(() => {
    const scan = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        await scanCameraBackup();
      } catch {
        // Permission revoked or offline — try again next foreground.
      } finally {
        busy.current = false;
      }
    };

    scan();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') scan();
    });
    return () => sub.remove();
  }, []);

  return null;
}
