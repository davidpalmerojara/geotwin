import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useUI } from '../stores/ui';
export const useAssets = () => {
  const id = useUI((s) => s.installationId);
  return useQuery({
    queryKey: ['geo', 'assets', id],
    queryFn: () => api.assets(id),
    // Changing installation keeps the previous list until the new one arrives, so the
    // 3D viewer (and its WebGL context, layers and camera) is never unmounted.
    placeholderData: keepPreviousData,
  });
};
export const useInstallations = () =>
  useQuery({ queryKey: ['geo', 'installations'], queryFn: api.installations, staleTime: 60000 });
export const useSummary = () => {
  const id = useUI((s) => s.installationId);
  return useQuery({
    queryKey: ['geo', 'summary', id],
    queryFn: () => api.summary(id),
    placeholderData: keepPreviousData,
  });
};
export const useHealth = () =>
  useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 30000 });
export const useAlerts = (asset_id?: string, status?: string) => {
  const id = useUI((s) => s.installationId);
  return useQuery({
    queryKey: ['geo', 'alerts', id, asset_id, status],
    queryFn: () => api.alerts({ installation_id: id, asset_id, status }),
    placeholderData: keepPreviousData,
  });
};
export function useSync() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['geo'] });
}
