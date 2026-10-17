// Mutations persist on the server before queries recover authoritative state.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ChevronRight, SquarePen, X } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Alert, Asset, Sensor } from '@geotwin/shared';
import { api } from '../../lib/api';
import { time } from '../../lib/utils';
import { useAlerts, useHealth, useInstallations, useLayers, useSync } from '../../hooks/data';
import { assetTypeLabel, axisTick, decimal, metricLabel, number } from '../../lib/format';
import { Loading, ErrorState, Empty } from '../../components/common';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { AlertDialog } from '../alerts/alert-dialog';
import { Glyph, Kbd, Sim, StatusWord } from '../hud/glyphs';
import { formatLatLon, formatMetres, formatUtm, geoidAt } from '../hud/readout';
import { placeCard, MARGIN, GAP } from '../hud/placement';
import { overlayBoxes } from '../hud/dom';
import { measuredGround } from '../layers/lidar-terrain';
import { useUI } from '../../stores/ui';
import { useTool } from '../../stores/tool';
import { useScene } from '../../stores/viewer';

/** The asset card: closed when nothing is selected. */
export function AssetCard() {
  const id = useUI((s) => s.selectedAssetId);
  return id ? <AssetCardBody key={id} id={id} /> : null;
}

const levelOf = (s: Sensor) =>
  s.latest_value === null
    ? 'healthy'
    : s.latest_value >= s.critical_threshold
      ? 'critical'
      : s.latest_value >= s.warning_threshold
        ? 'warning'
        : 'healthy';

/**
 * Floats the card beside its asset (or docks it to the right) on every camera move, writing the
 * position straight into the DOM, and draws the guide from the asset to the card.
 */
