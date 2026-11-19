import notifee, { AuthorizationStatus } from '@notifee/react-native';
import { BellRing } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, StyleSheet, View } from 'react-native';
import { AppText, Button, Sheet } from '../components/ui';
import { storage, StorageKey } from '../lib/storage';
import { useTheme } from '../theme';

/** After "Not now", don't ask again for this long. */
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
/** Let the first screen settle before asking. */
const SHOW_DELAY_MS = 1200;

async function notificationsAllowed(): Promise<boolean> {
  const settings = await notifee.getNotificationSettings();
  return settings.authorizationStatus === AuthorizationStatus.AUTHORIZED;
}

const snoozed = () => Date.now() - (storage.getNumber(StorageKey.notificationPromptSnoozedAt) ?? 0) < SNOOZE_MS;

/**
 * Asks for notifications in the app's own words before Android's system dialog, so people know
 * what they're agreeing to (shares and new files in shared folders). Shown on opening the app while
 * notifications are off, at most once a week after "Not now". If Android will no longer show its
 * dialog (denied before), "Turn on" opens the app's notification settings instead.
 * Rendered only while signed in.
 */
export function NotificationPrompt() {
  const { colors, space } = useTheme();
  const [visible, setVisible] = useState(false);

  const check = useCallback(async () => {
    try {
      const allowed = await notificationsAllowed();
      if (allowed) setVisible(false);
      return allowed;
    } catch {
      return true; // can't tell: don't nag
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!snoozed() && !(await check())) setVisible(true);
    }, SHOW_DELAY_MS);
    // Coming back from Settings with notifications turned on closes the prompt by itself.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') check();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [check]);

  const notNow = () => {
    storage.set(StorageKey.notificationPromptSnoozedAt, Date.now());
    setVisible(false);
  };

  const turnOn = async () => {
    setVisible(false);
    try {
      if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        if (result === PermissionsAndroid.RESULTS.GRANTED) return;
        // Denied earlier, so Android won't ask again: the switch is in Settings now.
        if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) await notifee.openNotificationSettings();
        else storage.set(StorageKey.notificationPromptSnoozedAt, Date.now());
        return;
      }
      // Android 12 and below have no runtime prompt: notifications were switched off in Settings.
      await notifee.openNotificationSettings();
    } catch {
      // Nothing more we can do; the prompt will offer again next week.
    }
  };

  return (
    <Sheet visible={visible} onClose={notNow}>
      <View style={[styles.body, { gap: space[3], paddingBottom: space[2] }]}>
        <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
          <BellRing size={28} color={colors.primary} />
        </View>
        <AppText variant="subtitle" style={styles.center}>
          Turn on notifications?
        </AppText>
        <AppText tone="muted" style={styles.center}>
          Get told when someone shares a folder with you and when new files are added to folders shared with you.
        </AppText>
        <View style={[styles.buttons, { gap: space[2], marginTop: space[2] }]}>
          <Button label="Turn on notifications" onPress={turnOn} />
          <Button label="Not now" variant="ghost" onPress={notNow} />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center' },
  icon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  buttons: { alignSelf: 'stretch' },
});
