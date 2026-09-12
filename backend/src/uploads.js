import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';
import mime from 'mime-types';
import { HttpError } from './http-error.js';
import { fitName, sanitizeName } from './paths.js';

const MAX_FILES_PER_REQUEST = 100;

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${Number(bytes.toFixed(1))} ${units[i]}`;
}

/**
 * Stream every file in a multipart request to disk (constant memory: busboy -> temp file, with
 * backpressure all the way to the socket), then move each into `parentAbs` under a unique name.
 * Resolves to one `{ ok, row }` / `{ ok: false, name, err }` result per file.
 */
export async function receiveUpload(req, ctx, parentPath, parentAbs) {
  let bb;
  try {
    bb = Busboy({
      headers: req.headers,
      defParamCharset: 'utf8', // busboy defaults to latin1, which mangles non-ASCII filenames
      limits: {
        fileSize: ctx.config.maxUploadBytes,
        files: MAX_FILES_PER_REQUEST,
        fields: 20,
        parts: MAX_FILES_PER_REQUEST + 20,
      },
    });
  } catch (err) {
    throw new HttpError(400, `Malformed upload: ${err.message}`);
  }

  const jobs = [];
  const streams = new Set();
  const parsed = new Promise((resolve, reject) => {
    bb.on('file', (_field, stream, info) => {
      streams.add(stream);
      stream.once('close', () => streams.delete(stream));
      jobs.push(
        saveFile(stream, info.filename, ctx, parentPath, parentAbs).then(
          (row) => ({ ok: true, row }),
          (err) => ({ ok: false, name: info.filename, err }),
        ),
      );
    });
    bb.on('close', resolve);
    bb.on('error', (err) => reject(new HttpError(400, `Malformed upload: ${err.message}`)));
    req.on('error', reject);
    req.on('close', () => {
      if (!req.complete) reject(new HttpError(400, 'Upload aborted'));
    });
  });
  req.pipe(bb);

  try {
    await parsed;
  } catch (err) {
    // Client went away or sent garbage: stop every in-flight file so its temp file gets cleaned up.
    req.unpipe(bb);
    for (const stream of streams) stream.destroy(err);
    await Promise.allSettled(jobs);
    throw err;
  }
  return Promise.all(jobs);
}

async function saveFile(stream, filename, ctx, parentPath, parentAbs) {
  const { config, repo, thumbs } = ctx;
  let name;
  try {
    name = sanitizeName(filename);
  } catch (err) {
    stream.resume(); // drain so the rest of the request keeps flowing
    throw err;
  }

  const tmp = path.join(config.tmpDir, `${crypto.randomUUID()}.part`);
  try {
    await pipeline(stream, fs.createWriteStream(tmp, { flags: 'wx' }));
    if (stream.truncated) {
      throw new HttpError(413, `"${name}" is larger than the ${formatBytes(config.maxUploadBytes)} upload limit`);
    }
    const { size } = await fsp.stat(tmp);
    const finalName = await moveIntoPlace(tmp, parentAbs, name);
    const { row, replacedIds } = repo.replace({
      parentPath,
      name: finalName,
      isDir: 0,
      size,
      mime: mime.lookup(finalName) || 'application/octet-stream',
      createdAt: Date.now(),
    });
    if (replacedIds.length) await thumbs.remove(replacedIds);
    thumbs.warm(row);
    return row;
  } finally {
    await fsp.rm(tmp, { force: true }); // no-op once the file has been renamed into place
  }
}

/** Atomically claim `name` (or "name (1)", "name (2)", ...) in `dirAbs` and move the temp file there. */
async function moveIntoPlace(tmp, dirAbs, name) {
  for (let n = 0; n < 10_000; n++) {
    const candidate = n === 0 ? name : fitName(name, ` (${n})`);
    const target = path.join(dirAbs, candidate);
    try {
      await (await fsp.open(target, 'wx')).close(); // O_EXCL: fails if anything already has this name
    } catch (err) {
      if (err.code === 'EEXIST' || err.code === 'EISDIR') continue;
      throw err;
    }
    try {
      await fsp.rename(tmp, target).catch(async (err) => {
        if (err.code !== 'EXDEV') throw err;
        await fsp.copyFile(tmp, target); // target folder is on another filesystem (e.g. a bind mount)
      });
    } catch (err) {
      await fsp.rm(target, { force: true });
      throw err;
    }
    return candidate;
  }
  throw new HttpError(409, `Too many files named "${name}"`);
}
