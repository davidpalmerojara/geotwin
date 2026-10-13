import { useEffect } from 'react';
import { parseRoute, routeUrl } from '../lib/route';
import { useUI } from '../stores/ui';
/**
 * Keeps the address bar and the interface state in step. A page change adds a history
 * entry, so Back returns to the previous view; choosing an installation or an asset
 * replaces the current entry, so the link stays shareable without flooding history.
 */
export function useRouteSync() {
  const setRoute = useUI((s) => s.setRoute);
  useEffect(() => {
    const current = () => `${window.location.pathname}${window.location.search}`;
    const unsubscribe = useUI.subscribe((state, previous) => {
      const url = routeUrl(state);
      if (url === current()) return;
      if (state.page !== previous.page) window.history.pushState(null, '', url);
      else window.history.replaceState(null, '', url);
    });
    const onPop = () => setRoute(parseRoute(window.location.pathname, window.location.search));
    window.addEventListener('popstate', onPop);
    // Normalise the first URL (unknown paths or malformed ids are dropped).
    const url = routeUrl(useUI.getState());
    if (url !== current()) window.history.replaceState(null, '', url);
    return () => {
      unsubscribe();
      window.removeEventListener('popstate', onPop);
    };
  }, [setRoute]);
}
