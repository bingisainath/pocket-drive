export type Role = 'viewer' | 'contributor' | 'editor';

export interface Entry {
  id: number;
  name: string;
  /** Folder containing this entry; '' is the root. */
  parentPath: string;
  /** Full path relative to the root, e.g. 'Photos/2024/beach.jpg'. */
  path: string;
  isDir: boolean;
  size: number;
  mime: string | null;
  /** Upload time in ms since epoch. */
  createdAt: number;
  /** Number of direct children (folders in listings only). */
  childCount: number | null;
  /** Email of whoever added it; null = the owner. */
  uploadedBy: string | null;
  /** Whether the signed-in user may delete it. */
  canDelete: boolean;
  /** Owner only: how many people this folder is shared with. */
  sharedWith?: number;
}

/** Members only get `maxUploadBytes`; the device figures are the owner's. */
export interface StorageInfo {
  maxUploadBytes: number;
  usedBytes?: number;
  fileCount?: number;
  folderCount?: number;
  diskTotalBytes?: number;
  diskFreeBytes?: number;
}

export interface User {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
  isOwner: boolean;
}

export interface Me {
  authenticated: boolean;
  user: User | null;
  /** Google sign-in works on these origins only (each is registered with Google). */
  google: { enabled: boolean; origins: string[] };
}

/** What the signed-in user may do in the folder being listed. */
export interface FolderAccess {
  role: Role | 'owner' | null;
  canWrite: boolean;
  isOwner: boolean;
  /** A member's starting page: the folders shared with them. */
  sharedRoot: boolean;
  /** The shared folder a member reaches this one through (breadcrumbs start there). */
  accessRoot: string | null;
}

export interface Share {
  id: number;
  path: string;
  role: Role;
  createdAt: number;
  user: { id: number; email: string; name: string | null; picture: string | null; lastLoginAt: number | null };
}

export interface Person {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
  isOwner: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  shares: { id: number; path: string; role: Role }[];
}

export interface ActivityItem {
  id: number;
  at: number;
  userId: number | null;
  email: string | null;
  action: string;
  path: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
}
