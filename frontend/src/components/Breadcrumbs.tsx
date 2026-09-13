import { ChevronRight, HardDrive, Users } from 'lucide-react';
import { Fragment, useEffect, useRef, type ReactNode } from 'react';

interface Props {
  path: string;
  /**
   * Folders above this path are hidden (and the root crumb links past them). The owner uses '';
   * members use the parent of the folder shared with them, so private parents never show.
   */
  base: string;
  /** "My Drive" for the owner, "Shared with me" for everyone else. */
  shared: boolean;
  onNavigate: (path: string) => void;
}

export function Breadcrumbs({ path, base, shared, onNavigate }: Props) {
  const below = base && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : base === path ? '' : path;
  const parts = below ? below.split('/') : [];
  const nav = useRef<HTMLElement>(null);
  const rootLabel = shared ? 'Shared with me' : 'My Drive';
  const RootIcon = shared ? Users : HardDrive;

  // Deep paths overflow on phones: keep the current folder in view.
  useEffect(() => {
    nav.current?.scrollTo({ left: nav.current.scrollWidth });
  }, [path]);

  return (
    <nav
      ref={nav}
      aria-label="Folder path"
      className="flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <Crumb current={!path} onClick={() => onNavigate('')} label={rootLabel}>
        <RootIcon className="size-4 shrink-0" />
        {/* Inside a folder on phones, the icon alone leaves room for the folder names. */}
        <span className={parts.length ? 'hidden sm:inline' : ''}>{rootLabel}</span>
      </Crumb>
      {parts.map((name, i) => (
        <Fragment key={i}>
          <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
          <Crumb
            current={i === parts.length - 1}
            onClick={() => onNavigate([base, ...parts.slice(0, i + 1)].filter(Boolean).join('/'))}
          >
            <span className="max-w-48 truncate">{name}</span>
          </Crumb>
        </Fragment>
      ))}
    </nav>
  );
}

function Crumb({
  current,
  onClick,
  label,
  children,
}: {
  current: boolean;
  onClick: () => void;
  label?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={current}
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm whitespace-nowrap transition ${
        current
          ? 'font-semibold text-slate-900 dark:text-white'
          : 'text-slate-500 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}
