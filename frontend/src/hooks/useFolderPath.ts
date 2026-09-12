import { useCallback, useEffect, useState } from 'react';

const readPath = () => new URLSearchParams(window.location.search).get('p') ?? '';
const urlFor = (path: string) => (path ? `/?p=${encodeURIComponent(path).replace(/%2F/g, '/')}` : '/');

/** Current folder, kept in the URL (?p=Photos/2024) so reloads, links and the back button work. */
export function useFolderPath() {
  const [path, setPath] = useState(readPath);

  useEffect(() => {
    const onPop = () => setPath(readPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((next: string, { replace = false } = {}) => {
    if (replace) window.history.replaceState(null, '', urlFor(next));
    else if (next !== readPath()) window.history.pushState(null, '', urlFor(next));
    setPath(next);
  }, []);

  return [path, navigate] as const;
}
