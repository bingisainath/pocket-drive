import { getApp } from '@react-native-firebase/app';
import {
  deleteToken,
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import notifee, { AndroidImportance, EventType } from '@notifee/react-native';
import { api } from '../api/drive';
import { storage, StorageKey } from '../lib/storage';
import { navigateToFolder } from '../navigation/ref';

/**
 * Push notifications (Firebase Cloud Messaging + Notifee).
 *
 * The backend sends two kinds of message, each with data `{ type, path }`:
 *   - type 'share' on the "sharing" channel — a folder was shared with you
 *   - type 'files' on the "activity" channel — new files landed in a shared folder
 *
 * FCM auto-shows notifications while the app is backgrounded/killed (the payload carries a
 * `notification`); we only display them ourselves while the app is in the foreground. Tapping any
 * of them opens the folder at `path`.
 */

const messaging = () => getMessaging(getApp());

/** The library's RemoteMessage type, derived from onMessage so we don't depend on a named export. */
type RemoteMessage = Parameters<Parameters<typeof onMessage>[1]>[0];

interface PushData {
  type?: string;
  path?: string;
}

const channelFor = (type?: string) => (type === 'share' ? 'sharing' : 'activity');

/** Recreate our channels (idempotent). Must exist before FCM can post to them by id. */
async function ensureChannels() {
  await notifee.createChannel({ id: 'sharing', name: 'Sharing', importance: AndroidImportance.HIGH });
  await notifee.createChannel({ id: 'activity', name: 'New files', importance: AndroidImportance.DEFAULT });
}

/** Navigate to the folder a notification refers to. */
function openFrom(data?: PushData) {
  if (!data || (data.type !== 'share' && data.type !== 'files')) return;
  const path = data.path ?? '';
  const title = path.split('/').pop() || 'Pocket Drive';
  navigateToFolder(path, title);
}

/** Foreground messages don't show automatically — display one via Notifee. */
async function displayForeground(message: RemoteMessage) {
  const note = message.notification;
  if (!note) return;
  const data = message.data as PushData | undefined;
  await notifee.displayNotification({
    title: note.title,
    body: note.body,
    data: message.data,
    android: {
      channelId: note.android?.channelId ?? channelFor(data?.type),
      smallIcon: 'ic_launcher',
      pressAction: { id: 'default' },
    },
  });
}

/**
 * One-time setup: channels, notification permission, and the message/tap handlers. Returns an
 * unsubscribe function. Safe to call regardless of auth (taps must work before/after sign-in).
 */
export async function configurePush(): Promise<() => void> {
  await ensureChannels();
  await requestPermission(messaging()); // prompts for POST_NOTIFICATIONS on Android 13+

  const unsubMessage = onMessage(messaging(), displayForeground);
  const unsubOpened = onNotificationOpenedApp(messaging(), (m) => openFrom(m.data as PushData));
  const unsubForeground = notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS) openFrom(detail.notification?.data as PushData);
  });

  // Launched by tapping a notification while the app was killed.
  const initialFcm = await getInitialNotification(messaging());
  if (initialFcm) openFrom(initialFcm.data as PushData);
  const initialNotifee = await notifee.getInitialNotification();
  if (initialNotifee) openFrom(initialNotifee.notification.data as PushData);

  return () => {
    unsubMessage();
    unsubOpened();
    unsubForeground();
  };
}

/**
 * Register this device's FCM token with the backend and keep it fresh. Call while signed in.
 * Returns an unsubscribe for the token-refresh listener.
 */
export async function registerDeviceToken(): Promise<() => void> {
  const send = async (token: string) => {
    try {
      await api.registerDevice(token);
      storage.set(StorageKey.pushToken, token);
    } catch {
      // Offline or backend hiccup — the refresh listener / next launch will retry.
    }
  };
  try {
    await send(await getToken(messaging()));
  } catch {
    // No token yet (e.g. Play services unavailable) — nothing to register.
  }
  return onTokenRefresh(messaging(), send);
}

/** Remove this device's token from the backend on sign-out. Call before the auth token is cleared. */
export async function unregisterDeviceToken() {
  const token = storage.getString(StorageKey.pushToken) ?? (await getToken(messaging()).catch(() => null));
  if (token) await api.unregisterDevice(token).catch(() => {});
  storage.remove(StorageKey.pushToken);
  await deleteToken(messaging()).catch(() => {});
}
