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

/**
 * The Web OAuth 2.0 client ID (from Google Cloud, the same one the backend verifies as the token
 * audience). Set this to enable "Continue with Google". Leave empty to hide the button.
 * e.g. '1234-abc.apps.googleusercontent.com'
 */
export const GOOGLE_WEB_CLIENT_ID = '497807800114-b9fe0b84r6ju9kft0jp11qokv4mo2400.apps.googleusercontent.com';
