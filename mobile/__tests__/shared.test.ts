import { hasThumbnail, kindOf, sortEntries, wantsPreview } from '../src/shared/lib/entries';
import { formatBytes, plural } from '../src/shared/lib/format';
import type { Entry } from '../src/shared/types';

const entry = (overrides: Partial<Entry>): Entry => ({
  id: 1,
  name: 'photo.jpg',
  parentPath: '',
  path: 'photo.jpg',
  isDir: false,
  size: 1024,
  mime: 'image/jpeg',
  createdAt: 1,
  childCount: null,
  uploadedBy: null,
  canDelete: true,
  ...overrides,
});

test('file kinds come from the MIME type, then the extension', () => {
  expect(kindOf(entry({ isDir: true, mime: null }))).toBe('folder');
  expect(kindOf(entry({ mime: 'video/mp4', name: 'clip.mp4' }))).toBe('video');
  expect(kindOf(entry({ mime: 'application/octet-stream', name: 'notes.md' }))).toBe('text');
  expect(hasThumbnail(entry({ mime: 'image/heic' }))).toBe(true);
  expect(hasThumbnail(entry({ mime: 'application/pdf', name: 'a.pdf' }))).toBe(false);
});

test('the viewer uses previews for big photos and formats phones can’t show inline', () => {
  const MB = 1024 * 1024;
  expect(wantsPreview(entry({ size: 5 * MB }))).toBe(true);
  expect(wantsPreview(entry({ size: 200 * 1024 }))).toBe(false);
  expect(wantsPreview(entry({ mime: 'image/heic', size: 200 * 1024 }))).toBe(true);
  expect(wantsPreview(entry({ mime: 'image/gif', size: 5 * MB }))).toBe(false);
});

test('listings put folders first, then newest', () => {
  const sorted = sortEntries(
    [entry({ id: 1, createdAt: 10 }), entry({ id: 2, isDir: true, mime: null, createdAt: 1 }), entry({ id: 3, createdAt: 20 })],
    'newest',
  );
  expect(sorted.map((e) => e.id)).toEqual([2, 3, 1]);
});

test('sizes and counts read naturally', () => {
  expect(formatBytes(512)).toBe('512 B');
  expect(formatBytes(1536)).toBe('1.5 KB');
  expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  expect(formatBytes(300 * 1024 * 1024)).toBe('300 MB');
  expect([plural(1, 'item'), plural(3, 'item')]).toEqual(['1 item', '3 items']);
});
