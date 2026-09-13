const DAY_MS = 24 * 60 * 60 * 1000;

/** Who did what, when: sign-ins, uploads, new folders, deletes and sharing changes. Owner-only view. */
export function createActivityLog(db, { retentionDays }) {
  const q = {
    insert: db.prepare('INSERT INTO activity (at, user_id, user_email, action, path, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    page: db.prepare('SELECT * FROM activity WHERE id < ? ORDER BY id DESC LIMIT ?'),
    prune: db.prepare('DELETE FROM activity WHERE at < ?'),
  };

  return {
    /** `actor` is { user, ip }; `email` names someone who isn't a user (e.g. a refused sign-in). */
    log({ user, ip }, action, { path = null, detail = null, email = null } = {}) {
      q.insert.run(Date.now(), user?.id ?? null, user?.email ?? email, action, path, detail && JSON.stringify(detail), ip ?? null);
    },

    page: ({ before, limit }) =>
      q.page.all(before, limit).map((r) => ({
        id: r.id,
        at: r.at,
        userId: r.user_id,
        email: r.user_email,
        action: r.action,
        path: r.path,
        detail: r.detail ? JSON.parse(r.detail) : null,
        ip: r.ip,
      })),

    /** Forget entries older than the retention period (0 = keep forever). */
    prune: () => (retentionDays ? q.prune.run(Date.now() - retentionDays * DAY_MS).changes : 0),
  };
}
