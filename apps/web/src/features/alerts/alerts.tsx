import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CircleAlert, Plus, ShieldCheck } from 'lucide-react';
import type { Alert } from '@geotwin/shared';
import { useAlerts, useAssets, useSync } from '../../hooks/data';
import { useUI } from '../../stores/ui';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { SectionHeading, Loading, ErrorState, Empty } from '../../components/common';
import { AlertDialog } from '../assets/asset-detail';
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
      <SectionHeading
        eyebrow="INCIDENT MANAGEMENT"
        title="Cada señal, una acción"
        description="Detecta anomalías, registra incidencias y conserva un historial auditable."
      >
        <Button
          onClick={() => {
            setAssetId(selected ?? assets.data?.[0]?.id ?? '');
            create.reset();
            setCreating(true);
          }}
          disabled={!assets.data?.length}
        >
          <Plus size={16} />
          Crear incidencia
        </Button>
      </SectionHeading>
      <div className="alert-tabs">
        <button className={status === 'active' ? 'active' : ''} onClick={() => setStatus('active')}>
          <CircleAlert size={16} />
          Activas
        </button>
        <button
          className={status === 'resolved' ? 'active' : ''}
          onClick={() => setStatus('resolved')}
        >
          <ShieldCheck size={16} />
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
                ? 'No hay incidencias activas. Puedes simular una desde Digital Twin.'
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
                <span className={`severity-${al.severity}`}>
                  <CircleAlert size={13} />
                  {al.severity === 'critical' ? 'CRÍTICA' : 'ADVERTENCIA'}
                </span>
                <span className="pill">{al.status === 'active' ? 'Activa' : 'Resuelta'}</span>
              </div>
              <h2>{al.asset_name}</h2>
              <p>{al.message}</p>
              <footer>
                <span>{date(al.triggered_at)}</span>
                <span>{al.source === 'telemetry' ? 'Sensor · simulado' : 'Manual'}</span>
              </footer>
            </button>
          ))}
        </div>
      )}
      <AlertDialog alert={incident} onClose={() => setIncident(null)} />
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogTitle className="text-xl font-semibold">Nueva incidencia</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-slate-400">
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
              <p role="alert" className="text-red-300">
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
