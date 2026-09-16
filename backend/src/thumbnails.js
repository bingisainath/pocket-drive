import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { joinRel, resolveInside } from './paths.js';

sharp.cache(false); // don't keep decoded images in memory between requests
sharp.concurrency(1); // one libvips thread per image; we parallelize across images instead

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
// Previews skip GIF (would lose animation) and SVG (already tiny and scales perfectly).
const PREVIEWABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff', 'image/heic', 'image/heif']);
// Browsers can't show these at all, so they always get a preview whatever their size.
const NOT_BROWSER_SAFE = new Set(['image/tiff', 'image/heic', 'image/heif']);
// Below this, the original is small enough to send as is (and keeps crisp PNG screenshots lossless).
export const PREVIEW_MIN_BYTES = 1024 * 1024;

const VARIANTS = {
  // Square, cropped; ~2x a grid cell on a phone.
  thumb: {
    file: (id) => `${id}.webp`,
    render: (img) => img.resize(400, 400, { fit: 'cover' }).webp({ quality: 72 }),
  },
  // For the photo viewer: sharper than any phone screen, ~15x smaller than a camera original.
  preview: {
    file: (id) => `${id}-preview.webp`,
    render: (img) => img.resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }),
  },
};

export const canThumbnail = (mime) => SUPPORTED.has(mime);
export const canPreview = (mime) => PREVIEWABLE.has(mime);
/** Whether the photo viewer should show the preview instead of the original. Mirrored in frontend/src/lib/entries.ts. */
export const wantsPreview = (row) =>
  canPreview(row.mime) && (row.size > PREVIEW_MIN_BYTES || NOT_BROWSER_SAFE.has(row.mime));

export function createThumbnailer({ thumbDir, storageDir }) {
  const inflight = new Map(); // "variant:id" -> Promise<path|null>
  const failed = new Set(); // "variant:id" sharp couldn't decode (e.g. HEVC-encoded HEIC); don't retry until restart
  const waiting = [];
  const idleWaiters = [];
  let active = 0;
  let backfilling = null;

  const acquire = () =>
    active < MAX_PARALLEL ? (active++, Promise.resolve()) : new Promise((resolve) => waiting.push(resolve));
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else if (--active === 0) idleWaiters.splice(0).forEach((resolve) => resolve());
  };
  const whenIdle = () => (active === 0 ? Promise.resolve() : new Promise((resolve) => idleWaiters.push(resolve)));
  const exists = (file) => fsp.access(file).then(() => true, () => false);

  async function render(row, variant, key, out) {
    await acquire();
    const tmp = `${out}.${crypto.randomUUID()}.tmp`;
    try {
      const src = resolveInside(storageDir, joinRel(row.parent_path, row.name));
      const img = sharp(src, { failOn: 'none', limitInputPixels: 200_000_000 }).rotate(); // honor EXIF orientation
      await VARIANTS[variant].render(img).toFile(tmp);
      await fsp.rename(tmp, out);
      return out;
    } catch {
      failed.add(key);
      await fsp.rm(tmp, { force: true });
      return null;
    } finally {
      release();
    }
  }

  /** Path of the cached image for a file row, rendering it on first request; null if unavailable. */
  async function get(row, variant = 'thumb') {
    const allowed = variant === 'preview' ? canPreview(row.mime) : canThumbnail(row.mime);
    const key = `${variant}:${row.id}`;
    if (!allowed || failed.has(key)) return null;
    const out = path.join(thumbDir, VARIANTS[variant].file(row.id));
    try {
      await fsp.access(out);
      return out;
    } catch {}
    let job = inflight.get(key);
    if (!job) {
      job = render(row, variant, key, out).finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    return job;
  }

  return {
    get,
    /** Render in the background (e.g. right after upload) so the grid and viewer load instantly. */
    warm(row) {
      get(row, 'thumb')
        .then(() => wantsPreview(row) && get(row, 'preview'))
        .catch(() => {});
    },
    /**
     * Render every missing thumbnail and preview, one at a time and only while nothing else is
     * rendering, so photos someone is opening right now never wait behind it. `isCurrent(row)` is
     * checked just before each render to skip files deleted or replaced meanwhile. Resolves to the
     * number of images made; a second call while one is running joins it.
     */
    backfill(rows, isCurrent = () => true) {
      backfilling ??= (async () => {
        let made = 0;
        for (const row of rows) {
          for (const variant of ['thumb', 'preview']) {
            const wanted = variant === 'thumb' ? canThumbnail(row.mime) : wantsPreview(row);
            if (!wanted || failed.has(`${variant}:${row.id}`)) continue;
            if (await exists(path.join(thumbDir, VARIANTS[variant].file(row.id)))) continue;
            await whenIdle();
            if (!isCurrent(row)) break;
            if (await get(row, variant)) made++;
          }
        }
        return made;
      })().finally(() => {
        backfilling = null;
      });
      return backfilling;
    },
    async remove(ids) {
      const files = ids.flatMap((id) => Object.values(VARIANTS).map((v) => path.join(thumbDir, v.file(id))));
      await Promise.all(files.map((file) => fsp.rm(file, { force: true })));
    },
  };
}
