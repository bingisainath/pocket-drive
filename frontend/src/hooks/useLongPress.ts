import { useRef, type MouseEvent, type PointerEvent } from 'react';

const MOVE_TOLERANCE = 10; // px of finger drift before we treat it as a scroll
const RELEASE_CLICK_GRACE_MS = 400;

/**
 * The browser only treats a press as a long-press after its own threshold (~500–1000 ms). Lift the
 * finger after ours fired but before that, and the browser still sends a click — which would land on
 * the sheet we just opened (its backdrop or a button). Swallow that one click.
 */
function swallowReleaseClick() {
  let timer: number | undefined;
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    done();
  };
  const released = () => {
    window.removeEventListener('pointerup', released, true);
    window.removeEventListener('pointercancel', released, true);
    timer = window.setTimeout(done, RELEASE_CLICK_GRACE_MS);
  };
  const done = () => {
    window.clearTimeout(timer);
    window.removeEventListener('click', swallow, true);
    window.removeEventListener('pointerup', released, true);
    window.removeEventListener('pointercancel', released, true);
  };
  window.addEventListener('click', swallow, true);
  window.addEventListener('pointerup', released, true);
  window.addEventListener('pointercancel', released, true);
}

/** Long-press (touch) and right-click (mouse) both trigger `onLongPress`. */
export function useLongPress(onLongPress: () => void, delay = 450) {
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const touching = useRef(false);
  const fired = useRef(false);

  const cancel = () => {
    window.clearTimeout(timer.current);
    origin.current = null;
  };
  const end = () => {
    cancel();
    touching.current = false;
  };
  const trigger = () => {
    const viaTouch = touching.current;
    fired.current = true;
    cancel();
    if (viaTouch) {
      swallowReleaseClick();
      navigator.vibrate?.(10);
    }
    onLongPress();
  };

  return {
    onPointerDown: (e: PointerEvent) => {
      fired.current = false;
      touching.current = e.pointerType !== 'mouse';
      if (!touching.current) return; // mouse users get right-click and the ⋮ button
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(trigger, delay);
    },
    onPointerMove: (e: PointerEvent) => {
      const o = origin.current;
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > MOVE_TOLERANCE) cancel();
    },
    onPointerUp: end,
    onPointerCancel: end,
    onPointerLeave: end,
    // Right-click on desktop; on Android also the browser's own long-press (if it beats our timer).
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      if (!fired.current) trigger();
    },
  };
}
