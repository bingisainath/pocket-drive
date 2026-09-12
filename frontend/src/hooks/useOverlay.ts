import { useCallback, useEffect, useRef } from 'react';

const stack: symbol[] = [];
let scrollLocks = 0;

/**
 * For modal layers (dialogs, sheets, the previewer): Escape closes only the top-most layer and the
 * page behind stops scrolling. Returns `isTop()` for layers with their own keyboard shortcuts.
 */
export function useOverlay(onClose: () => void) {
  const onCloseRef = useRef(onClose);
  const idRef = useRef<symbol | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const id = Symbol('overlay');
    idRef.current = id;
    stack.push(id);
    if (scrollLocks++ === 0) document.documentElement.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack.at(-1) === id) onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(id), 1);
      if (--scrollLocks === 0) document.documentElement.style.overflow = '';
    };
  }, []);

  return useCallback(() => idRef.current !== null && stack.at(-1) === idRef.current, []);
}
