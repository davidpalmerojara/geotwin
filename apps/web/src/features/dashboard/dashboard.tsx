// Trend points come from SQL aggregates; the client does not synthesize sensor data.
import { ArrowUpRight } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AssetStatus } from '@geotwin/shared';
import {
  useAssets,
  useSummary,
  useAlerts,
  useInstallations,
  useOrganization,
} from '../../hooks/data';
import { assetTypeLabel, axisTick, count, number } from '../../lib/format';
import { Loading, ErrorState, Status, Empty } from '../../components/common';
import { useUI } from '../../stores/ui';
import { time } from '../../lib/utils';
import { CHART } from '../../styles/tokens';
import { Glyph, Sim } from '../hud/glyphs';
import { formatLatLon } from '../hud/readout';

const SEVERITY: Record<AssetStatus, number> = { critical: 0, warning: 1, healthy: 2 };

/**
 * Resumen: the state of the network in figures, the telemetry of the last 30 minutes, the
 * installations, the assets that need looking at first and the active alerts. Plain labels,
 * tabular numbers with a decimal comma, and every state as shape, colour and word.
 */
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
  const available = d.total_assets ? Math.round((d.operational_assets / d.total_assets) * 100) : 0;
  const worst = [...(assets.data ?? [])]
    .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.name.localeCompare(b.name, 'es'))
    .slice(0, 6);
  return (
    <div className="page dashboard">
      <p className="sheet-lede">
        {region ?? 'Red de demostración'} · instalaciones ficticias ·{' '}
        <Sim text="telemetría simulada" />
      </p>
      <dl className="figures">
        <div>
          <dt>Activos</dt>
          <dd className="figure-v num">{d.total_assets}</dd>
          <dd className="figure-sub">
            {count(d.installations, 'instalación', 'instalaciones')} ·{' '}
            {count(d.active_sensors, 'sensor activo', 'sensores activos')}
          </dd>
        </div>
        <div>
          <dt>Operativos</dt>
          <dd className="figure-v num">{d.operational_assets}</dd>
          <dd className="figure-sub">{available} % disponibles</dd>
        </div>
        <div>
          <dt>Alertas activas</dt>
          <dd className="figure-v num" data-testid="active-alerts">
            {d.active_alerts.toString().padStart(2, '0')}
          </dd>
          <dd className="figure-sub">sin resolver</dd>
        </div>
        <div className={d.critical_incidents ? 'figure-critical' : undefined}>
          <dt>
            {d.critical_incidents > 0 && <Glyph status="critical" />}
            Críticas
          </dt>
          <dd className="figure-v num">{d.critical_incidents.toString().padStart(2, '0')}</dd>
          <dd className="figure-sub">
            {d.critical_incidents ? 'requieren intervención' : 'ninguna'}
          </dd>
        </div>
      </dl>

      <section className="sheet-sec" aria-labelledby="sum-telemetry">
        <h3 id="sum-telemetry">
          Telemetría de la red
          <span className="r">media por minuto · últimos 30 min</span>
          <Sim />
        </h3>
        <div className="chart-legend" aria-hidden="true">
          <span>
            <i className="key-line" />
            Temperatura (°C, eje izquierdo)
          </span>
          <span>
            <i className="key-line key-vib" />
            Vibración (mm/s, eje derecho)
          </span>
        </div>
        <div className="overview-chart">
          {d.trend.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.trend} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis
                  dataKey="recorded_at"
                  tickFormatter={(v) => time(String(v)).slice(0, 5)}
                  minTickGap={50}
                  tick={CHART.tick}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="temp"
                  tickFormatter={axisTick}
                  tick={CHART.tick}
                  axisLine={false}
                  tickLine={false}
                  width={34}
                />
                <YAxis
                  yAxisId="vib"
                  tickFormatter={axisTick}
                  orientation="right"
                  tick={CHART.tick}
                  axisLine={false}
                  tickLine={false}
                  width={34}
                />
                <Tooltip
                  contentStyle={CHART.tooltip}
                  labelFormatter={(v) => time(String(v))}
                  formatter={(v, name) => [
                    number(Number(v), 2),
                    name === 'temperature'
                      ? 'Temperatura °C (simulada)'
                      : 'Vibración mm/s (simulada)',
                  ]}
                />
                <Line
                  isAnimationActive={false}
                  yAxisId="temp"
                  type="monotone"
                  dataKey="temperature"
                  stroke={CHART.line}
                  strokeWidth={1.5}
                  dot={false}
                />
                <Line
                  isAnimationActive={false}
                  yAxisId="vib"
                  type="monotone"
                  dataKey="vibration"
                  stroke={CHART.line2}
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty text="Todavía no hay lecturas." />
          )}
        </div>
      </section>

      <section className="sheet-sec" aria-labelledby="sum-installations">
        <h3 id="sum-installations">
          Instalaciones
          <span className="r num">{installations.data?.length ?? '—'}</span>
        </h3>
        {installations.isError ? (
          <ErrorState error={installations.error} />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th scope="col" className="c-n">
                  Nº
                </th>
                <th scope="col">Instalación</th>
                <th scope="col" className="c-r">
                  Activos
                </th>
                <th scope="col" className="hide-phone">
                  Posición
                </th>
              </tr>
            </thead>
            <tbody>
              {installations.data?.map((i, index) => (
                <tr key={i.id}>
                  <td className="num c-n f2">{String(index + 1).padStart(2, '0')}</td>
                  <td>
                    <button
                      type="button"
                      className="row-link"
                      onClick={() => {
                        setInstallation(i.id);
                        setPage('twin');
                      }}
                    >
                      {i.name}
                      <ArrowUpRight size={12} aria-hidden="true" />
                    </button>
                  </td>
                  <td className="num c-r">{i.asset_count}</td>
                  <td className="num hide-phone">{formatLatLon(i.location.lat, i.location.lng)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="sheet-note">Ubicaciones reales; instalaciones y operación simuladas.</p>
      </section>

      <section className="sheet-sec" aria-labelledby="sum-assets">
        <h3 id="sum-assets">
          Activos, primero los que piden atención
          <button type="button" className="r link-plain" onClick={() => setPage('assets')}>
            Ver los {d.total_assets}
          </button>
        </h3>
        {assets.isError ? (
          <ErrorState error={assets.error} />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Activo</th>
                <th scope="col" className="hide-phone">
                  Tipo
                </th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {worst.map((a) => (
                <tr key={a.id}>
                  <td>
                    <button
                      type="button"
                      className="row-link"
                      onClick={() => {
                        selectAsset(a.id);
                        setPage('twin');
                      }}
                    >
                      {a.name}
                    </button>
                  </td>
                  <td className="f1 hide-phone">{assetTypeLabel[a.type]}</td>
                  <td>
                    <Status status={a.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="sheet-sec" aria-labelledby="sum-alerts">
        <h3 id="sum-alerts">
          Alertas activas
          <button type="button" className="r link-plain" onClick={() => setPage('alerts')}>
            Abrir Alertas
          </button>
        </h3>
        {alerts.isError ? (
          <ErrorState error={alerts.error} />
        ) : alerts.data?.length ? (
          <ul className="alert-lines">
            {alerts.data.slice(0, 4).map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className={`alert-line alert-${a.severity}`}
                  onClick={() => {
                    selectAsset(a.asset_id);
                    setPage('alerts');
                  }}
                >
                  <span className={`status status-${a.severity}`}>
                    <Glyph status={a.severity} />
                    {a.severity === 'critical' ? 'Crítica' : 'Advertencia'}
                  </span>
                  <span className="alert-line-what">
                    <strong>{a.asset_name}</strong>
                    <span className="f1">{a.message}</span>
                  </span>
                  <span className="num f1">{time(a.triggered_at).slice(0, 5)}</span>
                  {a.source === 'telemetry' ? <Sim /> : <Sim text="manual" />}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="all-clear">
            <Glyph status="healthy" />
            Ninguna incidencia activa.
          </p>
        )}
      </section>
    </div>
  );
}
