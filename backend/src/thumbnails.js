import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { joinRel, resolveInside } from './paths.js';

sharp.cache(false); // don't keep decoded images in memory between requests
sharp.concurrency(1); // one libvips thread per image; we parallelize across images instead

const SIZE = 400; // square, cropped; ~2x a grid cell on a phone
const MAX_PARALLEL = 2;
const SUPPORTED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
  'image/heic',
  'image/heif',
  'image/svg+xml',
]);

export const canThumbnail = (mime) => SUPPORTED.has(mime);

export function createThumbnailer({ thumbDir, storageDir }) {
  const inflight = new Map(); // id -> Promise<path|null>
  const failed = new Set(); // ids sharp couldn't decode (e.g. HEVC-encoded HEIC); don't retry until restart
  const waiting = [];
  let active = 0;

  const acquire = () =>
    active < MAX_PARALLEL ? (active++, Promise.resolve()) : new Promise((resolve) => waiting.push(resolve));
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  const thumbPath = (id) => path.join(thumbDir, `${id}.webp`);

  async function render(row, out) {
    await acquire();
    const tmp = `${out}.${crypto.randomUUID()}.tmp`;
    try {
      const src = resolveInside(storageDir, joinRel(row.parent_path, row.name));
      await sharp(src, { failOn: 'none', limitInputPixels: 200_000_000 })
        .rotate() // honor EXIF orientation from phone cameras
        .resize(SIZE, SIZE, { fit: 'cover' })
        .webp({ quality: 72 })
        .toFile(tmp);
      await fsp.rename(tmp, out);
      return out;
    } catch {
      failed.add(row.id);
      await fsp.rm(tmp, { force: true });
      return null;
    } finally {
      release();
    }
  }

  /** Path of the cached thumbnail for a file row, rendering it on first request; null if unavailable. */
  async function get(row) {
    if (!canThumbnail(row.mime) || failed.has(row.id)) return null;
    const out = thumbPath(row.id);
    try {
      await fsp.access(out);
      return out;
    } catch {}
    let job = inflight.get(row.id);
    if (!job) {
      job = render(row, out).finally(() => inflight.delete(row.id));
      inflight.set(row.id, job);
    }
    return job;
  }

  return {
    get,
    /** Render in the background (e.g. right after upload) so the grid loads instantly. */
    warm(row) {
      get(row).catch(() => {});
    },
    async remove(ids) {
      await Promise.all(ids.map((id) => fsp.rm(thumbPath(id), { force: true })));
    },
  };
}
