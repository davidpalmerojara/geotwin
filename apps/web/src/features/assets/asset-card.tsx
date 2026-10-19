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
import {
  useAlerts,
  useAssets,
  useHealth,
  useInstallations,
  useLayers,
  useSync,
} from '../../hooks/data';
import {
  assetTypeLabel,
  axisTick,
  decimal,
  metricLabel,
  number,
  withoutSimulatedSuffix,
} from '../../lib/format';
import { Loading, ErrorState, Empty } from '../../components/common';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { AlertDialog } from '../alerts/alert-dialog';
import { ACKNOWLEDGE_EVENT, useAlertActions } from '../alerts/alert-actions';
import { sensorLevel } from '../scene/tag-data';
import { Glyph, Kbd, Sim, StatusWord } from '../hud/glyphs';
import { formatLatLon, formatMetres, formatUtm, geoidAt } from '../hud/readout';
import { placeCard, MARGIN, GAP } from '../hud/placement';
import { distanceLabelBox } from '../section/radius-label';
import { focusScene, overlayBoxes } from '../hud/dom';
import { measuredGround } from '../layers/lidar-terrain';
import { useUI } from '../../stores/ui';
import { useTool } from '../../stores/tool';
import { useScene, type SceneApi } from '../../stores/viewer';
import { usePhone } from '../../hooks/media';
import { BottomSheet, useSnap } from '../hud/bottom-sheet';
import { RadiusList, RadiusSelect } from '../hud/radius-panel';

/** The asset card: closed when nothing is selected. */
export function AssetCard() {
  const id = useUI((s) => s.selectedAssetId);
  return id ? <AssetCardBody key={id} id={id} /> : null;
}

const levelOf = (s: Sensor) => sensorLevel(s);

/** Radio's results on screen (other than the selected asset): the card leaves them in sight. */
function radiusKeep(sceneApi: SceneApi | null, mounts: Map<string, number>) {
  const { radius, tool } = useTool.getState();
  if (!sceneApi || !radius || tool !== 'radius') return [];
  const selected = useUI.getState().selectedAssetId;
  return radius.items.flatMap((item) => {
    if (item.id === selected) return [];
    const ground = sceneApi.groundAt(item.lng, item.lat);
    const p = sceneApi.project(item.lng, item.lat, ground);
    // The leader ends (and its distance label hangs) at the asset's mounting height.
    const end = sceneApi.project(item.lng, item.lat, ground + (mounts.get(item.id) ?? 0) + 1);
    return [
      ...(p ? [{ x: p.x, y: p.y }] : []),
      ...(end ? [{ x: end.x, y: end.y }, distanceLabelBox(end, item.distance_m)] : []),
    ];
  });
}

/**
 * Floats the card beside its asset (or docks it to the right) on every camera move, writing the
 * position straight into the DOM, and draws the guide from the asset to the card.
 */
