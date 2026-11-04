// How palette rows navigate. A palette provider is created from the services alone (registry PALETTE_PROVIDERS),
// so it has no router: rows call `navigate(route)`, which
//   1. uses the `go` the palette frame passes in its search context (contract change requested from UI-SHELL), else
//   2. dispatches a cancelable `tramado:navigate` window event (a shell listener calls go and preventDefault), else
//   3. calls the router's `go` that the last mounted UI-DOCS screen registered (RouterProvider's go is stable for the
//      whole ready phase).
import { useEffect } from 'react';
import { useRouter } from '../../shell/router';
import type { Route } from '../../shell/routes';

let registered: ((r: Route) => void) | null = null;

/** Lets palette rows navigate even when the palette frame does not pass `go` (call it in screens of this package). */
export function useNavigatorRegistration(): void {
  const { go } = useRouter();
  useEffect(() => {
    registered = go;
  }, [go]);
}

export const NAVIGATE_EVENT = 'tramado:navigate';

/** Goes to `route`; false when nothing could navigate (no frame `go`, no listener, no registered router). */
export function navigate(route: Route, go?: ((r: Route) => void) | null): boolean {
  if (go) {
    go(route);
    return true;
  }
  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
    const ev = new CustomEvent<Route>(NAVIGATE_EVENT, { detail: route, cancelable: true });
    window.dispatchEvent(ev);
    if (ev.defaultPrevented) return true;
  }
  if (registered) {
    registered(route);
    return true;
  }
  return false;
}
