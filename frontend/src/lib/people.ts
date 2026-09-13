import type { Role } from '../types';
import { formatDate } from './format';

export const ROLES: readonly Role[] = ['viewer', 'contributor', 'editor'];

export const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  viewer: { label: 'Viewer', description: 'Can view and download.' },
  contributor: { label: 'Contributor', description: 'Can also upload, and delete what they uploaded.' },
  editor: { label: 'Editor', description: 'Can also delete anything in this folder.' },
};

/** "just now", "5 min ago", "3 h ago", then a date. */
export function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return formatDate(ms);
}

export const peopleCount = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** Parent folder of a path ('' for top-level folders). */
export const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
