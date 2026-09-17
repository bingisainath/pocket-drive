// The notification event layer: share-created and new-files events → the FCM sender, with the
// access rules (never notify someone who can't see the folder, never the uploader) and per-folder
// batching. The FCM sender and share store are stubbed; viewerIdsFor is checked against a real DB.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShareStore } from '../src/access.js';
import { openDatabase } from '../src/db.js';
import { createNotifier } from '../src/notifications.js';

const silent = { warn() {}, log() {}, error() {} };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const fakeFcm = (enabled = true) => ({
  enabled,
  calls: [],
  sendToUsers(ids, message) {
    this.calls.push({ ids: [...ids].sort((a, b) => a - b), message });
    return Promise.resolve({ sent: ids.length, removed: 0 });
  },
});
const fakeShares = (map) => ({ viewerIdsFor: (path) => map[path] ?? [] });

test('share created notifies the recipient on the Sharing channel, not the sharer', () => {
  const fcm = fakeFcm();
  const notifier = createNotifier({ fcm, shares: fakeShares({}), log: silent });
  notifier.shareCreated({ share: { path: 'Trip', user: { id: 2 } }, actorId: 1 });
  assert.equal(fcm.calls.length, 1);
  assert.deepEqual(fcm.calls[0].ids, [2]);
  assert.equal(fcm.calls[0].message.channelId, 'sharing');
  // Sharing with yourself sends nothing.
  notifier.shareCreated({ share: { path: 'Trip', user: { id: 9 } }, actorId: 9 });
  assert.equal(fcm.calls.length, 1);
});

test('new files notify a folder’s viewers except the uploader(s), batched into one', () => {
  const fcm = fakeFcm();
  const notifier = createNotifier({ fcm, shares: fakeShares({ Trip: [2, 3, 4] }), log: silent, windowMs: 10_000 });
  notifier.filesAdded({ folderPath: 'Trip', actorId: 2 });
  notifier.filesAdded({ folderPath: 'Trip', actorId: 2 }); // batched — no second notification
  notifier.filesAdded({ folderPath: 'Trip', actorId: 3 }); // a second uploader
  notifier.flush('Trip');
  assert.equal(fcm.calls.length, 1);
  assert.deepEqual(fcm.calls[0].ids, [4]); // both uploaders (2, 3) excluded
  assert.equal(fcm.calls[0].message.channelId, 'activity');
});

test('no notification when the only viewers are the uploaders', () => {
  const fcm = fakeFcm();
  const notifier = createNotifier({ fcm, shares: fakeShares({ Trip: [2] }), log: silent, windowMs: 10_000 });
  notifier.filesAdded({ folderPath: 'Trip', actorId: 2 });
  notifier.flush('Trip');
  assert.equal(fcm.calls.length, 0);
});

test('the batch auto-flushes after the window', async () => {
  const fcm = fakeFcm();
  const notifier = createNotifier({ fcm, shares: fakeShares({ Trip: [2, 3] }), log: silent, windowMs: 30 });
  notifier.filesAdded({ folderPath: 'Trip', actorId: 2 });
  await delay(90);
  assert.equal(fcm.calls.length, 1);
  assert.deepEqual(fcm.calls[0].ids, [3]);
});

test('does nothing when push is disabled', () => {
  const fcm = fakeFcm(false);
  const notifier = createNotifier({ fcm, shares: fakeShares({ Trip: [2, 3] }), log: silent });
  notifier.shareCreated({ share: { path: 'Trip', user: { id: 2 } }, actorId: 1 });
  notifier.filesAdded({ folderPath: 'Trip', actorId: 2 });
  notifier.flushAll();
  assert.equal(fcm.calls.length, 0);
});

test('viewerIdsFor covers a folder and its ancestors, not its subfolders', () => {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO users (email, is_owner, created_at) VALUES ('owner@x', 1, 0)").run(); // id 1
  db.prepare("INSERT INTO users (email, is_owner, created_at) VALUES ('a@x', 0, 0)").run(); // id 2
  db.prepare("INSERT INTO users (email, is_owner, created_at) VALUES ('b@x', 0, 0)").run(); // id 3
  db.prepare("INSERT INTO shares (folder_path, user_id, role, created_at) VALUES ('Trip', 2, 'viewer', 0)").run();
  db.prepare("INSERT INTO shares (folder_path, user_id, role, created_at) VALUES ('Trip/Day 1', 3, 'viewer', 0)").run();
  const shares = createShareStore(db);

  assert.deepEqual(shares.viewerIdsFor('Trip').sort(), [2]); // subfolder share does NOT grant access to the parent
  assert.deepEqual(shares.viewerIdsFor('Trip/Day 1').sort(), [2, 3]); // exact + inherited from 'Trip'
  assert.deepEqual(shares.viewerIdsFor('Trip/Day 1/Sub').sort(), [2, 3]); // deeper still inherits both
  assert.deepEqual(shares.viewerIdsFor('Personal'), []);
  db.close();
});
