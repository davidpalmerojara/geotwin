import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { Alert } from '@geotwin/shared';
import { useAlerts, useAssets, useSync } from '../../hooks/data';
import { useUI } from '../../stores/ui';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { SectionHeading, Loading, ErrorState, Empty } from '../../components/common';
import { AlertDialog } from './alert-dialog';
import { date } from '../../lib/utils';
import { api } from '../../lib/api';
export function Alerts() {
  const [status, setStatus] = useState('active'),
    [incident, setIncident] = useState<Alert | null>(null),
    [creating, setCreating] = useState(false);
  const selected = useUI((s) => s.selectedAssetId),
    assets = useAssets(),
    alerts = useAlerts(undefined, status),
    sync = useSync();
  const [assetId, setAssetId] = useState(''),
    [severity, setSeverity] = useState<'warning' | 'critical'>('warning'),
    [message, setMessage] = useState('');
  const create = useMutation({
    mutationFn: () => api.createAlert(assetId, severity, message),
    onSuccess: () => {
      setCreating(false);
      setMessage('');
      void sync();
    },
  });
  return (
    <div className="page">
      <SectionHeading description="Incidencias registradas en PostgreSQL, con su historial. La telemetría es simulada.">
        <Button
          onClick={() => {
            setAssetId(selected ?? assets.data?.[0]?.id ?? '');
            create.reset();
            setCreating(true);
          }}
          disabled={!assets.data?.length}
        >
          <Plus size={15} aria-hidden="true" />
          Crear incidencia
        </Button>
      </SectionHeading>
      <div className="alert-tabs">
        <button className={status === 'active' ? 'active' : ''} onClick={() => setStatus('active')}>
          Activas
        </button>
        <button
          className={status === 'resolved' ? 'active' : ''}
          onClick={() => setStatus('resolved')}
        >
          Resueltas
        </button>
        <span>Telemetría simulada · resolución persistente</span>
      </div>
      {alerts.isPending ? (
        <Loading />
      ) : alerts.isError ? (
        <ErrorState error={alerts.error} retry={() => void alerts.refetch()} />
      ) : !alerts.data.length ? (
        <section className="panel">
          <Empty
            text={
              status === 'active'
                ? 'No hay incidencias activas. Puedes simular una desde el gemelo digital.'
                : 'No hay incidencias resueltas todavía.'
            }
          />
        </section>
      ) : (
        <div className="alerts-grid">
          {alerts.data.map((al) => (
            <button
              className={`incident-card incident-${al.severity}`}
              key={al.id}
              onClick={() => setIncident(al)}
            >
              <div className="incident-card-top">
                <span className={`status status-${al.severity}`}>
                  <i className={`glyph glyph-${al.severity}`} aria-hidden="true" />
                  {al.severity === 'critical' ? 'Crítica' : 'Advertencia'}
                </span>
                <span className="pill">{al.status === 'active' ? 'Activa' : 'Resuelta'}</span>
              </div>
              <h3>{al.asset_name}</h3>
              <p>{al.message}</p>
              <footer>
                <span>{date(al.triggered_at)}</span>
                <span>
                  {al.source === 'telemetry' ? <span className="sim">simulado</span> : 'Manual'}
                </span>
              </footer>
            </button>
          ))}
        </div>
      )}
      <AlertDialog alert={incident} onClose={() => setIncident(null)} />
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogTitle className="dialog-title">Nueva incidencia</DialogTitle>
          <DialogDescription className="dialog-description">
            Se guardará en PostgreSQL y cambiará el estado del activo.
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <label className="form-label">
              Activo
              <select required value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                {assets.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Severidad
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as 'warning' | 'critical')}
              >
                <option value="warning">Advertencia</option>
                <option value="critical">Crítica</option>
              </select>
            </label>
            <label className="form-label">
              Descripción
              <textarea
                required
                minLength={5}
                maxLength={500}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe la intervención necesaria…"
              />
            </label>
            {create.isError && (
              <p role="alert" className="form-error">
                {create.error.message}
              </p>
            )}
            <Button type="submit" disabled={create.isPending || message.trim().length < 5}>
              Guardar incidencia
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
