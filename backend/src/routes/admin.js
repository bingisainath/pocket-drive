import { Router } from 'express';
import { ROLES } from '../access.js';
import { requireOwner } from '../auth.js';
import { HttpError } from '../http-error.js';
import { normalizeRelPath, splitRel } from '../paths.js';
import { normalizeEmail } from '../users.js';

/** Owner-only: sharing folders, managing people, and the activity log. */
export function adminRoutes(ctx) {
  const { repo, users, shares, activity } = ctx;
  const router = Router();
  router.use(requireOwner);
  const actor = (req) => ({ user: req.user, ip: req.ip });

  function shareableFolder(raw) {
    const folder = normalizeRelPath(raw);
    if (!folder) throw new HttpError(400, 'Choose a folder to share — the whole drive can’t be shared');
    if (!repo.getByPath(...splitRel(folder))?.is_dir) throw new HttpError(404, 'Folder not found');
    return folder;
  }

  router.get('/shares', (req, res) => {
    const folder = shareableFolder(req.query.path);
    res.json({ path: folder, direct: shares.forFolder(folder), inherited: shares.inheritedFor(folder) });
  });

  // Share a folder with someone, or change their role on it.
  router.post('/shares', (req, res) => {
    const folder = shareableFolder(req.body?.path);
    const role = req.body?.role;
    if (!ROLES.includes(role)) throw new HttpError(400, `Role must be one of: ${ROLES.join(', ')}`);
    const email = normalizeEmail(req.body?.email);
    if (email === users.owner().email) throw new HttpError(400, 'That’s you — as the owner you already have full access');
    const share = shares.upsert(folder, users.invite(email).id, role);
    activity.log(actor(req), 'share', { path: folder, detail: { email, role } });
    res.status(201).json(share);
  });

  router.delete('/shares/:id', (req, res) => {
    const share = shares.get(Number(req.params.id));
    if (!share) throw new HttpError(404, 'Not found');
    shares.remove(share.id);
    activity.log(actor(req), 'unshare', { path: share.path, detail: { email: share.user.email, role: share.role } });
    res.json({ ok: true });
  });

  router.get('/users', (req, res) => {
    res.json({ users: users.list() });
  });

  // Remove a person entirely: their shares go and they're signed out immediately. Files they
  // uploaded stay (and now count as the owner's).
  router.delete('/users/:id', (req, res) => {
    const user = users.get(Number(req.params.id));
    if (!user || user.is_owner === 1) throw new HttpError(404, 'Not found');
    users.remove(user.id);
    activity.log(actor(req), 'remove_user', { detail: { email: user.email } });
    res.json({ ok: true });
  });

  router.get('/activity', (req, res) => {
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    res.json({ items: activity.page({ before, limit }) });
  });

  return router;
}
