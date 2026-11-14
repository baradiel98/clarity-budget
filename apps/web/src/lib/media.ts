import { useEffect, useState } from 'react';

/** True while the viewport matches `query` (e.g. '(max-width: 760px)'); follows resizes and rotation. */
export function useMedia(query: string): boolean {
  const get = () => typeof matchMedia === 'function' && matchMedia(query).matches;
  const [match, setMatch] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Phones and narrow windows: below this, tables switch to stacked rows. Matches the CSS breakpoint. */
export const NARROW = '(max-width: 760px)';
