import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { Alert } from '@geotwin/shared';
import { useAlerts, useAssets, useSync } from '../../hooks/data';
import { useUI } from '../../stores/ui';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { Loading, ErrorState, Empty } from '../../components/common';
import { Glyph, Sim } from '../hud/glyphs';
import { count } from '../../lib/format';
import { AlertDialog } from './alert-dialog';
import { date, time } from '../../lib/utils';
import { useAlertActions } from './alert-actions';
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
  const { acknowledge } = useAlertActions();
  const total = alerts.data?.length;
  return (
    <div className="page">
      <p className="sheet-lede">
        Incidencias guardadas en PostgreSQL, con su historial. Las de telemetría vienen del
        simulador de la demo.
      </p>
      <div className="sheet-tools">
        <div className="segmented" role="group" aria-label="Incidencias">
          <button
            type="button"
            aria-pressed={status === 'active'}
            onClick={() => setStatus('active')}
          >
            Activas
          </button>
          <button
            type="button"
            aria-pressed={status === 'resolved'}
            onClick={() => setStatus('resolved')}
          >
            Resueltas
          </button>
        </div>
        <span className="f1" role="status">
          {total === undefined
            ? '—'
            : status === 'active'
              ? count(total, 'activa', 'activas')
              : count(total, 'resuelta', 'resueltas')}
        </span>
        <span className="spacer" />
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
      </div>
      {alerts.isPending ? (
        <Loading />
      ) : alerts.isError ? (
        <ErrorState error={alerts.error} retry={() => void alerts.refetch()} />
      ) : !alerts.data.length ? (
        <Empty
          text={
            status === 'active'
              ? 'Ninguna incidencia activa. Puedes simular una desde la ficha de un activo.'
              : 'Todavía no hay incidencias resueltas.'
          }
        />
      ) : (
        <table className="data data-stack alerts-table">
          <thead>
            <tr>
              <th scope="col">Severidad</th>
              <th scope="col">Activo e incidencia</th>
              <th scope="col">{status === 'active' ? 'Desde' : 'Resuelta'}</th>
              <th scope="col">Origen</th>
              {status === 'active' && <th scope="col">Reconocida</th>}
            </tr>
          </thead>
          <tbody>
            {alerts.data.map((al) => (
              <tr key={al.id} className={`alert-row alert-${al.severity}`}>
                <td>
                  <span className={`status status-${al.severity}`}>
                    <Glyph status={al.severity} />
                    {al.severity === 'critical' ? 'Crítica' : 'Advertencia'}
                  </span>
                </td>
                <td>
                  <button type="button" className="row-link" onClick={() => setIncident(al)}>
                    {al.asset_name}
                  </button>
                  <small className="f1">{al.message}</small>
                </td>
                <td className="num" data-label={status === 'active' ? 'Desde' : 'Resuelta'}>
                  {date(
                    status === 'active' ? al.triggered_at : (al.resolved_at ?? al.triggered_at),
                  )}
                </td>
                <td data-label="Origen">
                  {al.source === 'telemetry' ? <Sim /> : <Sim text="manual" />}
                </td>
                {status === 'active' && (
                  <td data-label="Reconocida">
                    {al.acknowledged_at ? (
                      <span className="num f1">{time(al.acknowledged_at)}</span>
                    ) : (
                      <button
                        type="button"
                        className="btn"
                        disabled={acknowledge.isPending}
                        aria-label={`Reconocer la alerta de ${al.asset_name}`}
                        onClick={() => acknowledge.mutate([al.id])}
                      >
                        Reconocer
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {acknowledge.isError && (
        <p role="alert" className="form-error">
          {acknowledge.error.message}
        </p>
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
