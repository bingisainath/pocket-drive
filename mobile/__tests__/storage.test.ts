import { clearStorage, storage, StorageKey } from '../src/lib/storage';

describe('storage', () => {
  afterEach(() => clearStorage());

  it('round-trips a preference value', () => {
    storage.set(StorageKey.viewMode, 'grid');
    expect(storage.getString(StorageKey.viewMode)).toBe('grid');
  });

  it('clearStorage removes everything', () => {
    storage.set(StorageKey.sortOrder, 'name');
    clearStorage();
    expect(storage.getString(StorageKey.sortOrder)).toBeUndefined();
  });
});
