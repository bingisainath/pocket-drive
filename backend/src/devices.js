/** Push-notification device tokens (Firebase Cloud Messaging). One row per device, keyed by token. */
export function createDeviceStore(db) {
  const q = {
    // A token belongs to one user at a time; if someone else signs in on the same device, it re-associates.
    upsert: db.prepare(`
      INSERT INTO devices (user_id, token, platform, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, updated_at = excluded.updated_at`),
    deleteForUser: db.prepare('DELETE FROM devices WHERE token = ? AND user_id = ?'),
    deleteToken: db.prepare('DELETE FROM devices WHERE token = ?'),
    forUser: db.prepare('SELECT token, platform FROM devices WHERE user_id = ?'),
    forUsers: (ids) =>
      db.prepare(`SELECT user_id, token FROM devices WHERE user_id IN (${ids.map(() => '?').join(',')})`),
  };

  return {
    /** Register or refresh a device's token for a user. */
    register(userId, token, platform) {
      q.upsert.run(userId, token, platform, Date.now());
    },
    /** Remove a token, but only if it belongs to this user (used on sign-out). */
    unregister(userId, token) {
      return q.deleteForUser.run(token, userId).changes > 0;
    },
    /** Remove a token regardless of owner — used when FCM reports it invalid. */
    removeToken(token) {
      q.deleteToken.run(token);
    },
    /** Every push token for a user (for the FCM sender). */
    forUser: (userId) => q.forUser.all(userId).map((r) => r.token),
    /** Push tokens for several users at once, as [{ userId, token }]. */
    forUsers(userIds) {
      if (!userIds.length) return [];
      return q.forUsers(userIds).all(...userIds).map((r) => ({ userId: r.user_id, token: r.token }));
    },
  };
}
