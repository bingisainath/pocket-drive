import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError } from './http-error.js';

/** Unfinished uploads untouched for this long are deleted. */
export const RESUMABLE_TTL_MS = 24 * 60 * 60 * 1000;
const ID = /^[a-f0-9]{32}$/;

/** The client's offset doesn't match the server's; `offset` is where to continue from. */
export class OffsetMismatch extends HttpError {
  constructor(offset, message = 'Upload offset does not match') {
    super(409, message);
    this.offset = offset;
  }
}

/**
 * Chunked, resumable uploads. Each one is `<id>.part` (the bytes so far) plus `<id>.json` (who is
 * uploading what, and where) in `dir`, which lives on the storage filesystem so finishing is a
 * rename. The id is derived from the user, folder, name, size and modification time, so adding
 * the same file again — say, after the browser tab was closed — continues the upload instead of
 * starting over. Chunks stay below Cloudflare's 100 MB request limit.
 */
export function createResumableUploads({ dir, chunkBytes }) {
  const busy = new Set(); // ids with a chunk being written right now
  const files = (id) => ({ part: path.join(dir, `${id}.part`), meta: path.join(dir, `${id}.json`) });
  const sizeOf = (file) => fsp.stat(file).then((s) => s.size, () => 0);
  const save = (meta) => fsp.writeFile(files(meta.id).meta, JSON.stringify({ ...meta, updatedAt: Date.now() }));

  return {
    chunkBytes,

    /** Start an upload, or find the unfinished one for this same file. Resolves to `{ id, offset }`. */
    async open({ userId, parentPath, name, size, lastModified }) {
      const key = JSON.stringify([userId, parentPath, name, size, lastModified]);
      const id = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
      const { part } = files(id);
      let offset = await sizeOf(part);
      if (offset > size) {
        await fsp.rm(part, { force: true });
        offset = 0;
      }
      await fsp.mkdir(dir, { recursive: true });
      await fsp.appendFile(part, '');
      await save({ id, userId, parentPath, name, size, lastModified });
      return { id, offset };
    },

    /** The upload's metadata, if it exists and belongs to this user; otherwise 404. */
    async load(id, userId) {
      const meta = ID.test(id) ? await fsp.readFile(files(id).meta, 'utf8').then(JSON.parse, () => null) : null;
      if (!meta || meta.userId !== userId) throw new HttpError(404, 'Upload not found (it may have expired)');
      return meta;
    },

    offset: (meta) => sizeOf(files(meta.id).part),
    partPath: (meta) => files(meta.id).part,

    /**
     * Append the chunk streaming in on `input`, which must start at `offset`. Resolves to the new
     * offset. If the connection drops mid-chunk, the bytes that arrived are kept and the next
     * attempt continues from there.
     */
    async append(meta, offset, input) {
      if (busy.has(meta.id)) throw new OffsetMismatch(await this.offset(meta), 'Another chunk of this upload is still arriving');
      busy.add(meta.id);
      try {
        const { part } = files(meta.id);
        const start = await sizeOf(part);
        if (offset !== start) throw new OffsetMismatch(start);
        const limit = Math.min(chunkBytes, meta.size - start);
        let received = 0;
        const guard = new Transform({
          transform(chunk, _encoding, done) {
            received += chunk.length;
            done(received > limit ? new HttpError(413, 'Chunk is larger than allowed') : null, chunk);
          },
        });
        try {
          await pipeline(input, guard, fs.createWriteStream(part, { flags: 'a' }));
        } catch (err) {
          if (err.status === 413) {
            await fsp.truncate(part, start);
            throw err;
          }
          throw new HttpError(400, 'Upload interrupted');
        } finally {
          await save(meta);
        }
        return sizeOf(part);
      } finally {
        busy.delete(meta.id);
      }
    },

    async discard(meta) {
      const { part, meta: metaFile } = files(meta.id);
      await Promise.all([fsp.rm(part, { force: true }), fsp.rm(metaFile, { force: true })]);
    },

    /** Delete uploads nobody has touched within the TTL (and stray files without metadata). */
    async prune(now = Date.now()) {
      const names = await fsp.readdir(dir).catch(() => []);
      const ids = new Set(names.map((n) => n.replace(/\.(part|json)$/, '')));
      let removed = 0;
      for (const id of ids) {
        if (busy.has(id)) continue;
        const meta = await fsp.readFile(files(id).meta, 'utf8').then(JSON.parse, () => null);
        if (meta && now - meta.updatedAt < RESUMABLE_TTL_MS) continue;
        await this.discard({ id });
        removed++;
      }
      return removed;
    },
  };
}