function usePlacement(
  card: React.RefObject<HTMLElement | null>,
  guide: React.RefObject<SVGLineElement | null>,
  asset: Asset | undefined,
  phone: boolean,
) {
  const sceneApi = useScene((s) => s.api),
    relief = useScene((s) => s.relief);
  // Mounting heights by asset, for Radio's leaders and labels (read when placing, not a dependency).
  const assets = useAssets().data;
  const mounts = useRef(new Map<string, number>());
  useEffect(() => {
    mounts.current = new Map((assets ?? []).map((a) => [a.id, a.mount_height_m]));
  }, [assets]);
  useLayoutEffect(() => {
    const element = card.current;
    // On a phone the card is a bottom sheet: nothing to place.
    if (!element || phone) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const width = window.innerWidth,
        height = window.innerHeight;
      // Under the heading plate and «Encuadre inicial»: the «Cota m» ruler below them moves aside.
      const rows = document.querySelectorAll('.hud-tr > .hud-tr-row');
      const top = rows[rows.length - 1]?.getBoundingClientRect().bottom ?? 66;
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
        keep: radiusKeep(sceneApi, mounts.current),
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
  }, [card, guide, sceneApi, asset, relief, phone]);
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
  // Radio around this asset: its result goes under «Cercanos».
  const nearbyResult = useTool((s) =>
    s.tool === 'radius' && s.radius && !s.radiusPoint ? s.radius : null,
  );
  const lidar = useScene((s) => s.lidar);
  const [sensorId, setSensorId] = useState(''),
    [incident, setIncident] = useState<Alert | null>(null),
    [editing, setEditing] = useState(false),
    [name, setName] = useState('');
  const card = useRef<HTMLElement>(null),
    guide = useRef<SVGLineElement>(null);
  const phone = usePhone();
  const [snap, setSnap] = useSnap(45);
  const historyRef = useRef<HTMLElement>(null),
    labRef = useRef<HTMLElement>(null);
  usePlacement(card, guide, asset.data, phone);
  // Closed (Esc, «Cerrar») with the focus inside it or on the page body: to the scene, where
  // the arrows move the camera and Tab reaches the list of assets, not back to the page's start.
  useEffect(() => {
    const element = card.current;
    return () => {
      if (element?.isConnected || useUI.getState().selectedAssetId) return;
      const active = document.activeElement;
      if (!active || active === document.body || element?.contains(active)) focusScene();
    };
  }, []);
  const selected = sensors.data?.find((s) => s.id === sensorId) ?? sensors.data?.[0];
  const readings = useQuery({
    queryKey: ['geo', 'readings', id, selected?.id],
    queryFn: () => api.readings(id, selected?.id),
    enabled: !!selected,
  });
  const { acknowledge, resolve } = useAlertActions();
  const pending = (alerts.data ?? []).filter((al) => !al.acknowledged_at).map((al) => al.id);
  const pendingKey = pending.join(',');
  // «R» acknowledges the alerts of this card's asset.
  useEffect(() => {
    if (!pendingKey) return;
    const onAcknowledge = () => acknowledge.mutate(pendingKey.split(','));
    window.addEventListener(ACKNOWLEDGE_EVENT, onAcknowledge);
    return () => window.removeEventListener(ACKNOWLEDGE_EVENT, onAcknowledge);
  }, [pendingKey, acknowledge]);
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
  const lastReading = sensors.data
    ?.map((s) => s.latest_at)
    .filter((t): t is string => !!t)
    .sort()
    .at(-1);
  // Histórico and Laboratorio raise the phone sheet to 90 % and scroll to their section.
  const reveal = (section: React.RefObject<HTMLElement | null>) => {
    setSnap(90);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        section.current?.scrollIntoView({ block: 'start' });
        section.current?.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
      }),
    );
  };
  const incidents = (
    <section className="card-sec" aria-labelledby="card-incidents">
      <h3 id="card-incidents">
        Incidencias activas <span className="r num">{alerts.data?.length ?? '—'}</span>
      </h3>
      {alerts.isError ? (
        <ErrorState error={alerts.error} />
      ) : alerts.data?.length ? (
        alerts.data.map((al) => (
          <div className={`incident incident-${al.severity}`} key={al.id}>
            <button type="button" className="incident-open" onClick={() => setIncident(al)}>
              <Glyph status={al.severity} />
              <span>
                <strong>{al.severity === 'critical' ? 'Alerta crítica' : 'Advertencia'}</strong>
                <span className="incident-msg">
                  {al.source === 'telemetry' ? withoutSimulatedSuffix(al.message) : al.message}
                </span>
                <span className="incident-meta">
                  desde las {time(al.triggered_at)} ·{' '}
                  {al.source === 'telemetry' ? 'telemetría simulada' : 'registro manual'}
                </span>
              </span>
              <ChevronRight size={14} aria-hidden="true" />
            </button>
            <div className="row incident-acts">
              {al.acknowledged_at ? (
                <span className="incident-ack num" data-testid="acknowledged">
                  reconocida a las {time(al.acknowledged_at)}
                </span>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={acknowledge.isPending}
                  onClick={() => acknowledge.mutate([al.id])}
                  title="Marca la alerta como vista: el pulso se apaga y el haz sigue hasta resolverla"
                >
                  Reconocer {!phone && <Kbd>R</Kbd>}
                </button>
              )}
              <button
                type="button"
                className="btn"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate(al.id)}
              >
                Resolver
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setPage('alerts')}>
                Ver en Alertas
              </button>
            </div>
            {(acknowledge.isError || resolve.isError) && (
              <p role="alert" className="form-error">
                {(acknowledge.error ?? resolve.error)?.message}
              </p>
            )}
          </div>
        ))
      ) : (
        <p className="quiet">Sin incidencias activas.</p>
      )}
    </section>
  );
  const content = a && (
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
          {installation ? `${installation.name} · ` : ''}
          {phone && lastReading ? (
            <>
              lectura <span className="num">{time(lastReading)}</span>
            </>
          ) : (
            'instalación ficticia'
          )}
        </p>
        {phone ? null : (
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
        )}
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
      {phone && (
        <>
          <dl className="kv kv-phone">
            <dt>Montaje</dt>
            <dd className="num sig-text">
              {a.mount_height_m > 0
                ? `${number(a.mount_height_m, 1)} m sobre el suelo`
                : 'a ras de suelo'}
            </dd>
            <dt>Suelo (MDT)</dt>
            <dd className="num">
              {ground !== null && geoid !== null ? `${formatMetres(ground - geoid)} · ` : '— · '}
              {formatLatLon(a.location.lat, a.location.lng)}
            </dd>
          </dl>
          <div className="card-acts">
            <button type="button" className="btn" onClick={() => reveal(historyRef)}>
              Histórico
            </button>
            <button type="button" className="btn" onClick={() => setTool('radius')}>
              Cercanos y radio
            </button>
            {health.data?.demo_mode && (
              <button type="button" className="btn" onClick={() => reveal(labRef)}>
                Laboratorio
              </button>
            )}
          </div>
        </>
      )}
      {/* An active alert goes first, where «Reconocer» and «Resolver» are in reach. */}
      {alerts.data?.length ? incidents : null}
      <section className="card-sec" ref={historyRef} aria-labelledby="card-history">
        <h3 id="card-history" tabIndex={-1}>
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
      {alerts.data?.length ? null : incidents}
      <section className="card-sec" aria-labelledby="card-nearby">
        <h3 id="card-nearby">
          {phone ? 'Cercanos y radio' : 'Cercanos'} <span className="r">ST_DWithin · PostGIS</span>
        </h3>
        {nearbyResult ? (
          <>
            <div className="row">
              <label className="field-inline">
                Activos a menos de
                <RadiusSelect label="Activos a menos de" />
              </label>
            </div>
            {nearbyResult.items.length ? (
              <RadiusList items={nearbyResult.items} />
            ) : (
              <p className="card-note">Ningún activo dentro del radio.</p>
            )}
          </>
        ) : (
          <div className="row">
            <button type="button" className="btn" onClick={() => setTool('radius')}>
              Activos a menos de… {!phone && <Kbd>5</Kbd>}
            </button>
          </div>
        )}
      </section>
      {health.data?.demo_mode && (
        <section className="card-sec" ref={labRef} aria-labelledby="card-lab">
          <h3 id="card-lab" tabIndex={-1}>
            Laboratorio de anomalías <span className="r">solo simulación</span>
          </h3>
          <p className="card-note">
            Inyecta una lectura en{' '}
            {selected ? metricLabel(selected.metric_type).toLowerCase() : 'el sensor'} y mantiene el
            fallo hasta resolver su incidencia. Datos simulados.
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
  );
  const state = asset.isPending ? (
    <Loading />
  ) : asset.isError ? (
    <ErrorState error={asset.error} retry={() => void asset.refetch()} />
  ) : (
    content
  );
  const dialogs = (
    <>
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
  if (phone)
    return (
      <>
        <BottomSheet
          label="Ficha del activo"
          labelledBy={a ? 'asset-card-title' : undefined}
          snaps={[25, 45, 90]}
          snap={snap}
          onSnap={setSnap}
          onClose={() => select(null)}
          className="asset-sheet"
          testId="asset-card"
        >
          {state}
        </BottomSheet>
        {dialogs}
      </>
    );
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
        {state}
      </aside>
      {dialogs}
    </>
  );
}
