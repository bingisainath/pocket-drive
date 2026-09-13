import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOverlay } from '../hooks/useOverlay';

/** Bottom sheet on phones, centered dialog on larger screens. */
export function Modal({
  label,
  onClose,
  wide = false,
  children,
}: {
  label: string;
  onClose: () => void;
  /** Roomier dialog on larger screens (lists of people, activity). */
  wide?: boolean;
  children: ReactNode;
}) {
  useOverlay(onClose);
  // Close only on a press that started on the backdrop — not on a stray click from the gesture
  // that opened the dialog, or a text selection that ends outside it.
  const pressedBackdrop = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  // Whatever had focus before the dialog opened (read during the first render, before any
  // autoFocus field inside the dialog takes focus).
  const [opener] = useState(() => document.activeElement as HTMLElement | null);

  // Move focus into the dialog, so keys like Escape and Enter act on it rather than on the button
  // behind it; give focus back to the opener when it closes.
  useEffect(() => {
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [opener]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
    >
      <div
        className="absolute inset-0 animate-fade-in bg-slate-950/40 dark:bg-black/60"
        onPointerDown={() => (pressedBackdrop.current = true)}
        onClick={() => {
          if (pressedBackdrop.current) onClose();
          pressedBackdrop.current = false;
        }}
      />
      <div
        ref={panel}
        tabIndex={-1}
        className={`relative max-h-[90dvh] w-full animate-sheet-up overflow-y-auto rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none sm:rounded-3xl sm:pb-0 dark:bg-slate-900 ${wide ? 'sm:max-w-lg' : 'sm:max-w-md'}`}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
