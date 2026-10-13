import { create } from 'zustand';
import { parseRoute, type Page, type Route } from '../lib/route';
export type { Page } from '../lib/route';
interface UIState extends Route {
  connection: 'connecting' | 'connected' | 'offline';
  setPage: (page: Page) => void;
  setInstallation: (id: string) => void;
  selectAsset: (id: string | null) => void;
  setRoute: (route: Route) => void;
  setConnection: (state: UIState['connection']) => void;
}
// The first render already reflects a shared link (page, installation and asset).
const initial: Route =
  typeof window === 'undefined'
    ? { page: 'overview', installationId: '', selectedAssetId: null }
    : parseRoute(window.location.pathname, window.location.search);
export const useUI = create<UIState>((set) => ({
  ...initial,
  connection: 'connecting',
  setPage: (page) => set({ page }),
  setInstallation: (installationId) => set({ installationId, selectedAssetId: null }),
  selectAsset: (selectedAssetId) => set({ selectedAssetId }),
  setRoute: (route) => set(route),
  setConnection: (connection) => set({ connection }),
}));
