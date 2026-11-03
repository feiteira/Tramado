import { useEffect, useState } from 'react';

// CSS media queries read from script: the rail's icon-only width, reduced motion.

/** The query's current answer; false where matchMedia is missing (tests, old engines). */
export function mediaMatches(query: string): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia(query).matches;
}

/** Follows a media query, re-rendering when its answer changes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => mediaMatches(query));
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** The rail shows icons only at this width or below (shell.css repeats the number). */
export const NARROW_RAIL = '(max-width: 900px)';
export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Reduced motion is on when the OS asks for it or Settings → Reduce motion is "On" (UX §1.7: html[data-motion=reduce]). */
export const reducedMotion = (): boolean =>
  mediaMatches(REDUCED_MOTION) || (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduce');

/** 'smooth', or 'auto' for readers who asked for reduced motion (CSS cannot override a script's choice). */
export const scrollBehavior = (): ScrollBehavior => (reducedMotion() ? 'auto' : 'smooth');
