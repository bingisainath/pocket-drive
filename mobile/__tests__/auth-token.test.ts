import { authHeaders, clearToken, currentToken, loadToken, saveToken } from '../src/lib/auth-token';

describe('auth token', () => {
  afterEach(async () => {
    await clearToken();
  });

  it('has no token and no auth header when signed out', () => {
    expect(currentToken()).toBeNull();
    expect(authHeaders()).toEqual({});
  });

  it('saves, restores from the Keystore, and clears', async () => {
    await saveToken('tok-123');
    expect(currentToken()).toBe('tok-123');
    expect(authHeaders()).toEqual({ Authorization: 'Bearer tok-123' });

    // A fresh launch reads the token back from the Keystore into memory.
    expect(await loadToken()).toBe('tok-123');

    await clearToken();
    expect(currentToken()).toBeNull();
    expect(await loadToken()).toBeNull();
  });
});
