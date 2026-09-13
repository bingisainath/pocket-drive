import { Folder, UserX } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { ROLE_INFO, formatRelative } from '../lib/people';
import type { Person } from '../types';
import { Modal } from './Modal';
import { Avatar, Spinner, btn } from './ui';

interface Props {
  onClose: () => void;
  onOpenFolder: (path: string) => void;
  onChanged: () => void;
  toast: (message: string, tone?: 'info' | 'success' | 'error') => void;
}

/** Owner only: everyone who can sign in, what's shared with them, and removing them. */
export function PeopleDialog({ onClose, onOpenFolder, onChanged, toast }: Props) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.admin.people().then((res) => setPeople(res.users), (err: Error) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  async function remove(person: Person) {
    setBusy(true);
    try {
      await api.admin.removePerson(person.id);
      toast(`Removed ${person.email}`, 'success');
      setConfirming(null);
      load();
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const others = people?.filter((p) => !p.isOwner) ?? [];

  return (
    <Modal label="People & access" onClose={onClose} wide>
      <div className="p-6">
        <h2 className="text-lg font-semibold">People &amp; access</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Everyone who can sign in. To add someone, share a folder with them.
        </p>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {!people ? (
          <div className="flex justify-center py-10">
            <Spinner className="size-6 text-slate-400" />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {people.map((person) => (
              <li key={person.id} className="py-3">
                <div className="flex items-center gap-3">
                  <Avatar email={person.email} name={person.name} picture={person.picture} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {person.name ?? person.email}
                      {person.isOwner && (
                        <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                          Owner
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {person.name ? `${person.email} · ` : ''}
                      {person.lastLoginAt ? `Last signed in ${formatRelative(person.lastLoginAt)}` : 'Hasn’t signed in yet'}
                    </p>
                  </div>
                  {!person.isOwner && confirming !== person.id && (
                    <button
                      type="button"
                      aria-label={`Remove ${person.email}`}
                      onClick={() => setConfirming(person.id)}
                      className="flex size-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                    >
                      <UserX className="size-4" />
                    </button>
                  )}
                </div>

                {confirming === person.id && (
                  <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm dark:bg-red-500/10">
                    <p className="text-red-800 dark:text-red-200">
                      Remove {person.email}? They lose access to every shared folder and are signed out now. Files they
                      added stay.
                    </p>
                    <div className="mt-3 flex justify-end gap-2">
                      <button type="button" className={`${btn.secondary} h-9`} onClick={() => setConfirming(null)} disabled={busy}>
                        Cancel
                      </button>
                      <button type="button" className={`${btn.danger} h-9`} onClick={() => remove(person)} disabled={busy}>
                        {busy ? <Spinner className="size-4" /> : 'Remove'}
                      </button>
                    </div>
                  </div>
                )}

                {person.isOwner ? (
                  <p className="mt-2 ml-12 text-xs text-slate-500 dark:text-slate-400">Full access to everything</p>
                ) : person.shares.length ? (
                  <div className="mt-2 ml-12 flex flex-wrap gap-1.5">
                    {person.shares.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onOpenFolder(s.path)}
                        className="flex max-w-full items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
                      >
                        <Folder className="size-3.5 shrink-0 text-amber-500" />
                        <span className="truncate">{s.path}</span>
                        <span className="shrink-0 text-slate-500 dark:text-slate-400">· {ROLE_INFO[s.role].label}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 ml-12 text-xs text-slate-500 dark:text-slate-400">Nothing shared right now</p>
                )}
              </li>
            ))}
          </ul>
        )}
        {people && !others.length && (
          <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
            No one else has access yet.
          </p>
        )}

        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} className={btn.primary}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
