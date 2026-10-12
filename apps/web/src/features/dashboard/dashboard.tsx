// Trend points come from SQL aggregates; the client does not synthesize sensor data.
import { Activity, ArrowUpRight, Box, CircleAlert, ShieldCheck, TriangleAlert } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAssets, useSummary, useAlerts, useInstallations } from '../../hooks/data';
import { Loading, ErrorState, SectionHeading, Status, Empty } from '../../components/common';
import { useUI } from '../../stores/ui';
import { Button } from '../../components/ui/button';
import { time } from '../../lib/utils';
export function Dashboard() {
  const summary = useSummary(),
    assets = useAssets(),
    alerts = useAlerts(undefined, 'active'),
    installations = useInstallations();
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
      sub: `${d.installations} instalaciones conectadas`,
      icon: Box,
      color: 'cyan',
    },
    {
      label: 'Activos operativos',
      value: d.operational_assets,
      sub: `${d.total_assets ? Math.round((d.operational_assets / d.total_assets) * 100) : 0}% de disponibilidad actual`,
      icon: ShieldCheck,
      color: 'green',
    },
    {
      label: 'Alertas activas',
      value: d.active_alerts,
      sub: 'Incidencias pendientes de resolución',
      icon: CircleAlert,
      color: 'amber',
    },
    {
      label: 'Incidencias críticas',
      value: d.critical_incidents,
      sub: 'Requieren intervención',
      icon: TriangleAlert,
      color: 'red',
    },
  ];
  return (
    <div className="page dashboard">
      <SectionHeading
        eyebrow="OPERATIONS / VALLADOLID"
        title="Tu infraestructura. En perspectiva."
        description="Una visión compartida de cada activo, lectura e incidencia."
      >
        <Button onClick={() => setPage('twin')}>
          Abrir Digital Twin
          <ArrowUpRight size={16} />
        </Button>
      </SectionHeading>
      <div className="metric-grid">
        {cards.map((c) => (
          <div className={`metric-card accent-${c.color}`} key={c.label}>
            <div className="metric-label">
              {c.label}
              <c.icon size={18} />
            </div>
            <strong data-testid={c.label === 'Alertas activas' ? 'active-alerts' : undefined}>
              {c.value.toString().padStart(2, '0')}
            </strong>
            <p>{c.sub}</p>
            <div className="metric-line" />
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Telemetría de la red</h2>
              <p>Media por minuto · últimos 30 minutos · datos simulados</p>
            </div>
            <span className="live-label">
              <Activity size={13} />
              LIVE
            </span>
          </div>
          <div className="chart-legend">
            <span>
              <i className="bg-cyan-400" />
              Temperatura °C
            </span>
            <span>
              <i className="bg-violet-400" />
              Vibración mm/s
            </span>
          </div>
          <div className="overview-chart">
            {d.trend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.trend}>
                  <defs>
                    <linearGradient id="temperatureFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#223044" vertical={false} />
                  <XAxis
                    dataKey="recorded_at"
                    tickFormatter={(v) => time(String(v)).slice(0, 5)}
                    minTickGap={50}
                    tick={{ fill: '#8293a8', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="temp"
                    tick={{ fill: '#8293a8', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                  />
                  <YAxis
                    yAxisId="vib"
                    orientation="right"
                    tick={{ fill: '#8293a8', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#111c2d',
                      border: '1px solid #304158',
                      borderRadius: 10,
                    }}
                    labelFormatter={(v) => time(String(v))}
                    formatter={(v, name) => [
                      Number(v).toFixed(2),
                      name === 'temperature' ? 'Temperatura °C' : 'Vibración mm/s',
                    ]}
                  />
                  <Area
                    isAnimationActive={false}
                    yAxisId="temp"
                    type="monotone"
                    dataKey="temperature"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    fill="url(#temperatureFill)"
                  />
                  <Area
                    isAnimationActive={false}
                    yAxisId="vib"
                    type="monotone"
                    dataKey="vibration"
                    stroke="#a78bfa"
                    strokeWidth={2}
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
              <h2>Instalaciones</h2>
              <p>Red de demostración · Valladolid, ES</p>
            </div>
            <span className="pill">{installations.data?.length ?? '—'} hubs</span>
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
                <div className="install-icon">0{index + 1}</div>
                <div>
                  <strong>{i.name}</strong>
                  <p>
                    {i.asset_count} activos · {i.location.lat.toFixed(4)}° N
                  </p>
                </div>
                <ArrowUpRight size={16} />
              </button>
            ))
          )}
          <div className="network-note">
            <RadioDot />
            Ubicaciones reales. Instalaciones y operación simuladas.
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Estado de los activos</h2>
              <p>Selecciona un activo para explorar su gemelo</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPage('assets')}>
              Ver todos
              <ArrowUpRight size={14} />
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
                <div className="asset-symbol">
                  <Box size={17} />
                </div>
                <div>
                  <strong>{a.name}</strong>
                  <p>
                    {a.type} · {a.id.slice(-4)}
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
              <h2>Centro de alertas</h2>
              <p>Incidencias persistidas en PostgreSQL</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPage('alerts')}>
              Ver todas
              <ArrowUpRight size={14} />
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
                <TriangleAlert
                  className={a.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}
                  size={19}
                />
                <div>
                  <strong>{a.asset_name}</strong>
                  <p>{a.message}</p>
                  <small>{time(a.triggered_at)}</small>
                </div>
              </button>
            ))
          ) : (
            <div className="all-clear">
              <ShieldCheck size={32} />
              <h3>La red está bajo control</h3>
              <p>No hay incidencias activas en este momento.</p>
              <Button size="sm" variant="outline" onClick={() => setPage('twin')}>
                Explorar sensores
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
function RadioDot() {
  return <span className="tiny-dot" />;
}
