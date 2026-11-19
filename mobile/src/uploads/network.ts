import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useSyncExternalStore } from 'react';
import { getWifiOnly, setWifiOnly as setNativeWifiOnly } from './native';

// The "Upload on Wi-Fi only" preference (owned by native, mirrored here so every screen agrees)
// and whether the current connection lets uploads run.

let wifiOnly = true;
let net: NetInfoState | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
let wired = false;

function wire() {
  if (wired) return;
  wired = true;
  getWifiOnly()
    .then((value) => {
      wifiOnly = value;
      notify();
    })
    .catch(() => {});
  NetInfo.addEventListener((state) => {
    net = state;
    notify();
  });
}

function subscribe(listener: () => void) {
  wire();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Turn Wi-Fi-only uploads on or off; waiting uploads are rescheduled with the new policy. */
export function setWifiOnly(value: boolean) {
  wifiOnly = value;
  setNativeWifiOnly(value);
  notify();
}

export function useWifiOnly(): boolean {
  return useSyncExternalStore(subscribe, () => wifiOnly);
}

/** Why uploads can't run right now, or null when they can. */
export type UploadBlocker = 'offline' | 'wifi' | null;

export function useUploadBlocker(): UploadBlocker {
  return useSyncExternalStore(subscribe, () => {
    if (!net) return null;
    if (net.isConnected === false) return 'offline';
    // Metered = mobile data (or a hotspot): Android holds Wi-Fi-only uploads until that changes.
    if (wifiOnly && net.details && 'isConnectionExpensive' in net.details && net.details.isConnectionExpensive) return 'wifi';
    return null;
  });
}
