import { useCallback, useState } from 'react';

export type ToastTone = 'info' | 'success' | 'error';
export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

let seq = 0;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = ++seq;
      setToasts((list) => [...list.slice(-2), { id, message, tone }]);
      window.setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 3000);
    },
    [dismiss],
  );

  return { toasts, toast, dismiss };
}
