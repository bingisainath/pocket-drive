import { HttpError } from './http-error.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw) {
  const email = String(raw ?? '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address');
  return email;
}

const userDto = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name ?? null,
  picture: u.picture ?? null,
  isOwner: u.is_owner === 1,
  createdAt: u.created_at,
  lastLoginAt: u.last_login_at ?? null,
  shares: JSON.parse(u.shares_json ?? '[]'),
});

/** People who can sign in: the owner, plus anyone the owner has shared a folder with. */
export function createUserStore(db) {
  const q = {
    get: db.prepare('SELECT * FROM users WHERE id = ?'),
    byEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    owner: db.prepare('SELECT * FROM users WHERE is_owner = 1'),
    insert: db.prepare('INSERT INTO users (email, is_owner, created_at) VALUES (?, ?, ?) RETURNING *'),
    setOwnerEmail: db.prepare('UPDATE users SET email = ?, google_sub = NULL WHERE id = ?'),
    recordLogin: db.prepare(`
      UPDATE users SET name = COALESCE(?, name), picture = ?, google_sub = COALESCE(google_sub, ?), last_login_at = ?
      WHERE id = ?`),
    touchLogin: db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?'),
    list: db.prepare(`
      SELECT u.*,
        (SELECT json_group_array(json_object('id', s.id, 'path', s.folder_path, 'role', s.role))
         FROM shares s WHERE s.user_id = u.id) AS shares_json
      FROM users u ORDER BY u.is_owner DESC, u.email`),
    remove: db.prepare('DELETE FROM users WHERE id = ? AND is_owner = 0'),
  };

  return {
    get: (id) => (Number.isSafeInteger(id) ? q.get.get(id) : undefined),
    byEmail: (email) => q.byEmail.get(email),
    owner: () => q.owner.get(),

    /** Make sure the owner account exists and carries OWNER_EMAIL (if set). */
    ensureOwner(email) {
      const owner = q.owner.get();
      if (!owner) return q.insert.get(email || 'owner@localhost', 1, Date.now());
      if (email && owner.email !== email) {
        if (q.byEmail.get(email)) {
          throw new Error(`OWNER_EMAIL ${email} already belongs to a shared user. Remove them under People first.`);
        }
        q.setOwnerEmail.run(email, owner.id); // a different Google account: forget the old one
      }
      return q.owner.get();
    },

    /** The account for an email, created (not yet signed in) if it's new. */
    invite: (email) => q.byEmail.get(email) ?? q.insert.get(email, 0, Date.now()),

    /** A Google sign-in: refresh name/photo, pin the Google account, note the time. */
    recordLogin(id, { name, picture, sub }) {
      q.recordLogin.run(name ?? null, picture ?? null, sub, Date.now(), id);
    },

    /** Any other sign-in (the owner's password): just note the time. */
    touchLogin(id) {
      q.touchLogin.run(Date.now(), id);
    },

    list: () => q.list.all().map(userDto),

    /** Remove a person; their shares and sessions go with them (foreign-key cascades). */
    remove: (id) => q.remove.run(id).changes > 0,
  };
}
