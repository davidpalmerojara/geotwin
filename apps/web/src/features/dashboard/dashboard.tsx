// Trend points come from SQL aggregates; the client does not synthesize sensor data.
import { ArrowUpRight } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  useAssets,
  useSummary,
  useAlerts,
  useInstallations,
  useOrganization,
} from '../../hooks/data';
import { assetTypeLabel, axisTick, coordinates, count, number } from '../../lib/format';
import { Loading, ErrorState, SectionHeading, Status, Empty } from '../../components/common';
import { useUI } from '../../stores/ui';
import { Button } from '../../components/ui/button';
import { time } from '../../lib/utils';
export function Dashboard() {
  const summary = useSummary(),
    assets = useAssets(),
    alerts = useAlerts(undefined, 'active'),
    installations = useInstallations(),
    region = useOrganization().data?.region;
  const setPage = useUI((s) => s.setPage),
    selectAsset = useUI((s) => s.selectAsset),
    setInstallation = useUI((s) => s.setInstallation);
  if (summary.isPending) return <Loading />;
  if (summary.isError)
    return <ErrorState error={summary.error} retry={() => void summary.refetch()} />;
  const d = summary.data;
  const cards = [
    {
      label: 'Activos monitorizados',
      value: d.total_assets,
      sub: count(d.installations, 'instalación conectada', 'instalaciones conectadas'),
      tone: 'neutral',
    },
    {
      label: 'Activos operativos',
      value: d.operational_assets,
      sub: `${d.total_assets ? Math.round((d.operational_assets / d.total_assets) * 100) : 0}% de disponibilidad actual`,
      tone: 'neutral',
    },
    {
      label: 'Alertas activas',
      value: d.active_alerts,
      sub: 'Incidencias pendientes de resolución',
      tone: 'neutral',
    },
    {
      label: 'Incidencias críticas',
      value: d.critical_incidents,
      sub: 'Requieren intervención',
      tone: 'critical',
    },
  ];
  return (
    <div className="page dashboard">
      <SectionHeading
        description={`Estado de la red${region ? ` de ${region}` : ''}: activos, lecturas e incidencias. Telemetría simulada.`}
      />
      <div className="metric-grid">
        {cards.map((c) => (
          <div className={`metric-card tone-${c.tone}`} key={c.label}>
            <div className="metric-label">
              {c.tone === 'critical' && <i className="glyph glyph-critical" aria-hidden="true" />}
              {c.label}
            </div>
            <strong data-testid={c.label === 'Alertas activas' ? 'active-alerts' : undefined}>
              {c.value.toString().padStart(2, '0')}
            </strong>
            <p>{c.sub}</p>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h3>Telemetría de la red</h3>
              <p>Media por minuto · últimos 30 minutos · datos simulados</p>
            </div>
            <span className="sim">simulado</span>
          </div>
          <div className="chart-legend">
            <span>
              <i className="key-line key-temp" />
              Temperatura °C
            </span>
            <span>
              <i className="key-line key-vib" />
              Vibración mm/s
            </span>
          </div>
          <div className="overview-chart">
            {d.trend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.trend}>
                  <CartesianGrid stroke="#363531" vertical={false} />
                  <XAxis
                    dataKey="recorded_at"
                    tickFormatter={(v) => time(String(v)).slice(0, 5)}
                    minTickGap={50}
                    tick={{ fill: '#BAB6AC', fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="temp"
                    tickFormatter={axisTick}
                    tick={{ fill: '#BAB6AC', fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                  />
                  <YAxis
                    yAxisId="vib"
                    tickFormatter={axisTick}
                    orientation="right"
                    tick={{ fill: '#BAB6AC', fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#0E0E0D',
                      border: '1px solid #706D64',
                      borderRadius: 2,
                      color: '#EEECE6',
                    }}
                    labelFormatter={(v) => time(String(v))}
                    formatter={(v, name) => [
                      number(Number(v), 2),
                      name === 'temperature' ? 'Temperatura °C' : 'Vibración mm/s',
                    ]}
                  />
                  <Area
                    isAnimationActive={false}
                    yAxisId="temp"
                    type="monotone"
                    dataKey="temperature"
                    stroke="#EEECE6"
                    strokeWidth={1.5}
                    fill="transparent"
                  />
                  <Area
                    isAnimationActive={false}
                    yAxisId="vib"
                    type="monotone"
                    dataKey="vibration"
                    stroke="#BAB6AC"
                    strokeWidth={1.5}
                    strokeDasharray="5 3"
                    fill="transparent"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Empty text="Todavía no hay lecturas." />
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Instalaciones</h3>
              <p>Red de demostración{region ? ` · ${region}` : ''}</p>
            </div>
            <span className="pill">
              {installations.data
                ? count(installations.data.length, 'instalación', 'instalaciones')
                : '—'}
            </span>
          </div>
          {installations.isError ? (
            <ErrorState error={installations.error} />
          ) : (
            installations.data?.map((i, index) => (
              <button
                className="installation-row"
                key={i.id}
                onClick={() => {
                  setInstallation(i.id);
                  setPage('twin');
                }}
              >
                <div className="install-icon num">0{index + 1}</div>
                <div>
                  <strong>{i.name}</strong>
                  <p>
                    {count(i.asset_count, 'activo', 'activos')} ·{' '}
                    {coordinates(i.location.lat, i.location.lng, 4)}
                  </p>
                </div>
                <ArrowUpRight size={14} aria-hidden="true" />
              </button>
            ))
          )}
          <p className="network-note">Ubicaciones reales. Instalaciones y operación simuladas.</p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Estado de los activos</h3>
              <p>Selecciona un activo para explorar su gemelo</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPage('assets')}>
              Ver todos
              <ArrowUpRight size={14} aria-hidden="true" />
            </Button>
          </div>
          {assets.isError ? (
            <ErrorState error={assets.error} />
          ) : (
            assets.data?.slice(0, 6).map((a) => (
              <button
                className="asset-row"
                key={a.id}
                onClick={() => {
                  selectAsset(a.id);
                  setPage('twin');
                }}
              >
                <div>
                  <strong>{a.name}</strong>
                  <p>
                    {assetTypeLabel[a.type]} · {a.id.slice(-4)}
                  </p>
                </div>
                <Status status={a.status} />
              </button>
            ))
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Centro de alertas</h3>
              <p>Incidencias persistidas en PostgreSQL</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPage('alerts')}>
              Ver todas
              <ArrowUpRight size={14} aria-hidden="true" />
            </Button>
          </div>
          {alerts.isError ? (
            <ErrorState error={alerts.error} />
          ) : alerts.data?.length ? (
            alerts.data.slice(0, 4).map((a) => (
              <button
                key={a.id}
                className="alert-preview"
                onClick={() => {
                  selectAsset(a.asset_id);
                  setPage('alerts');
                }}
              >
                <i className={`glyph glyph-${a.severity}`} aria-hidden="true" />
                <div>
                  <strong>{a.asset_name}</strong>
                  <p>{a.message}</p>
                  <small>{time(a.triggered_at)}</small>
                </div>
              </button>
            ))
          ) : (
            <div className="all-clear">
              <i className="glyph glyph-healthy" aria-hidden="true" />
              <p>No hay incidencias activas en este momento.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
