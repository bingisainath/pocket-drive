import { ApiError, onUnauthorized, request } from '../src/api/client';
import { API_BASE_URL } from '../src/config';
import { clearToken, saveToken } from '../src/lib/auth-token';

/** The ApiError a request rejected with (fails the test if it resolved). */
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected the request to fail');
    },
    (err: ApiError) => err,
  );

const respond = (status: number, body?: unknown) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
  } as Response);

describe('request', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(async () => {
    await clearToken(); // don't leak a Bearer token into other tests
  });

  test('attaches the Bearer token when signed in', async () => {
    await saveToken('sess-abc');
    fetchMock.mockReturnValue(respond(200, { ok: true }));
    await request('GET', '/api/list');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer sess-abc');
  });

  test('sends no Authorization header when signed out', async () => {
    fetchMock.mockReturnValue(respond(200, {}));
    await request('GET', '/api/list');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  test('calls the live drive with JSON and the session cookie', async () => {
    fetchMock.mockReturnValue(respond(201, { id: 7 }));
    await expect(request('POST', '/api/folders', { body: { parentPath: '', name: 'Trip' } })).resolves.toEqual({ id: 7 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/api/folders`);
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', body: '{"parentPath":"","name":"Trip"}' });
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  test('a 204 reply resolves to undefined', async () => {
    fetchMock.mockReturnValue(respond(204));
    await expect(request('POST', '/api/auth/logout')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBeUndefined();
  });

  test('errors carry the server message and status', async () => {
    fetchMock.mockReturnValue(respond(404, { error: 'Folder not found' }));
    const err = await failure(request('GET', '/api/list?path=Nope'));
    expect(err).toBeInstanceOf(ApiError);
    expect([err.status, err.message]).toEqual([404, 'Folder not found']);

    fetchMock.mockReturnValue(respond(502));
    expect((await failure(request('GET', '/api/list'))).message).toBe('Request failed (HTTP 502)');
  });

  test('network failures become status 0 with a readable message', async () => {
    fetchMock.mockReturnValue(Promise.reject(new TypeError('Network request failed')));
    const err = await failure(request('GET', '/api/list'));
    expect([err.status, err.message]).toEqual([0, 'Can’t reach the drive. Check your internet connection.']);
  });

  test('a 401 signs the user out, except from the sign-in calls themselves', async () => {
    const handler = jest.fn();
    onUnauthorized(handler);
    fetchMock.mockReturnValue(respond(401, { error: 'Wrong password' }));
    await request('POST', '/api/auth/login', { body: { password: 'x' } }).catch(() => {});
    expect(handler).not.toHaveBeenCalled();
    await request('GET', '/api/list').catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
