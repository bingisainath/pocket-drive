// Copied from frontend/src/lib/format.ts — keep the two in sync (they describe the same API).
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const yearFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Compact date: time for today, "Mar 3" this year, "Mar 3, 2023" otherwise. */
export function formatDate(ms: number): string {
  const date = new Date(ms);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return timeFmt.format(date);
  if (date.getFullYear() === now.getFullYear()) return dayFmt.format(date);
  return yearFmt.format(date);
}

export const formatDateTime = (ms: number) => fullFmt.format(new Date(ms));

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
