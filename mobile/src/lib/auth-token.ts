import * as Keychain from 'react-native-keychain';

/**
 * The app's Bearer session token. Stored in the Android Keystore (react-native-keychain) and mirrored
 * in memory so requests, image loads and video can attach it synchronously without an async read each time.
 * The token is the same session token the backend issues to the web cookie — same expiry and revocation.
 */
const SERVICE = 'com.bingisainath.pocketdrive.session';

let cached: string | null = null;

/** The token to send right now, or null. Synchronous — safe to call per request. */
export const currentToken = (): string | null => cached;

/** Authorization header for API calls, image loads and video sources; empty when signed out. */
export const authHeaders = (): Record<string, string> => (cached ? { Authorization: `Bearer ${cached}` } : {});

/** Load the token from the Keystore into memory at startup. */
export async function loadToken(): Promise<string | null> {
  try {
    const creds = await Keychain.getGenericPassword({ service: SERVICE });
    cached = creds ? creds.password : null;
  } catch {
    cached = null;
  }
  return cached;
}

export async function saveToken(token: string): Promise<void> {
  cached = token;
  await Keychain.setGenericPassword('session', token, { service: SERVICE });
}

export async function clearToken(): Promise<void> {
  cached = null;
  await Keychain.resetGenericPassword({ service: SERVICE });
}
