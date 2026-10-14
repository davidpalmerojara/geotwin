// Mutations persist on the server before queries recover authoritative state.
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Box,
  ChevronRight,
  MapPin,
  Radio,
  Zap,
  TriangleAlert,
  Check,
  SquarePen,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from 'recharts';
import { api } from '../../lib/api';
import { time, date } from '../../lib/utils';
import { useAlerts, useHealth, useInstallations, useSync } from '../../hooks/data';
import {
  assetTypeLabel,
  axisTick,
  coordinates,
  decimal,
  metricLabel,
  number,
} from '../../lib/format';
import { Status, Loading, ErrorState, Empty } from '../../components/common';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import type { Alert } from '@geotwin/shared';
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
        <DialogTitle className="text-xl font-semibold">Detalle de incidencia</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-slate-400">
          Registro operativo persistido en PostgreSQL
        </DialogDescription>
        {alert && (
          <>
            <div className="incident-facts">
              <span className={`severity-${alert.severity}`}>
                {alert.severity === 'critical' ? 'Crítica' : 'Advertencia'}
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
              <p role="alert" className="text-sm text-red-300">
                {resolve.error.message}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={onClose}>
                Cerrar
              </Button>
              {alert.status === 'active' && (
                <Button disabled={resolve.isPending} onClick={() => resolve.mutate()}>
                  <Check size={16} />
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
export function AssetDetail({ id }: { id: string | null }) {
  if (!id)
    return (
      <aside className="detail-panel detail-empty" aria-label="Inspector de activos">
        <div className="empty-orbit">
          <Box size={32} />
        </div>
        <span className="eyebrow">INSPECTOR DE ACTIVOS</span>
        <h2>Cada activo cuenta una historia.</h2>
        <p>
          Selecciona un marcador o un activo para consultar sus sensores, histórico e incidencias.
        </p>
        <div className="detail-empty-note">
          <MapPin size={16} />
          Datos operativos simulados
          <br />
          Coordenadas geográficas reales
        </div>
      </aside>
    );
  return <AssetInspector key={id} id={id} />;
}
function AssetInspector({ id }: { id: string }) {
  const asset = useQuery({ queryKey: ['geo', 'asset', id], queryFn: () => api.asset(id) });
  const sensors = useQuery({ queryKey: ['geo', 'sensors', id], queryFn: () => api.sensors(id) });
  const alerts = useAlerts(id, 'active'),
    health = useHealth(),
    installations = useInstallations(),
    sync = useSync();
  const [sensorId, setSensorId] = useState(''),
    [incident, setIncident] = useState<Alert | null>(null),
    [editing, setEditing] = useState(false),
    [name, setName] = useState('');
  const selected = sensors.data?.find((s) => s.id === sensorId) ?? sensors.data?.[0];
  const readings = useQuery({
    queryKey: ['geo', 'readings', id, selected?.id],
    queryFn: () => api.readings(id, selected?.id),
    enabled: !!selected,
  });
  const simulate = useMutation({
    mutationFn: (mode: 'warning' | 'critical') => api.simulate(selected!.id, mode),
    onSuccess: () => void sync(),
  });
  const rename = useMutation({
    mutationFn: () => api.rename(id, name),
    onSuccess: () => {
      setEditing(false);
      void sync();
    },
  });
  if (asset.isPending)
    return (
      <aside className="detail-panel" aria-label="Inspector de activos">
        <Loading />
      </aside>
    );
  if (asset.isError)
    return (
      <aside className="detail-panel" aria-label="Inspector de activos">
        <ErrorState error={asset.error} retry={() => void asset.refetch()} />
      </aside>
    );
  const a = asset.data;
  const installation = installations.data?.find((i) => i.id === a.installation_id);
  return (
    <aside className="detail-panel" aria-label="Inspector de activos">
      <div className="detail-heading">
        <span className="eyebrow">INSPECTOR DE ACTIVOS</span>
        <span className="pill">#{a.id.slice(-4)}</span>
      </div>
      <div className="asset-hero">
        <div className={`hero-box dot-${a.status}`}>
          <Box size={27} />
        </div>
        <div>
          <h2>{a.name}</h2>
          <p>
            {assetTypeLabel[a.type]}
            {installation ? ` · ${installation.name}` : ''}
          </p>
        </div>
        <Button
          aria-label="Editar activo"
          variant="ghost"
          size="icon"
          onClick={() => {
            setName(a.name);
            setEditing(true);
          }}
        >
          <SquarePen size={16} />
        </Button>
      </div>
      <Status status={a.status} />
      <div className="coordinates">
        <MapPin size={13} />
        {coordinates(a.location.lat, a.location.lng)}
        {a.mount_height_m > 0 && ` · a ${number(a.mount_height_m, 1)} m sobre el suelo`}
      </div>
      <div className="detail-section">
        <div className="detail-section-title">
          <h3>Sensores del activo</h3>
          <Radio size={15} />
        </div>
        {sensors.isPending ? (
          <Loading />
        ) : sensors.isError ? (
          <ErrorState error={sensors.error} />
        ) : sensors.data.length ? (
          <div className="sensor-list">
            {sensors.data.map((s) => (
              <button
                key={s.id}
                className={`sensor-card ${s.id === selected?.id ? 'selected' : ''}`}
                onClick={() => {
                  setSensorId(s.id);
                  simulate.reset();
                }}
              >
                <div>
                  <span>{metricLabel(s.metric_type)}</span>
                  <small>{s.latest_at ? time(s.latest_at) : 'Sin lectura'}</small>
                </div>
                <strong>
                  {s.latest_value === null ? '—' : number(s.latest_value, 1)}
                  <small>{s.unit}</small>
                  <em className="sim-tag" title="Lectura generada por el simulador de la demo">
                    simulado
                  </em>
                </strong>
              </button>
            ))}
          </div>
        ) : (
          <Empty text="No hay sensores asignados." />
        )}
      </div>
      <div className="detail-section">
        <div className="detail-section-title">
          <h3>Histórico del sensor</h3>
          <span>120 lecturas</span>
        </div>
        <div className="detail-chart">
          {readings.isPending ? (
            <Loading />
          ) : readings.isError ? (
            <ErrorState error={readings.error} />
          ) : readings.data.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={readings.data}>
                <XAxis
                  dataKey="recorded_at"
                  tickFormatter={(v) => time(String(v)).slice(0, 5)}
                  minTickGap={60}
                  tick={{ fill: '#8293a8', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={axisTick}
                  tick={{ fill: '#8293a8', fontSize: 10 }}
                  width={25}
                  domain={[0, 'auto']}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={(v) => time(String(v))}
                  formatter={(v) => [
                    `${number(Number(v), 2)} ${selected?.unit ?? ''}`,
                    'Lectura simulada',
                  ]}
                  contentStyle={{
                    background: '#111c2d',
                    border: '1px solid #304158',
                    borderRadius: 8,
                  }}
                />
                {selected && (
                  <>
                    <ReferenceLine
                      y={selected.warning_threshold}
                      stroke="#fbbf24"
                      strokeDasharray="3 3"
                    />
                    <ReferenceLine
                      y={selected.critical_threshold}
                      stroke="#fb7185"
                      strokeDasharray="3 3"
                    />
                  </>
                )}
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="value"
                  stroke="#22d3ee"
                  fill="#22d3ee"
                  fillOpacity={0.08}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Empty text="Sin histórico disponible." />
          )}
        </div>
        {selected && (
          <div className="thresholds">
            <span>
              Advertencia ≥ {decimal(selected.warning_threshold)} {selected.unit}
            </span>
            <span>
              Crítico ≥ {decimal(selected.critical_threshold)} {selected.unit}
            </span>
          </div>
        )}
      </div>
      <div className="detail-section">
        <div className="detail-section-title">
          <h3>Incidencias activas</h3>
          <span>{alerts.data?.length ?? '—'}</span>
        </div>
        {alerts.isError ? (
          <ErrorState error={alerts.error} />
        ) : alerts.data?.length ? (
          alerts.data.map((al) => (
            <button className="detail-alert" key={al.id} onClick={() => setIncident(al)}>
              <TriangleAlert
                size={17}
                className={al.severity === 'critical' ? 'text-rose-400' : 'text-amber-400'}
              />
              <div>
                <strong>{al.severity === 'critical' ? 'Alerta crítica' : 'Advertencia'}</strong>
                <p>{al.message}</p>
              </div>
              <ChevronRight size={15} />
            </button>
          ))
        ) : (
          <p className="quiet-note">
            <Check size={14} />
            Sin incidencias activas
          </p>
        )}
      </div>
      {health.data?.demo_mode && (
        <div className="demo-control">
          <div>
            <Zap size={16} />
            <strong>Laboratorio de anomalías</strong>
          </div>
          <p>
            Inyecta una lectura y mantiene el fallo hasta resolver su incidencia. Datos simulados.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!selected || simulate.isPending}
              onClick={() => simulate.mutate('warning')}
            >
              Advertencia
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!selected || simulate.isPending}
              onClick={() => simulate.mutate('critical')}
            >
              Simular fallo
            </Button>
          </div>
          {simulate.isError && (
            <p role="alert" className="text-red-300">
              {simulate.error.message}
            </p>
          )}
          {simulate.isSuccess && (
            <p role="status" className="text-cyan-300">
              Anomalía guardada y emitida a la red.
            </p>
          )}
        </div>
      )}
      <div className="detail-footer">Actualizado {time(a.updated_at)} · PostgreSQL / PostGIS</div>
      <AlertDialog alert={incident} onClose={() => setIncident(null)} />
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogTitle className="text-xl font-semibold">Editar activo</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-slate-400">
            El nombre se guarda en PostgreSQL y se actualiza en todas las vistas.
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              rename.mutate();
            }}
          >
            <label className="form-label">
              Nombre
              <input
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {rename.isError && (
              <p role="alert" className="text-red-300">
                {rename.error.message}
              </p>
            )}
            <Button type="submit" disabled={rename.isPending || !name.trim()}>
              Guardar cambios
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
