import { formatBytes } from '../lib/format';
import type { StorageInfo } from '../types';

/** Drive's share of the device, other apps' share, and what's free — as one bar. */
export function StorageMeter({ info, className = '' }: { info: Required<StorageInfo> | null; className?: string }) {
  if (!info) return <div className={`h-9 ${className}`} />;
  const { usedBytes, diskTotalBytes, diskFreeBytes } = info;
  const other = Math.max(0, diskTotalBytes - diskFreeBytes - usedBytes);
  const pct = (n: number) => `${(n / diskTotalBytes) * 100}%`;
  const summary = `${formatBytes(usedBytes)} used by Drive, ${formatBytes(other)} by other apps, ${formatBytes(diskFreeBytes)} free of ${formatBytes(diskTotalBytes)}`;

  return (
    <div className={className} title={summary}>
      <div className="flex items-baseline justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-blue-600" />
          <span className="font-medium text-slate-700 dark:text-slate-200">{formatBytes(usedBytes)}</span> in Drive
        </span>
        <span>
          {formatBytes(diskFreeBytes)} free of {formatBytes(diskTotalBytes)}
        </span>
      </div>
      <div
        role="img"
        aria-label={summary}
        className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
      >
        <div className="bg-blue-600" style={{ width: pct(usedBytes), minWidth: usedBytes ? 3 : 0 }} />
        <div className="bg-slate-400/70 dark:bg-slate-600" style={{ width: pct(other) }} />
      </div>
    </div>
  );
}
