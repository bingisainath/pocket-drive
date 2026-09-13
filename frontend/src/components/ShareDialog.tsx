import { Check, Link2, X } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, folderLink } from '../api';
import { ROLES, ROLE_INFO, formatRelative } from '../lib/people';
import type { Role, Share } from '../types';
import { Modal } from './Modal';
import { Avatar, Spinner, btn, inputClass } from './ui';

interface Props {
  folder: string;
  onClose: () => void;
  /** Sharing changed (so folder badges can refresh). */
  onChanged: () => void;
  toast: (message: string, tone?: 'info' | 'success' | 'error') => void;
}

/** Owner only: who can open this folder, and what they can do there. */
export function ShareDialog({ folder, onClose, onChanged, toast }: Props) {
  const name = folder.split('/').pop() ?? folder;
  const [shares, setShares] = useState<{ direct: Share[]; inherited: Share[] } | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('contributor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    api.admin.shares(folder).then(setShares, (err: Error) => setError(err.message));
  }, [folder]);
  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError('');
    try {
      await action();
      toast(done, 'success');
      load();
      onChanged();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address || busy) return;
    if (await run(() => api.admin.share(folder, address, role), `Shared “${name}” with ${address}`)) setEmail('');
  }

  async function copyLink() {
    const link = folderLink(folder);
    try {
      await navigator.clipboard.writeText(link); // needs HTTPS (or localhost)
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link', link);
    }
  }

  const nobody = shares && !shares.direct.length && !shares.inherited.length;

  return (
    <Modal label={`Share ${name}`} onClose={onClose} wide>
      <div className="p-6">
        <h2 className="text-lg font-semibold break-words">Share “{name}”</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          They sign in with Google using this email and see this folder, including everything inside it.
        </p>

        <form onSubmit={add} className="mt-5 flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            inputMode="email"
            autoComplete="off"
            autoFocus
            required
            placeholder="friend@gmail.com"
            aria-label="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${inputClass} sm:flex-1`}
          />
          <div className="flex gap-2">
            <RoleSelect value={role} onChange={setRole} className="flex-1 sm:flex-none" />
            <button type="submit" className={btn.primary} disabled={!email.trim() || busy}>
              {busy ? <Spinner className="size-4" /> : 'Share'}
            </button>
          </div>
        </form>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium">{ROLE_INFO[role].label}:</span> {ROLE_INFO[role].description}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <h3 className="mt-6 mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          Who has access
        </h3>
        {!shares ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-6 text-slate-400" />
          </div>
        ) : nobody ? (
          <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
            Only you. Add someone above to share it.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {shares.direct.map((share) => (
              <li key={share.id} className="flex items-center gap-3 py-2.5">
                <Avatar email={share.user.email} name={share.user.name} picture={share.user.picture} />
                <PersonText share={share} />
                <RoleSelect
                  value={share.role}
                  label={`Role for ${share.user.email}`}
                  disabled={busy}
                  onChange={(next) =>
                    run(() => api.admin.share(folder, share.user.email, next), `${share.user.email} is now ${ROLE_INFO[next].label.toLowerCase()}`)
                  }
                />
                <button
                  type="button"
                  aria-label={`Stop sharing with ${share.user.email}`}
                  disabled={busy}
                  onClick={() => run(() => api.admin.unshare(share.id), `Stopped sharing with ${share.user.email}`)}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
            {shares.inherited.map((share) => (
              <li key={share.id} className="flex items-center gap-3 py-2.5 opacity-80">
                <Avatar email={share.user.email} name={share.user.name} picture={share.user.picture} />
                <PersonText share={share} via={share.path} />
                <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">{ROLE_INFO[share.role].label}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex items-center justify-between gap-2">
          <button type="button" onClick={copyLink} className={btn.secondary}>
            {copied ? <Check className="size-4 text-emerald-600" /> : <Link2 className="size-4" />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button type="button" onClick={onClose} className={btn.primary}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PersonText({ share, via }: { share: Share; via?: string }) {
  const seen = share.user.lastLoginAt ? `Last signed in ${formatRelative(share.user.lastLoginAt)}` : 'Hasn’t signed in yet';
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{share.user.name ?? share.user.email}</p>
      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
        {share.user.name ? `${share.user.email} · ` : ''}
        {via ? `Access via “${via}”` : seen}
      </p>
    </div>
  );
}

export function RoleSelect({
  value,
  onChange,
  label = 'Role',
  disabled,
  className = '',
}: {
  value: Role;
  onChange: (role: Role) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      value={value}
      aria-label={label}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Role)}
      className={`h-11 shrink-0 cursor-pointer rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 ${className}`}
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_INFO[r].label}
        </option>
      ))}
    </select>
  );
}
