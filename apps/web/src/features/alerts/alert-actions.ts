import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useSync } from '../../hooks/data';

/** The «R» key asks the open asset card to acknowledge its alerts (see use-shortcuts.ts). */
export const ACKNOWLEDGE_EVENT = 'geotwin:acknowledge';

/**
 * «Reconocer» and «Resolver» on an alert. Acknowledging stops the pulse in the scene and keeps
 * the beam; resolving closes the alert, and the beam goes with it. Both are idempotent on the
 * server, and the realtime events refresh every other view.
 */
export function useAlertActions() {
  const sync = useSync();
  const acknowledge = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api.acknowledge(id))),
    onSuccess: () => void sync(),
  });
  const resolve = useMutation({
    mutationFn: (id: string) => api.resolve(id),
    onSuccess: () => void sync(),
  });
  return { acknowledge, resolve };
}
