import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import mime from 'mime-types';
import { toDto } from '../db.js';
import { HttpError } from '../http-error.js';
import { joinRel, normalizeRelPath, resolveInside, sanitizeName, splitRel } from '../paths.js';
import { receiveUpload } from '../uploads.js';

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

export function fileRoutes(ctx) {
  const { config, repo, thumbs, scanner } = ctx;
  const router = Router();

  const absOf = (row) => resolveInside(config.storageDir, joinRel(row.parent_path, row.name));

  /** Absolute path of an existing indexed folder ('' = root), or 404. */
  function requireFolder(rel) {
    if (rel) {
      const row = repo.getByPath(...splitRel(rel));
      if (!row?.is_dir) throw new HttpError(404, 'Folder not found');
    }
    return resolveInside(config.storageDir, rel);
  }

  function requireEntry(req, { file = false } = {}) {
    const id = Number(req.params.id);
    const row = Number.isSafeInteger(id) ? repo.get(id) : undefined;
    if (!row || (file && row.is_dir)) throw new HttpError(404, 'Not found');
    return row;
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
    requireFolder(folder);
    res.json({ path: folder, entries: repo.list(folder).map(toDto) });
  });

  router.get('/search', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    res.json({ query: q, entries: q ? repo.search(q, 200).map(toDto) : [] });
  });

  router.post('/folders', async (req, res) => {
    const parentPath = normalizeRelPath(req.body?.parentPath);
    const parentAbs = requireFolder(parentPath);
    const name = sanitizeName(req.body?.name);
    try {
      await fsp.mkdir(path.join(parentAbs, name));
    } catch (err) {
      if (err.code === 'EEXIST') throw new HttpError(409, `"${name}" already exists here`);
      throw err;
    }
    const { row } = repo.replace({ parentPath, name, isDir: 1, size: 0, mime: null, createdAt: Date.now() });
    res.status(201).json(toDto({ ...row, child_count: 0 }));
  });

  router.post('/upload', async (req, res) => {
    let parentPath, parentAbs;
    try {
      parentPath = normalizeRelPath(req.query.path);
      parentAbs = requireFolder(parentPath);
      if (!req.is('multipart/form-data')) throw new HttpError(415, 'Expected multipart/form-data');
      const length = Number(req.headers['content-length']) || 0;
      if (length && length > (await diskUsage(config.storageDir)).free - config.minFreeBytes) {
        throw new HttpError(507, 'Not enough free space on the device');
      }
    } catch (err) {
      res.set('Connection', 'close'); // don't make the client finish sending a body we'll never read
      throw err;
    }

    const results = await receiveUpload(req, ctx, parentPath, parentAbs);
    const files = results.filter((r) => r.ok).map((r) => toDto(r.row));
    const failures = results.filter((r) => !r.ok);
    if (!files.length && failures.length) throw failures[0].err;
    if (!files.length) throw new HttpError(400, 'No files in upload');
    res.status(201).json({
      files,
      errors: failures.map((f) => ({ name: f.name, error: f.err.status ? f.err.message : 'Failed to save' })),
    });
  });

  router.get('/files/:id/raw', (req, res, next) => sendEntry(req, res, next, 'inline'));
  router.get('/files/:id/download', (req, res, next) => sendEntry(req, res, next, 'attachment'));

  router.get('/files/:id/thumb', async (req, res, next) => {
    const thumb = await thumbs.get(requireEntry(req, { file: true }));
    if (!thumb) throw new HttpError(404, 'No thumbnail');
    sendFile(res, next, thumb, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=2592000, immutable' });
  });

  router.delete('/entries/:id', async (req, res) => {
    const row = requireEntry(req);
    await fsp.rm(absOf(row), { recursive: true, force: true });
    const ids = repo.deleteTree(row);
    await thumbs.remove(ids);
    res.json({ deleted: ids.length });
  });

  router.get('/storage', async (req, res) => {
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
    res.json(await scanner.run());
  });

  return router;
}