function usePlacement(
  card: React.RefObject<HTMLElement | null>,
  guide: React.RefObject<SVGLineElement | null>,
  asset: Asset | undefined,
) {
  const sceneApi = useScene((s) => s.api),
    relief = useScene((s) => s.relief);
  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const width = window.innerWidth,
        height = window.innerHeight;
      const top = document.querySelector('.hud-tr')?.getBoundingClientRect().bottom ?? 66;
      const bottomPlates = document.querySelector('.hud-bottom')?.getBoundingClientRect().top;
      const bottom = (bottomPlates ?? height - MARGIN) - GAP;
      const dockTop = top + GAP;
      const anchor =
        sceneApi && asset
          ? sceneApi.project(
              asset.location.lng,
              asset.location.lat,
              sceneApi.groundAt(asset.location.lng, asset.location.lat) +
                (relief ? asset.mount_height_m : 0),
            )
          : null;
      // Floating, the card is at most 560 px tall; docked, it runs from the heading plate down.
      element.style.maxHeight = `${Math.max(160, Math.min(560, bottom - MARGIN))}px`;
      const placement = placeCard({
        viewport: { width, height },
        anchor,
        card: { width: element.offsetWidth, height: element.offsetHeight },
        obstacles: overlayBoxes(document, element),
        dockTop,
        bottom,
      });
      if (placement.mode === 'dock')
        element.style.maxHeight = `${Math.max(160, bottom - dockTop)}px`;
      element.style.left = `${placement.left}px`;
      element.style.top = `${placement.top}px`;
      element.dataset.mode = placement.mode;
      const line = guide.current;
      if (line) {
        line.style.display = placement.guide ? '' : 'none';
        if (placement.guide) {
          line.setAttribute('x1', String(placement.guide.x1));
          line.setAttribute('y1', String(placement.guide.y1));
          line.setAttribute('x2', String(placement.guide.x2));
          line.setAttribute('y2', String(placement.guide.y2));
        }
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    const off = sceneApi?.onCamera(schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    window.addEventListener('resize', schedule);
    // Panels and sheets opening on the left change what the card must keep clear of.
    const hud = document.querySelector('.hud');
    const mutations = new MutationObserver((records) => {
      if (
        records.some(
          (r) => !element.contains(r.target) && !(r.target as Element).closest?.('.edge-chips'),
        )
      )
        schedule();
    });
    if (hud) mutations.observe(hud, { childList: true, subtree: true });
    return () => {
      off?.();
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [card, guide, sceneApi, asset, relief]);
}

function AssetCardBody({ id }: { id: string }) {
  const asset = useQuery({ queryKey: ['geo', 'asset', id], queryFn: () => api.asset(id) });
  const sensors = useQuery({ queryKey: ['geo', 'sensors', id], queryFn: () => api.sensors(id) });
  const alerts = useAlerts(id, 'active'),
    health = useHealth(),
    installations = useInstallations(),
    layers = useLayers().data,
    sync = useSync();
  const select = useUI((s) => s.selectAsset),
    setPage = useUI((s) => s.setPage);
  const setTool = useTool((s) => s.setTool);
  const lidar = useScene((s) => s.lidar);
  const [sensorId, setSensorId] = useState(''),
    [incident, setIncident] = useState<Alert | null>(null),
    [editing, setEditing] = useState(false),
    [name, setName] = useState('');
  const card = useRef<HTMLElement>(null),
    guide = useRef<SVGLineElement>(null);
  usePlacement(card, guide, asset.data);
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
  // The heading is announced when the card opens (once per asset, not on every refresh).
  const heading = useRef<HTMLHeadingElement>(null);
  const loadedId = asset.data?.id;
  useEffect(() => {
    if (loadedId) heading.current?.focus({ preventScroll: true });
  }, [loadedId]);
  const a = asset.data;
  const installation = installations.data?.find((i) => i.id === a?.installation_id);
  const ground = a && lidar ? measuredGround(lidar, a.location.lng, a.location.lat) : null;
  const geoid = a ? geoidAt(layers ?? [], a.location.lng, a.location.lat) : null;
  const history = readings.data ?? [];
  return (
    <>
      <svg className="card-guide" aria-hidden="true">
        <line ref={guide} style={{ display: 'none' }} />
      </svg>
      <aside
        ref={card}
        className="panel asset-card"
        aria-labelledby={a ? 'asset-card-title' : undefined}
        aria-label={a ? undefined : 'Ficha del activo'}
        data-map-overlay
        data-testid="asset-card"
        data-mode="dock"
      >
        {asset.isPending ? (
          <Loading />
        ) : asset.isError ? (
          <ErrorState error={asset.error} retry={() => void asset.refetch()} />
        ) : (
          a && (
            <>
              <header className="card-top">
                <div className="row">
                  <StatusWord status={a.status} />
                  <span className="f2" aria-hidden="true">
                    ·
                  </span>
                  <span className="f1">{assetTypeLabel[a.type]}</span>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Editar activo"
                    title="Cambiar el nombre"
                    onClick={() => {
                      setName(a.name);
                      setEditing(true);
                    }}
                  >
                    <SquarePen size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="close"
                    aria-label="Cerrar la ficha"
                    onClick={() => select(null)}
                  >
                    <span className="close-text">Cerrar</span>
                    <Kbd>Esc</Kbd>
                    <X size={14} className="close-icon" aria-hidden="true" />
                  </button>
                </div>
                <h2 id="asset-card-title" ref={heading} tabIndex={-1}>
                  {a.name}
                </h2>
                <p className="sub">
                  {installation ? `${installation.name} · ` : ''}instalación ficticia
                </p>
                <dl className="kv">
                  <dt>Posición</dt>
                  <dd className="num">{formatLatLon(a.location.lat, a.location.lng)}</dd>
                  <dt>UTM 30N</dt>
                  <dd className="num">{formatUtm(a.location.lng, a.location.lat)}</dd>
                  <dt>Suelo (MDT)</dt>
                  <dd className="num">
                    {ground !== null && geoid !== null
                      ? formatMetres(ground - geoid)
                      : '— (fuera de las hojas LiDAR o sin relieve)'}
                    {' · '}
                    {a.mount_height_m > 0
                      ? `a ${number(a.mount_height_m, 1)} m sobre el suelo`
                      : 'montaje a ras de suelo'}
                  </dd>
                </dl>
              </header>
              <section className="meters" aria-label="Lecturas">
                {sensors.isPending ? (
                  <Loading />
                ) : sensors.isError ? (
                  <ErrorState error={sensors.error} />
                ) : sensors.data.length ? (
                  sensors.data.map((s) => (
                    <div className={`meter meter-${levelOf(s)}`} key={s.id} data-testid="meter">
                      <div className="meter-name">
                        {metricLabel(s.metric_type)}
                        <Sim />
                      </div>
                      <div className="meter-value num">
                        {s.latest_value === null
                          ? '—'
                          : number(s.latest_value, Math.abs(s.latest_value) < 10 ? 2 : 1)}
                        <small>{s.unit}</small>
                      </div>
                      <div className="meter-th num">
                        Advertencia ≥ {decimal(s.warning_threshold)} {s.unit}
                        <br />
                        Crítico ≥ {decimal(s.critical_threshold)} {s.unit}
                      </div>
                      <div className="meter-time">
                        {s.latest_at ? `lectura de las ${time(s.latest_at)}` : 'sin lectura'}
                      </div>
                    </div>
                  ))
                ) : (
                  <Empty text="No hay sensores asignados." />
                )}
              </section>
              <section className="card-sec">
                <h3>
                  Histórico
                  {sensors.data && sensors.data.length > 1 && (
                    <span className="segmented" role="group" aria-label="Sensor del histórico">
                      {sensors.data.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          aria-pressed={s.id === selected?.id}
                          onClick={() => {
                            setSensorId(s.id);
                            simulate.reset();
                          }}
                        >
                          {metricLabel(s.metric_type)}
                        </button>
                      ))}
                    </span>
                  )}
                </h3>
                <div className="card-chart">
                  {readings.isPending ? (
                    <Loading />
                  ) : readings.isError ? (
                    <ErrorState error={readings.error} />
                  ) : history.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={history} margin={{ top: 8, right: 18, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="#363531" vertical={false} />
                        <XAxis
                          dataKey="recorded_at"
                          tickFormatter={(v) => time(String(v)).slice(0, 5)}
                          minTickGap={60}
                          tick={{ fill: '#BAB6AC', fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tickFormatter={axisTick}
                          tick={{ fill: '#BAB6AC', fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                          width={34}
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
                            background: '#0E0E0D',
                            border: '1px solid #706D64',
                            borderRadius: 2,
                            color: '#EEECE6',
                          }}
                        />
                        {selected && (
                          <>
                            <ReferenceLine
                              y={selected.warning_threshold}
                              stroke="#FF9F1A"
                              strokeDasharray="4 3"
                            />
                            <ReferenceLine
                              y={selected.critical_threshold}
                              stroke="#FF5A4C"
                              strokeDasharray="4 3"
                            />
                          </>
                        )}
                        <Line
                          isAnimationActive={false}
                          type="monotone"
                          dataKey="value"
                          stroke="#EEECE6"
                          strokeWidth={1.5}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <Empty text="Sin histórico disponible." />
                  )}
                </div>
                {history.length > 0 && (
                  <p className="card-note num">
                    {history.length} lecturas · de {time(history[0]!.recorded_at)} a{' '}
                    {time(history.at(-1)!.recorded_at)} ·{' '}
                    <span className="threshold-key warn">— advertencia</span>{' '}
                    <span className="threshold-key alarm">— crítico</span>
                  </p>
                )}
              </section>
              <section className="card-sec">
                <h3>
                  Incidencias activas <span className="r num">{alerts.data?.length ?? '—'}</span>
                </h3>
                {alerts.isError ? (
                  <ErrorState error={alerts.error} />
                ) : alerts.data?.length ? (
                  alerts.data.map((al) => (
                    <div className={`incident incident-${al.severity}`} key={al.id}>
                      <button
                        type="button"
                        className="incident-open"
                        onClick={() => setIncident(al)}
                      >
                        <Glyph status={al.severity} />
                        <span>
                          <strong>
                            {al.severity === 'critical' ? 'Alerta crítica' : 'Advertencia'}
                          </strong>
                          <span className="incident-msg">{al.message}</span>
                          <span className="incident-meta">
                            desde las {time(al.triggered_at)} ·{' '}
                            {al.source === 'telemetry' ? 'telemetría simulada' : 'registro manual'}
                          </span>
                        </span>
                        <ChevronRight size={14} aria-hidden="true" />
                      </button>
                      <div className="row">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setPage('alerts')}
                        >
                          Ver en Alertas
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="quiet">Sin incidencias activas.</p>
                )}
              </section>
              <section className="card-sec">
                <h3>
                  Cercanos <span className="r">ST_DWithin · PostGIS</span>
                </h3>
                <div className="row">
                  <button type="button" className="btn" onClick={() => setTool('radius')}>
                    Activos a menos de… <Kbd>5</Kbd>
                  </button>
                </div>
              </section>
              {health.data?.demo_mode && (
                <section className="card-sec">
                  <h3>
                    Laboratorio de anomalías <span className="r">solo simulación</span>
                  </h3>
                  <p className="card-note">
                    Inyecta una lectura en{' '}
                    {selected ? metricLabel(selected.metric_type).toLowerCase() : 'el sensor'} y
                    mantiene el fallo hasta resolver su incidencia. Datos simulados.
                  </p>
                  <div className="row">
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
                    <p role="alert" className="form-error">
                      {simulate.error.message}
                    </p>
                  )}
                  {simulate.isSuccess && (
                    <p role="status" className="card-note">
                      Anomalía guardada y emitida a la red.
                    </p>
                  )}
                </section>
              )}
              <footer className="card-foot">
                Actualizado a las {time(a.updated_at)} · PostgreSQL / PostGIS
              </footer>
            </>
          )
        )}
      </aside>
      <AlertDialog alert={incident} onClose={() => setIncident(null)} />
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogTitle className="dialog-title">Editar activo</DialogTitle>
          <DialogDescription className="dialog-description">
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
              <p role="alert" className="form-error">
                {rename.error.message}
              </p>
            )}
            <Button type="submit" disabled={rename.isPending || !name.trim()}>
              Guardar cambios
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
