import { create } from 'zustand';
export type Page = 'overview' | 'twin' | 'assets' | 'alerts' | 'settings';
interface UIState {
  page: Page;
  installationId: string;
  selectedAssetId: string | null;
  connection: 'connecting' | 'connected' | 'offline';
  setPage: (page: Page) => void;
  setInstallation: (id: string) => void;
  selectAsset: (id: string | null) => void;
  setConnection: (state: UIState['connection']) => void;
}
export const useUI = create<UIState>((set) => ({
  page: 'overview',
  installationId: '',
  selectedAssetId: null,
  connection: 'connecting',
  setPage: (page) => set({ page }),
  setInstallation: (installationId) => set({ installationId, selectedAssetId: null }),
  selectAsset: (selectedAssetId) => set({ selectedAssetId }),
  setConnection: (connection) => set({ connection }),
}));
