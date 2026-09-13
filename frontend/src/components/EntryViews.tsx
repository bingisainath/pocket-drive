import { EllipsisVertical, Users } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useLongPress } from '../hooks/useLongPress';
import { locationOf } from '../lib/entries';
import { formatBytes, formatDate, plural } from '../lib/format';
import { peopleCount } from '../lib/people';
import type { Entry } from '../types';
import { FileIcon, Thumb } from './FileIcon';

interface ViewProps {
  entries: Entry[];
  /** Search results: show which folder each entry lives in. */
  showLocation: boolean;
  onOpen: (entry: Entry) => void;
  onActions: (entry: Entry) => void;
}

interface ItemProps extends Omit<ViewProps, 'entries'> {
  entry: Entry;
}

function describe(entry: Entry, showLocation: boolean) {
  const detail = entry.isDir
    ? entry.childCount === null
      ? 'Folder'
      : plural(entry.childCount, 'item')
    : `${formatBytes(entry.size)} · ${formatDate(entry.createdAt)}`;
  return showLocation ? `${locationOf(entry)} · ${detail}` : detail;
}

/** Owner's hint that a folder is shared. */
function SharedBadge({ entry }: { entry: Entry }) {
  if (!entry.sharedWith) return null;
  const label = `Shared with ${peopleCount(entry.sharedWith)}`;
  return (
    <span title={label} className="inline-flex shrink-0 text-blue-600 dark:text-blue-400">
      <Users className="size-3.5" aria-label={label} />
    </span>
  );
}

/** Tap/Enter opens; long-press, right-click or the ⋮ button opens the actions sheet. */
function useItemProps({ entry, onOpen, onActions }: ItemProps) {
  const press = useLongPress(() => onActions(entry));
  return {
    ...press,
    role: 'button',
    tabIndex: 0,
    'aria-label': entry.name,
    onClick: () => onOpen(entry),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen(entry);
      }
    },
  };
}

function MoreButton({ entry, onActions, className = '' }: { entry: Entry; onActions: (e: Entry) => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label={`Actions for ${entry.name}`}
      onClick={(e) => {
        e.stopPropagation();
        onActions(entry);
      }}
      onPointerDown={(e) => e.stopPropagation()} // don't start the card's long-press
      className={`flex size-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-white ${className}`}
    >
      <EllipsisVertical className="size-5" />
    </button>
  );
}

const card =
  'touch-item cursor-pointer rounded-xl bg-white ring-1 ring-slate-900/5 outline-none transition hover:ring-slate-900/15 focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-[0.98] dark:bg-slate-900 dark:ring-white/10 dark:hover:ring-white/20';
const sectionTitle = 'mb-2 px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400';

// --- Grid ---

export function GridView({ entries, ...rest }: ViewProps) {
  const folders = entries.filter((e) => e.isDir);
  const files = entries.filter((e) => !e.isDir);
  return (
    <div className="space-y-6">
      {folders.length > 0 && (
        <section>
          <h2 className={sectionTitle}>Folders</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5">
            {folders.map((entry) => (
              <FolderTile key={entry.id} entry={entry} {...rest} />
            ))}
          </div>
        </section>
      )}
      {files.length > 0 && (
        <section>
          <h2 className={sectionTitle}>Files</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {files.map((entry) => (
              <FileCard key={entry.id} entry={entry} {...rest} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function FolderTile(props: ItemProps) {
  const { entry, showLocation, onActions } = props;
  return (
    <div {...useItemProps(props)} className={`${card} flex min-h-16 items-center gap-2.5 py-2 pr-0.5 pl-3`}>
      <FileIcon entry={entry} className="size-7 shrink-0" />
      <div className="min-w-0 flex-1">
        {/* Two lines, not truncation: phone tiles are narrow and folder names are what you scan for. */}
        <p className="flex items-start gap-1 text-sm font-medium">
          <span className="line-clamp-2 break-words">{entry.name}</span>
          <SharedBadge entry={entry} />
        </p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{describe(entry, showLocation)}</p>
      </div>
      <MoreButton entry={entry} onActions={onActions} />
    </div>
  );
}

function FileCard(props: ItemProps) {
  const { entry, showLocation, onActions } = props;
  return (
    <div
      {...useItemProps(props)}
      className={`${card} flex flex-col overflow-hidden [contain-intrinsic-size:auto_240px] [content-visibility:auto]`}
    >
      <div className="flex aspect-square items-center justify-center overflow-hidden bg-slate-100 dark:bg-slate-800/60">
        <Thumb entry={entry} iconClassName="size-12" />
      </div>
      <div className="flex items-center gap-1 py-1.5 pr-0.5 pl-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{entry.name}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{describe(entry, showLocation)}</p>
        </div>
        <MoreButton entry={entry} onActions={onActions} />
      </div>
    </div>
  );
}

// --- List ---

export function ListView({ entries, ...rest }: ViewProps) {
  return (
    <div>
      <div className="hidden items-center gap-3 px-3 pb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase md:flex dark:text-slate-400">
        <span className="w-10" />
        <span className="flex-1">Name</span>
        <span className="w-24 text-right">Size</span>
        <span className="w-32">Uploaded</span>
        <span className="w-10" />
      </div>
      <ul className="divide-y divide-slate-200/70 overflow-hidden rounded-xl bg-white ring-1 ring-slate-900/5 dark:divide-slate-800 dark:bg-slate-900 dark:ring-white/10">
        {entries.map((entry) => (
          <ListRow key={entry.id} entry={entry} {...rest} />
        ))}
      </ul>
    </div>
  );
}

function ListRow(props: ItemProps) {
  const { entry, showLocation, onActions } = props;
  return (
    <li
      {...useItemProps(props)}
      className="touch-item flex h-16 cursor-pointer items-center gap-3 pr-1 pl-3 outline-none transition-colors [contain-intrinsic-size:auto_4rem] [content-visibility:auto] hover:bg-slate-50 focus-visible:bg-blue-50 active:bg-slate-100 dark:hover:bg-slate-800/60 dark:focus-visible:bg-blue-500/10 dark:active:bg-slate-800"
    >
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
        <Thumb entry={entry} iconClassName="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{entry.name}</span>
          <SharedBadge entry={entry} />
        </p>
        <p className="truncate text-xs text-slate-500 md:hidden dark:text-slate-400">{describe(entry, showLocation)}</p>
        {showLocation && (
          <p className="hidden truncate text-xs text-slate-500 md:block dark:text-slate-400">{locationOf(entry)}</p>
        )}
      </div>
      <span className="hidden w-24 shrink-0 text-right text-sm text-slate-500 tabular-nums md:block dark:text-slate-400">
        {entry.isDir ? (entry.childCount === null ? '—' : plural(entry.childCount, 'item')) : formatBytes(entry.size)}
      </span>
      <span className="hidden w-32 shrink-0 text-sm text-slate-500 md:block dark:text-slate-400">
        {formatDate(entry.createdAt)}
      </span>
      <MoreButton entry={entry} onActions={onActions} />
    </li>
  );
}
