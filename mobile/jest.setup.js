/* eslint-env jest */
/* Mocks for native modules so Jest (Node, no native runtime) can import app code. */

// react-native-mmkv v4 is a Nitro module with no JS runtime in tests (issue #945).
// Provide a hand-rolled in-memory store matching the MMKV instance API.
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => {
    const map = new Map();
    const typed = (k, t) => (typeof map.get(k) === t ? map.get(k) : undefined);
    return {
      set: (k, v) => map.set(k, v),
      getString: (k) => typed(k, 'string'),
      getNumber: (k) => typed(k, 'number'),
      getBoolean: (k) => typed(k, 'boolean'),
      getBuffer: (k) => map.get(k),
      contains: (k) => map.has(k),
      remove: (k) => map.delete(k),
      getAllKeys: () => Array.from(map.keys()),
      clearAll: () => map.clear(),
    };
  },
}));

// NetInfo: report "connected" and a no-op unsubscribe.
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
  },
}));

// Keychain: an in-memory stand-in.
jest.mock('react-native-keychain', () => {
  let store = null;
  return {
    setGenericPassword: jest.fn((u, p) => {
      store = { username: u, password: p };
      return Promise.resolve(true);
    }),
    getGenericPassword: jest.fn(() => Promise.resolve(store ?? false)),
    resetGenericPassword: jest.fn(() => {
      store = null;
      return Promise.resolve(true);
    }),
    ACCESSIBLE: {},
  };
});

// FastImage: render as a plain view in tests.
jest.mock('@d11/react-native-fast-image', () => 'FastImage');
