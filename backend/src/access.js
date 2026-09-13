// Folder sharing and the permission checks built on it.
//
// A share gives one person a role on one folder and everything beneath it. When several shares
// cover the same folder, the strongest role wins (like Google Drive). The owner can do everything;
// with no covering share, a folder doesn't exist as far as that person is concerned.

export const ROLES = ['viewer', 'contributor', 'editor'];
const RANK = { viewer: 1, contributor: 2, editor: 3, owner: 4 };
const rank = (role) => RANK[role] ?? 0;
const covers = (sharedPath, folderPath) => folderPath === sharedPath || folderPath.startsWith(`${sharedPath}/`);

const shareDto = (r) => ({
  id: r.id,
  path: r.folder_path,
  role: r.role,
  createdAt: r.created_at,
  user: {
    id: r.user_id,
    email: r.email,
    name: r.name ?? null,
    picture: r.picture ?? null,
    lastLoginAt: r.last_login_at ?? null,
  },
});

export function createShareStore(db) {
  const WITH_USER = 'SELECT s.*, u.email, u.name, u.picture, u.last_login_at FROM shares s JOIN users u ON u.id = s.user_id';
  const q = {
    forUser: db.prepare('SELECT folder_path, role FROM shares WHERE user_id = ?'),
    forFolder: db.prepare(`${WITH_USER} WHERE s.folder_path = ? ORDER BY u.email`),
    inherited: db.prepare(`
      ${WITH_USER}
      WHERE s.folder_path != @path AND substr(@path, 1, length(s.folder_path) + 1) = s.folder_path || '/'
      ORDER BY s.folder_path, u.email`),
    get: db.prepare(`${WITH_USER} WHERE s.id = ?`),
    upsert: db.prepare(`
      INSERT INTO shares (folder_path, user_id, role, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (folder_path, user_id) DO UPDATE SET role = excluded.role
      RETURNING id`),
    remove: db.prepare('DELETE FROM shares WHERE id = ?'),
    removeUnder: db.prepare('DELETE FROM shares WHERE folder_path = @full OR substr(folder_path, 1, length(@prefix)) = @prefix'),
    counts: db.prepare('SELECT folder_path, COUNT(*) AS n FROM shares GROUP BY folder_path'),
    pruneOrphans: db.prepare(`
      DELETE FROM shares WHERE folder_path NOT IN (
        SELECT CASE WHEN parent_path = '' THEN name ELSE parent_path || '/' || name END FROM entries WHERE is_dir = 1)`),
  };

  return {
    forUser: (userId) => q.forUser.all(userId),
    forFolder: (path) => q.forFolder.all(path).map(shareDto),
    /** Shares on the folders above `path`, which also apply to it. */
    inheritedFor: (path) => q.inherited.all({ path }).map(shareDto),
    get(id) {
      const row = Number.isSafeInteger(id) ? q.get.get(id) : undefined;
      return row ? shareDto(row) : null;
    },
    upsert: (path, userId, role) => shareDto(q.get.get(q.upsert.get(path, userId, role, Date.now()).id)),
    remove: (id) => q.remove.run(id),
    /** Drop shares on a deleted folder and on anything that was inside it. */
    removeUnder: (full) => q.removeUnder.run({ full, prefix: `${full}/` }),
    /** How many people each shared folder is shared with (for the owner's folder badges). */
    countsByFolder: () => new Map(q.counts.all().map((r) => [r.folder_path, r.n])),
    /** Drop shares whose folder no longer exists (e.g. removed outside the app). */
    pruneOrphans: () => q.pruneOrphans.run().changes,
  };
}

/** Permission checks for one signed-in user, for the length of one request. */
export function accessFor(user, shares) {
  const isOwner = user.is_owner === 1;
  const mine = isOwner ? [] : shares.forUser(user.id);

  /** The user's role on a folder's contents ('' = the root): 'owner' | 'editor' | 'contributor' | 'viewer' | null. */
  function roleAt(folderPath) {
    if (isOwner) return 'owner';
    let best = null;
    for (const s of mine) if (covers(s.folder_path, folderPath) && rank(s.role) > rank(best)) best = s.role;
    return best;
  }

  /** The topmost folders shared with this user — their "Shared with me". */
  function roots() {
    const paths = [...new Set(mine.map((s) => s.folder_path))];
    return paths.filter((p) => !paths.some((other) => other !== p && covers(other, p))).sort();
  }

  return {
    user,
    isOwner,
    roleAt,
    roots,
    canView: (folderPath) => rank(roleAt(folderPath)) >= RANK.viewer,
    canWrite: (folderPath) => rank(roleAt(folderPath)) >= RANK.contributor,
    canDeleteAny: (folderPath) => rank(roleAt(folderPath)) >= RANK.editor,
    /** The shared folder through which the user reaches `folderPath` (for breadcrumbs); '' for the owner. */
    accessRoot: (folderPath) => (isOwner ? '' : (roots().find((r) => covers(r, folderPath)) ?? null)),
  };
}
