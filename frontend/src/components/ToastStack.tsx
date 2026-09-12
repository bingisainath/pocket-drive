import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import type { Toast } from '../hooks/useToasts';

const ICON = { info: Info, success: CircleCheck, error: CircleAlert };
const COLOR = {
  info: 'text-blue-300 dark:text-blue-600',
  success: 'text-emerald-400 dark:text-emerald-600',
  error: 'text-red-400 dark:text-red-600',
};

export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      {toasts.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onDismiss(t.id)}
            className="pointer-events-auto flex max-w-full animate-sheet-down items-center gap-2.5 rounded-2xl bg-slate-900 py-3 pr-4 pl-3.5 text-left text-sm text-white shadow-xl sm:max-w-md dark:bg-white dark:text-slate-900"
          >
            <Icon className={`size-5 shrink-0 ${COLOR[t.tone]}`} />
            <span className="min-w-0 break-words">{t.message}</span>
          </button>
        );
      })}
    </div>
  );
}
