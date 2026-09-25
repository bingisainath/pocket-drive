import { Lock } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { AppText, Button } from '../components/ui';
import { useTheme } from '../theme';
import { authenticate, isAppLockEnabled } from './appLock';

/**
 * Requires the device's biometric/PIN unlock before the app can be used, when app lock is enabled.
 * Locks on cold launch and whenever the app is sent to the background, so returning to it prompts
 * again. Renders an opaque cover over everything while locked.
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const { colors, space } = useTheme();
  const [locked, setLocked] = useState(() => isAppLockEnabled());
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const prompting = useRef(false);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      if (await authenticate()) setLocked(false);
    } catch {
      // No prompt available (e.g. no foreground activity) — the Unlock button retries.
    } finally {
      prompting.current = false;
    }
  }, []);

  useEffect(() => {
    if (lockedRef.current) unlock();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && lockedRef.current) unlock();
      else if (next === 'background' && isAppLockEnabled()) setLocked(true);
    });
    return () => sub.remove();
  }, [unlock]);

  return (
    <View style={styles.root}>
      {children}
      {locked && (
        <View style={[styles.overlay, { backgroundColor: colors.background, gap: space[4] }]}>
          <Lock size={40} color={colors.primary} />
          <AppText variant="title">Pocket Drive</AppText>
          <AppText variant="caption" tone="muted">
            Locked — unlock to continue
          </AppText>
          <Button label="Unlock" onPress={unlock} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
