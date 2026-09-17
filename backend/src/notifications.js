// Turns app events into push notifications via the FCM sender. Two events:
//   - a folder was shared with someone  -> tell that person (Sharing channel)
//   - new files landed in a shared folder -> tell the people who can view it (Activity channel),
//     batched per folder into one notification per window, and never the person who added them.
// No-op when push is disabled, so callers never need to check.

const WINDOW_MS = 10 * 60 * 1000; // one Activity notification per folder per 10 minutes

const folderLabel = (path) => path.split('/').pop() || 'your drive';

export function createNotifier({ fcm, shares, log = console, windowMs = WINDOW_MS } = {}) {
  // folderPath -> { actorIds: Set<number>, timer }
  const pending = new Map();

  function flush(folderPath) {
    const entry = pending.get(folderPath);
    pending.delete(folderPath);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    // Recompute viewers now (shares may have changed during the window); never the uploader(s).
    const recipients = shares.viewerIdsFor(folderPath).filter((id) => !entry.actorIds.has(id));
    if (!recipients.length) return;
    fcm
      .sendToUsers(recipients, {
        title: 'New files',
        body: `New files were added to “${folderLabel(folderPath)}”`,
        channelId: 'activity',
        data: { type: 'files', path: folderPath },
      })
      .catch((err) => log.warn(`notify files failed: ${err.message}`));
  }

  return {
    /** A folder was shared with someone — tell them (unless they shared it with themselves). */
    shareCreated({ share, actorId }) {
      if (!fcm.enabled || share.user.id === actorId) return;
      fcm
        .sendToUsers([share.user.id], {
          title: 'A folder was shared with you',
          body: `You now have access to “${folderLabel(share.path)}”`,
          channelId: 'sharing',
          data: { type: 'share', path: share.path },
        })
        .catch((err) => log.warn(`notify share failed: ${err.message}`));
    },

    /** New files landed in a folder — batch and, after the window, notify its viewers. */
    filesAdded({ folderPath, actorId }) {
      if (!fcm.enabled) return;
      let entry = pending.get(folderPath);
      if (!entry) {
        entry = { actorIds: new Set(), timer: null };
        pending.set(folderPath, entry);
        entry.timer = setTimeout(() => flush(folderPath), windowMs);
        entry.timer.unref?.(); // don't keep the process alive just for a pending notification
      }
      entry.actorIds.add(actorId);
    },

    /** Fire everything pending now (used on shutdown and in tests). */
    flushAll() {
      for (const folderPath of [...pending.keys()]) flush(folderPath);
    },

    /** Test/introspection helper. */
    flush,
  };
}
