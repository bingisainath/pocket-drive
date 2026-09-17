/**
 * The drive's public address. The app always talks to it — even on the phone that hosts the drive —
 * so there is one network path to reason about and test.
 */
export const API_BASE_URL = 'https://drive.bingisainath.com';

/**
 * Busts the persisted offline cache when it changes. Bump this whenever the cached data shape
 * changes (or on an app release) so stale shapes are discarded rather than rehydrated.
 */
export const APP_VERSION = '1';
