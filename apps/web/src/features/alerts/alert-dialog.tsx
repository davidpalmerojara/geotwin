import { useQuery, useMutation } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import type { Alert } from '@geotwin/shared';
import { api } from '../../lib/api';
import { date } from '../../lib/utils';
import { useSync } from '../../hooks/data';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { Glyph, Sim } from '../hud/glyphs';
// Mutations persist on the server before queries recover authoritative state.
export function AlertDialog({
  alert: selectedAlert,
  onClose,
}: {
  alert: Alert | null;
  onClose: () => void;
}) {
  const fresh = useQuery({
    queryKey: ['geo', 'incident', selectedAlert?.id],
    queryFn: () => api.alert(selectedAlert!.id),
    enabled: !!selectedAlert,
  });
  const alert = fresh.data ?? selectedAlert;
  const sync = useSync();
  const resolve = useMutation({
    mutationFn: () => api.resolve(alert!.id),
    onSuccess: () => {
      void sync();
      onClose();
    },
  });
  return (
    <Dialog
      open={!!selectedAlert}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          resolve.reset();
        }
      }}
    >
      <DialogContent>
        <DialogTitle className="dialog-title">Detalle de incidencia</DialogTitle>
        <DialogDescription className="dialog-description">
          Registro operativo persistido en PostgreSQL
        </DialogDescription>
        {alert && (
          <>
            <div className="incident-facts">
              <span className={`status status-${alert.severity}`}>
                <Glyph status={alert.severity} />
                {alert.severity === 'critical' ? 'Crítica' : 'Advertencia'}
                {alert.source === 'telemetry' && <Sim />}
              </span>
              <strong>{alert.asset_name}</strong>
              <p>{alert.message}</p>
              <small>
                Origen: {alert.source === 'telemetry' ? 'Telemetría simulada' : 'Registro manual'}
                <br />
                Inicio: {date(alert.triggered_at)}
                <br />
                ID: {alert.id}
                {alert.resolved_at && (
                  <>
                    <br />
                    Resolución: {date(alert.resolved_at)}
                  </>
                )}
              </small>
            </div>
            {resolve.isError && (
              <p role="alert" className="form-error">
                {resolve.error.message}
              </p>
            )}
            <div className="dialog-actions">
              <Button variant="outline" onClick={onClose}>
                Cerrar
              </Button>
              {alert.status === 'active' && (
                <Button disabled={resolve.isPending} onClick={() => resolve.mutate()}>
                  <Check size={15} aria-hidden="true" />
                  {resolve.isPending ? 'Resolviendo…' : 'Marcar como resuelta'}
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
