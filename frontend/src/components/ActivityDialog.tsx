import { FolderPlus, LogIn, RefreshCw, ShieldX, Trash2, Upload, UserMinus, UserPlus, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { formatBytes, formatDateTime, plural } from '../lib/format';
import { formatRelative } from '../lib/people';
import type { ActivityItem } from '../types';
import { Modal } from './Modal';
import { Spinner, btn } from './ui';

const PAGE = 50;

const ICONS: Record<string, { icon: LucideIcon; color: string }> = {
  login: { icon: LogIn, color: 'text-emerald-600' },
  login_denied: { icon: ShieldX, color: 'text-red-600' },
  upload: { icon: Upload, color: 'text-blue-600' },
  mkdir: { icon: FolderPlus, color: 'text-amber-600' },
  delete: { icon: Trash2, color: 'text-red-600' },
  share: { icon: UserPlus, color: 'text-violet-600' },
  unshare: { icon: UserMinus, color: 'text-slate-500' },
  remove_user: { icon: UserMinus, color: 'text-red-600' },
  rescan: { icon: RefreshCw, color: 'text-slate-500' },
};

const b = (text: ReactNode) => <span className="font-medium text-slate-900 dark:text-slate-100">{text}</span>;

function describe(item: ActivityItem): ReactNode {
  const d = (item.detail ?? {}) as Record<string, string | number | boolean>;
  switch (item.action) {
    case 'login':
      return <>signed in with {d.method === 'password' ? 'the owner password' : 'Google'}</>;
    case 'login_denied':
      return <>was refused sign-in ({String(d.reason ?? 'no access')})</>;
    case 'upload':
      return <>uploaded {b(item.path)}{typeof d.size === 'number' ? ` (${formatBytes(d.size)})` : ''}</>;
    case 'mkdir':
      return <>created folder {b(item.path)}</>;
    case 'delete':
      return <>deleted {b(item.path)}{d.folder && Number(d.items) > 1 ? ` and ${plural(Number(d.items) - 1, 'item')} inside` : ''}</>;
    case 'share':
      return <>shared {b(item.path)} with {b(String(d.email))} as {String(d.role)}</>;
    case 'unshare':
      return <>stopped sharing {b(item.path)} with {b(String(d.email))}</>;
    case 'remove_user':
      return <>removed {b(String(d.email))}</>;
    case 'rescan':
      return <>synced with disk ({Number(d.added)} added, {Number(d.updated)} changed, {Number(d.removed)} removed)</>;
    default:
      return <>{item.action} {item.path}</>;
  }
}

/** Owner only: who did what, newest first. */
export function ActivityDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.admin.activity().then(
      (res) => {
        setItems(res.items);
        setMore(res.items.length === PAGE);
      },
      (err: Error) => setError(err.message),
    );
  }, []);

  async function loadMore() {
    if (!items?.length) return;
    setLoading(true);
    try {
      const res = await api.admin.activity(items[items.length - 1].id);
      setItems([...items, ...res.items]);
      setMore(res.items.length === PAGE);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal label="Activity" onClose={onClose} wide>
      <div className="p-6">
        <h2 className="text-lg font-semibold">Activity</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Sign-ins, uploads, deletes and sharing changes.</p>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {!items ? (
          <div className="flex justify-center py-10">
            <Spinner className="size-6 text-slate-400" />
          </div>
        ) : !items.length ? (
          <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/50">Nothing yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {items.map((item) => {
              const { icon: Icon, color } = ICONS[item.action] ?? ICONS.rescan;
              return (
                <li key={item.id} className="flex gap-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                    <Icon className={`size-4 ${color}`} />
                  </span>
                  <div className="min-w-0 flex-1 text-sm break-words text-slate-600 dark:text-slate-300">
                    {b(item.email ?? 'Someone')} {describe(item)}
                    <p className="text-xs text-slate-500 dark:text-slate-400" title={`${formatDateTime(item.at)}${item.ip ? ` · ${item.ip}` : ''}`}>
                      {formatRelative(item.at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-6 flex items-center justify-between gap-2">
          {more ? (
            <button type="button" onClick={loadMore} disabled={loading} className={btn.secondary}>
              {loading && <Spinner className="size-4" />}
              Show older
            </button>
          ) : (
            <span />
          )}
          <button type="button" onClick={onClose} className={btn.primary}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
