// Copied from frontend/src/lib/entries.ts — keep the two in sync (they describe the same API).
import type { Entry } from '../types';

export type Kind =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'text'
  | 'code'
  | 'archive'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'other';

type Typed = Pick<Entry, 'name' | 'mime' | 'isDir'>;

const BY_EXT: Record<string, Kind> = {};
const register = (kind: Kind, exts: string) => exts.split(' ').forEach((ext) => (BY_EXT[ext] = kind));
register('archive', 'zip rar 7z tar gz tgz bz2 xz apk iso');
register('code', 'js mjs cjs ts tsx jsx json html htm css scss py rb go rs java kt c h cpp cs php sh yml yaml toml xml sql');
register('doc', 'doc docx odt rtf pages');
register('sheet', 'xls xlsx ods csv numbers');
register('slides', 'ppt pptx odp key');
register('text', 'txt md log ini conf srt');

export function kindOf(e: Typed): Kind {
  if (e.isDir) return 'folder';
  const mime = e.mime ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  const dot = e.name.lastIndexOf('.');
  const ext = dot > 0 ? e.name.slice(dot + 1).toLowerCase() : '';
  return BY_EXT[ext] ?? (mime.startsWith('text/') ? 'text' : 'other');
}

// Must match the backend's thumbnailer (backend/src/thumbnails.js).
const THUMB_MIMES = new Set([
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
export const hasThumbnail = (e: Entry) => !e.isDir && THUMB_MIMES.has(e.mime ?? '');

// Must match wantsPreview() in the backend's thumbnailer.
const PREVIEW_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff', 'image/heic', 'image/heif']);
const NOT_BROWSER_SAFE = new Set(['image/tiff', 'image/heic', 'image/heif']);
const PREVIEW_MIN_BYTES = 1024 * 1024;
/** The photo viewer shows a screen-sized preview for big photos and formats browsers can't display. */
export const wantsPreview = (e: Entry) => {
  const mime = e.mime ?? '';
  return !e.isDir && PREVIEW_MIMES.has(mime) && (e.size > PREVIEW_MIN_BYTES || NOT_BROWSER_SAFE.has(mime));
};

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text';
const TEXT_PREVIEW_MAX = 1024 * 1024;

export function previewKind(e: Entry): PreviewKind | null {
  const kind = kindOf(e);
  if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf') return kind;
  const textual = kind === 'text' || kind === 'code' || (e.mime ?? '').startsWith('text/');
  return textual && e.size <= TEXT_PREVIEW_MAX ? 'text' : null;
}

export const SORTS = ['newest', 'oldest', 'name', 'size'] as const;
export type SortOrder = (typeof SORTS)[number];
export const SORT_LABELS: Record<SortOrder, string> = { newest: 'Newest', oldest: 'Oldest', name: 'Name', size: 'Size' };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const COMPARE: Record<SortOrder, (a: Entry, b: Entry) => number> = {
  newest: (a, b) => b.createdAt - a.createdAt || b.id - a.id,
  oldest: (a, b) => a.createdAt - b.createdAt || a.id - b.id,
  name: (a, b) => collator.compare(a.name, b.name),
  size: (a, b) => b.size - a.size || collator.compare(a.name, b.name),
};

/** Folders first, then by the chosen order. */
export function sortEntries(list: Entry[], order: SortOrder): Entry[] {
  const compare = COMPARE[order];
  return [...list].sort((a, b) => Number(b.isDir) - Number(a.isDir) || compare(a, b));
}

export const locationOf = (e: Entry) => e.parentPath || 'My Drive';
