import { API_BASE_URL } from '../config';
import { authHeaders } from '../lib/auth-token';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let unauthorizedHandler = () => {};
/** Called whenever the server says the session is gone (expired, signed out elsewhere, access removed). */
export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

/**
 * A JSON request to the drive API.
 *
 * The app authenticates with a Bearer token (stored in the Keystore), not the web's cookie — background
 * native uploads can't use the JS cookie jar. The token is attached to every request, and to image and
 * video loads, via {@link authHeaders}.
 */
export async function request<T>(
  method: string,
  path: string,
  { body, signal }: { body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE_URL + path, {
      method,
      signal,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...authHeaders(),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'Can’t reach the drive. Check your internet connection.');
  }
  if (res.status === 401 && !path.startsWith('/api/auth/')) unauthorizedHandler();
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error ?? `Request failed (HTTP ${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
