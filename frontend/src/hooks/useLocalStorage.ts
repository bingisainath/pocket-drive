import { useCallback, useState } from 'react';

/** A string preference persisted in localStorage, restricted to known values. */
export function useLocalStorage<T extends string>(key: string, fallback: T, allowed: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return allowed.includes(stored as T) ? (stored as T) : fallback;
    } catch {
      return fallback;
    }
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // storage unavailable (private mode) — keep the in-memory value
      }
    },
    [key],
  );

  return [value, update] as const;
}
