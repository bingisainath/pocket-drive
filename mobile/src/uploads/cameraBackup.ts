import { PermissionsAndroid, Platform } from 'react-native';
import { ApiError } from '../api/client';
import { api } from '../api/drive';
import { setCameraBackup } from './native';

/** The drive folder new camera media is uploaded to. */
const FOLDER_NAME = 'Camera Backup';

/** Ask for the photo/video read permission appropriate to the OS version. */
async function requestMediaPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const perms =
    Number(Platform.Version) >= 33
      ? [PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES, PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO]
      : [PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE];
  const result = await PermissionsAndroid.requestMultiple(perms);
  return perms.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}

/** Create the backup folder (or find it if it already exists) and return its drive path. */
async function ensureFolder(): Promise<string> {
  try {
    const entry = await api.createFolder('', FOLDER_NAME);
    return entry.path;
  } catch (err) {
    if ((err as ApiError).status === 409) {
      const { entries } = await api.list('');
      const found = entries.find((e) => e.isDir && e.name === FOLDER_NAME);
      if (found) return found.path;
    }
    throw err;
  }
}

/**
 * Turn camera backup on: get the media permission, make sure the backup folder exists, then enable
 * it natively. Only media added from now on is uploaded (the native watermark is set to "now").
 * Throws if the permission is denied so the UI can revert the toggle.
 */
export async function enableCameraBackup(): Promise<void> {
  const granted = await requestMediaPermission();
  if (!granted) throw new Error('Allow photo & video access to back up your camera.');
  const folder = await ensureFolder();
  setCameraBackup(true, folder);
}

export function disableCameraBackup() {
  setCameraBackup(false, '');
}
