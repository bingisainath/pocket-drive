import { ChevronRight, HardDrive } from 'lucide-react';
import { Fragment, useEffect, useRef, type ReactNode } from 'react';

export function Breadcrumbs({ path, onNavigate }: { path: string; onNavigate: (path: string) => void }) {
  const parts = path ? path.split('/') : [];
  const nav = useRef<HTMLElement>(null);

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
      <Crumb current={!parts.length} onClick={() => onNavigate('')} label="My Drive">
        <HardDrive className="size-4 shrink-0" />
        {/* Inside a folder on phones, the icon alone leaves room for the folder names. */}
        <span className={parts.length ? 'hidden sm:inline' : ''}>My Drive</span>
      </Crumb>
      {parts.map((name, i) => (
        <Fragment key={i}>
          <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
          <Crumb current={i === parts.length - 1} onClick={() => onNavigate(parts.slice(0, i + 1).join('/'))}>
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
