import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import mime from 'mime-types';
import { accessFor } from '../access.js';
import { toDto } from '../db.js';
import { HttpError } from '../http-error.js';
import { joinRel, normalizeRelPath, resolveInside, sanitizeName, splitRel } from '../paths.js';
import { OffsetMismatch } from '../resumable.js';
import { commitFile, formatBytes, receiveUpload } from '../uploads.js';

// Types browsers render without running scripts in our origin — safe to show inline.
const isSafeInline = (type) =>
  (type.startsWith('image/') && type !== 'image/svg+xml') ||
  type.startsWith('video/') ||
  type.startsWith('audio/') ||
  type === 'application/pdf';
// Scriptable documents (SVG, HTML, ...) are only shown inline inside a CSP sandbox.
const isSandboxedInline = (type) => type === 'image/svg+xml' || type.startsWith('text/') || type === 'application/json';
const SANDBOX_CSP = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";

function contentDisposition(kind, name) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

async function diskUsage(dir) {
  const s = await fsp.statfs(dir);
  return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
}

// Every route here checks the signed-in user's access. Anything a user may not see answers
// 404, exactly like something that doesn't exist, so private folders can't even be detected.
export function fileRoutes(ctx) {
  const { config, repo, thumbs, scanner, shares, activity, resumable } = ctx;
  const router = Router();

  router.use((req, res, next) => {
    req.access = accessFor(req.user, shares);
    next();
  });

  const absOf = (row) => resolveInside(config.storageDir, joinRel(row.parent_path, row.name));
  const fullPathOf = (row) => joinRel(row.parent_path, row.name);
  const actor = (req) => ({ user: req.user, ip: req.ip });

  /** Absolute path of an existing indexed folder ('' = root), or 404. */
  function requireFolder(rel) {
    if (rel) {
      const row = repo.getByPath(...splitRel(rel));
      if (!row?.is_dir) throw new HttpError(404, 'Folder not found');
    }
    return resolveInside(config.storageDir, rel);
  }

  /** A folder the user may look inside, or 404 (whether it's missing or just private). */
  function viewableFolder(req, rel) {
    if (!req.access.canView(rel)) throw new HttpError(404, 'Folder not found');
    return requireFolder(rel);
  }

  /** A folder the user may also add to. */
  function writableFolder(req, rel) {
    const abs = viewableFolder(req, rel);
    if (!req.access.canWrite(rel)) throw new HttpError(403, 'You can view this folder but not add to it');
    return abs;
  }

  /** An entry the user can see — in a folder they can view, or a folder shared with them — or 404. */
  function requireEntry(req, { file = false } = {}) {
    const id = Number(req.params.id);
    const row = Number.isSafeInteger(id) ? repo.get(id) : undefined;
    const visible =
      row && (req.access.canView(row.parent_path) || (row.is_dir === 1 && req.access.canView(fullPathOf(row))));
    if (!visible || (file && row.is_dir)) throw new HttpError(404, 'Not found');
    return row;
  }

  function canDelete(access, row) {
    if (access.isOwner || access.canDeleteAny(row.parent_path)) return true;
    // Contributors may remove only what they added themselves (for a folder: everything in it, too).
    if (!access.canWrite(row.parent_path) || row.owner_id !== access.user.id) return false;
    return row.is_dir !== 1 || repo.foreignCountInTree(row, access.user.id) === 0;
  }

  function dto(req, row) {
    const out = { ...toDto(row), canDelete: canDelete(req.access, row) };
    // Only the owner learns which folders are shared (and with how many people).
    if (req.access.isOwner && row.is_dir === 1) {
      req.shareCounts ??= shares.countsByFolder();
      out.sharedWith = req.shareCounts.get(out.path) ?? 0;
    }
    return out;
  }

  function sendFile(res, next, file, headers) {
    // Errors after headers are sent are just clients aborting (e.g. video seeking) — ignore those.
    res.sendFile(file, { dotfiles: 'allow', headers }, (err) => {
      if (err && !res.headersSent) next(err);
    });
  }

  function sendEntry(req, res, next, mode) {
    const row = requireEntry(req, { file: true });
    const type = row.mime || 'application/octet-stream';
    const headers = {
      'Content-Type': mime.contentType(type) || type,
      'Cache-Control': 'private, max-age=86400', // ids are never reused, so content per id is fixed
    };
    let kind = mode;
    if (mode === 'inline' && !isSafeInline(type)) {
      if (isSandboxedInline(type)) headers['Content-Security-Policy'] = SANDBOX_CSP;
      else kind = 'attachment';
    }
    headers['Content-Disposition'] = contentDisposition(kind, row.name);
    sendFile(res, next, absOf(row), headers);
  }

  router.get('/list', (req, res) => {
    const folder = normalizeRelPath(req.query.path);
    const { access } = req;
    if (!folder && !access.isOwner) {
      // Everyone but the owner starts at "Shared with me": the top-level folders shared with them.
      const entries = access
        .roots()
        .map((p) => repo.getDir(...splitRel(p)))
        .filter(Boolean);
      return res.json({
        path: '',
        entries: entries.map((row) => dto(req, row)),
        access: { role: null, canWrite: false, isOwner: false, sharedRoot: true, accessRoot: null },
      });
    }
    viewableFolder(req, folder);
    res.json({
      path: folder,
      entries: repo.list(folder).map((row) => dto(req, row)),
      access: {
        role: access.roleAt(folder),
        canWrite: access.canWrite(folder),
        isOwner: access.isOwner,
        sharedRoot: false,
        accessRoot: access.accessRoot(folder),
      },
    });
  });

  router.get('/search', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const { access } = req;
    const rows = !q ? [] : access.isOwner ? repo.search(q, 200) : repo.searchWithin(q, access.roots(), 200);
    res.json({ query: q, entries: rows.map((row) => dto(req, row)) });
  });

  router.post('/folders', async (req, res) => {
    const parentPath = normalizeRelPath(req.body?.parentPath);
    const parentAbs = writableFolder(req, parentPath);
    const name = sanitizeName(req.body?.name);
    try {
      await fsp.mkdir(path.join(parentAbs, name));
    } catch (err) {
      if (err.code === 'EEXIST') throw new HttpError(409, `"${name}" already exists here`);
      throw err;
    }
    const { row } = repo.replace({
      parentPath,
      name,
      isDir: 1,
      size: 0,
      mime: null,
      createdAt: Date.now(),
      ownerId: req.user.id,
    });
    activity.log(actor(req), 'mkdir', { path: fullPathOf(row) });
    res.status(201).json(dto(req, { ...row, child_count: 0, uploaded_by: req.user.email }));
  });

  router.post('/upload', async (req, res) => {
    let parentPath, parentAbs;
    try {
      parentPath = normalizeRelPath(req.query.path);
      parentAbs = writableFolder(req, parentPath);
      if (!req.is('multipart/form-data')) throw new HttpError(415, 'Expected multipart/form-data');
      const length = Number(req.headers['content-length']) || 0;
      if (length && length > (await diskUsage(config.storageDir)).free - config.minFreeBytes) {
        throw new HttpError(507, 'Not enough free space on the device');
      }
    } catch (err) {
      res.set('Connection', 'close'); // don't make the client finish sending a body we'll never read
      throw err;
    }

    const results = await receiveUpload(req, ctx, parentPath, parentAbs, req.user.id);
    const saved = results.filter((r) => r.ok).map((r) => r.row);
    for (const row of saved) activity.log(actor(req), 'upload', { path: fullPathOf(row), detail: { size: row.size } });
    const failures = results.filter((r) => !r.ok);
    if (!saved.length && failures.length) throw failures[0].err;
    if (!saved.length) throw new HttpError(400, 'No files in upload');
    res.status(201).json({
      files: saved.map((row) => dto(req, { ...row, uploaded_by: req.user.email })),
      errors: failures.map((f) => ({ name: f.name, error: f.err.status ? f.err.message : 'Failed to save' })),
    });
  });

  // --- Chunked, resumable uploads ---
  // POST starts one (or finds the unfinished upload of the same file), PUT appends a chunk at
  // Upload-Offset, GET reports how far it got, DELETE abandons it. Each chunk is its own request,
  // so big files get through Cloudflare's 100 MB request limit and survive dropped connections.

  router.post('/uploads', async (req, res) => {
    const parentPath = normalizeRelPath(req.body?.path);
    writableFolder(req, parentPath);
    const name = sanitizeName(req.body?.name);
    const size = Number(req.body?.size);
    const lastModified = Number(req.body?.lastModified) || 0;
    if (!Number.isSafeInteger(size) || size < 0) throw new HttpError(400, 'Invalid file size');
    if (size > config.maxUploadBytes) {
      throw new HttpError(413, `"${name}" is larger than the ${formatBytes(config.maxUploadBytes)} upload limit`);
    }
    const upload = await resumable.open({ userId: req.user.id, parentPath, name, size, lastModified });
    if (size - upload.offset > (await diskUsage(config.storageDir)).free - config.minFreeBytes) {
      if (upload.offset === 0) await resumable.discard(upload);
      throw new HttpError(507, 'Not enough free space on the device');
    }
    res.json({ ...upload, chunkSize: resumable.chunkBytes });
  });

  router.get('/uploads/:id', async (req, res) => {
    const upload = await resumable.load(req.params.id, req.user.id);
    res.json({ offset: await resumable.offset(upload), size: upload.size });
  });

  router.put('/uploads/:id', async (req, res) => {
    let upload, offset;
    try {
      upload = await resumable.load(req.params.id, req.user.id);
      const start = Number(req.get('upload-offset'));
      if (!Number.isSafeInteger(start)) throw new HttpError(400, 'Missing Upload-Offset header');
      offset = await resumable.append(upload, start, req);
    } catch (err) {
      res.set('Connection', 'close'); // don't make the client finish sending a chunk we won't store
      if (err instanceof OffsetMismatch) return res.status(409).json({ error: err.message, offset: err.offset });
      throw err;
    }
    if (offset < upload.size) return res.json({ offset });

    // Last chunk: the folder may have been deleted or unshared since the upload started.
    const parentAbs = writableFolder(req, upload.parentPath);
    const row = await commitFile(ctx, resumable.partPath(upload), upload.parentPath, parentAbs, upload.name, req.user.id);
    await resumable.discard(upload);
    activity.log(actor(req), 'upload', { path: fullPathOf(row), detail: { size: row.size } });
    res.status(201).json({ offset, file: dto(req, { ...row, uploaded_by: req.user.email }) });
  });

  router.delete('/uploads/:id', async (req, res) => {
    await resumable.discard(await resumable.load(req.params.id, req.user.id));
    res.status(204).end();
  });

  router.get('/files/:id/raw', (req, res, next) => sendEntry(req, res, next, 'inline'));
  router.get('/files/:id/download', (req, res, next) => sendEntry(req, res, next, 'attachment'));

  router.get('/files/:id/thumb', async (req, res, next) => {
    const thumb = await thumbs.get(requireEntry(req, { file: true }));
    if (!thumb) throw new HttpError(404, 'No thumbnail');
    sendFile(res, next, thumb, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=2592000, immutable' });
  });

  // Screen-sized version for the photo viewer; the original stays available via /raw and /download.
  router.get('/files/:id/preview', async (req, res, next) => {
    const preview = await thumbs.get(requireEntry(req, { file: true }), 'preview');
    if (!preview) throw new HttpError(404, 'No preview');
    sendFile(res, next, preview, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=2592000, immutable' });
  });

  router.delete('/entries/:id', async (req, res) => {
    const row = requireEntry(req);
    if (!canDelete(req.access, row)) throw new HttpError(403, 'You don’t have permission to delete this');
    await fsp.rm(absOf(row), { recursive: true, force: true });
    const ids = repo.deleteTree(row);
    if (row.is_dir === 1) shares.removeUnder(fullPathOf(row));
    await thumbs.remove(ids);
    activity.log(actor(req), 'delete', { path: fullPathOf(row), detail: { items: ids.length, folder: row.is_dir === 1 } });
    res.json({ deleted: ids.length });
  });

  router.get('/storage', async (req, res) => {
    if (!req.access.isOwner) return res.json({ maxUploadBytes: config.maxUploadBytes }); // device stats are the owner's
    const disk = await diskUsage(config.storageDir);
    const { bytes, files, folders } = repo.stats();
    res.json({
      usedBytes: bytes,
      fileCount: files,
      folderCount: folders,
      diskTotalBytes: disk.total,
      diskFreeBytes: disk.free,
      maxUploadBytes: config.maxUploadBytes,
    });
  });

  router.post('/rescan', async (req, res) => {
    if (!req.access.isOwner) throw new HttpError(403, 'Only the owner can do that');
    const result = await scanner.run();
    activity.log(actor(req), 'rescan', { detail: result });
    res.json(result);
  });

  return router;
}
