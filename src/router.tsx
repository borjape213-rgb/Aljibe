import { useEffect, useState } from 'react';

export interface Route { path: string[]; query: URLSearchParams }
const read = (): Route => {
  const raw = location.hash.replace(/^#\/?/, '');
  const [p, q] = raw.split('?');
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q ?? '') };
};
export function useRoute(): Route {
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => { setR(read()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}
export const go = (path: string) => { location.hash = path.startsWith('#') ? path : `#${path}`; };
export const back = (fallback = '/') => { if (history.length > 1) history.back(); else go(fallback); };
export function setQuery(key: string, value: string | null) {
  const r = read();
  if (value === null || value === '') r.query.delete(key); else r.query.set(key, value);
  const qs = r.query.toString();
  history.replaceState(null, '', `#/${r.path.join('/')}${qs ? '?' + qs : ''}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
