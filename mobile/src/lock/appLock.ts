import { createMMKV } from 'react-native-mmkv';
import { NativeModules } from 'react-native';

/** The native biometric/device-credential prompt (Kotlin). */
const Native = NativeModules.PocketDriveAppLock as {
  canAuthenticate(): Promise<boolean>;
  authenticate(title: string, subtitle: string): Promise<boolean>;
};

/**
 * App-lock preference lives in its own store, NOT the main one that's wiped on sign-out — the lock
 * is a device setting and should persist across sign-ins.
 */
const deviceStore = createMMKV({ id: 'pocket-drive-device' });
const KEY_ENABLED = 'appLock.enabled';

export function isAppLockEnabled(): boolean {
  return deviceStore.getBoolean(KEY_ENABLED) ?? false;
}

export function setAppLockEnabled(value: boolean) {
  deviceStore.set(KEY_ENABLED, value);
}

/** True when the device has a biometric or PIN/pattern/password set up. */
export function canAuthenticate(): Promise<boolean> {
  return Native.canAuthenticate();
}

/** Show the system unlock prompt; resolves true when the user authenticates. */
export function authenticate(): Promise<boolean> {
  return Native.authenticate('Unlock Pocket Drive', 'Confirm it’s you to continue');
}
