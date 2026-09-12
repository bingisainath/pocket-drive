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
}

export interface StorageInfo {
  usedBytes: number;
  fileCount: number;
  folderCount: number;
  diskTotalBytes: number;
  diskFreeBytes: number;
  maxUploadBytes: number;
}
