import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { Alert } from '@geotwin/shared';
import { useAlerts, useInstallations, useOrganization, useSummary } from '../../hooks/data';
import { useUI } from '../../stores/ui';
import { useTool } from '../../stores/tool';
import { useScene } from '../../stores/viewer';
import { count } from '../../lib/format';
import { Brand, Caret, Glyph, Sim } from './glyphs';
import { GeoTwinMenu } from './geotwin-menu';

/** The most severe active alert, the most recent among equals, and how many others there are. */
export function activeAlarm(alerts: Alert[] | undefined) {
  const active = (alerts ?? []).filter((a) => a.status === 'active');
  if (!active.length) return null;
  const sorted = [...active].sort(
    (a, b) =>
      Number(b.severity === 'critical') - Number(a.severity === 'critical') ||
      b.triggered_at.localeCompare(a.triggered_at),
  );
  const same = active.filter((a) => a.severity === sorted[0]!.severity).length;
  return { alert: sorted[0]!, others: sorted.length - 1, same };
}

/** The installation of the URL, or none when a shared link names one that no longer exists. */
function useInstallationChoice() {
  const installationId = useUI((s) => s.installationId),
    setInstallation = useUI((s) => s.setInstallation);
  const installations = useInstallations();
  const unknownInstallation =
    !!installationId && !!installations.data?.every((i) => i.id !== installationId);
  useEffect(() => {
    if (unknownInstallation) setInstallation('');
  }, [unknownInstallation, setInstallation]);
  return { installationId, setInstallation, installations: installations.data };
}

function InstallationSelect() {
  const { installationId, setInstallation, installations } = useInstallationChoice();
  return (
    <label className="select-plain">
      <select
        aria-label="Seleccionar instalación"
        value={installationId}
        onChange={(e) => setInstallation(e.target.value)}
      >
        <option value="">Todas las instalaciones</option>
        {installations?.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </select>
      <Caret />
    </label>
  );
}

/**
 * Top-left plate: the GeoTwin menu, the workspace with its «demo» tag, the installation selector
 * and the annunciator (asset counts, which open Activos, and the active alarm, which opens
 * Alertas).
 */
export function PlacePlate() {
  const setPage = useUI((s) => s.setPage);
  const summary = useSummary().data,
    region = useOrganization().data?.region,
    alarm = activeAlarm(useAlerts(undefined, 'active').data);
  const [menu, setMenu] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const workspace = region?.split(' (')[0] ?? '—';
  return (
    <div className="plate place-plate" data-map-overlay data-testid="place-plate">
      <div className="place-brand">
        <button
          ref={trigger}
          type="button"
          className="brand"
          aria-expanded={menu}
          aria-controls="geotwin-menu"
          onClick={() => setMenu(!menu)}
        >
          <Brand />
          GeoTwin
          <Caret />
        </button>
        <GeoTwinMenu open={menu} setOpen={setMenu} trigger={trigger} />
      </div>
      <div className="place-context">
        <span className="workspace">{workspace}</span>
        <span className="demo-tag" title="Instalaciones ficticias y telemetría simulada">
          demo
        </span>
        <span className="f2" aria-hidden="true">
          /
        </span>
        <InstallationSelect />
      </div>
      <div className="annunciator" role="status" aria-label="Anunciador">
        <button
          type="button"
          className="annun-cell annun-counts"
          data-testid="annunciator-counts"
          title="Abre Activos"
          aria-label={
            summary
              ? `${summary.total_assets} activos: ${summary.critical_assets} en estado crítico y ${summary.warning_assets} en advertencia. Abre Activos.`
              : 'Activos'
          }
          onClick={() => setPage('assets')}
        >
          <span className="annun-total">{summary ? `${summary.total_assets} activos` : '—'}</span>
          <span className="annun-n">
            <Glyph status="critical" />
            <span className="num">{summary?.critical_assets ?? '—'}</span>
          </span>
          <span className="annun-n">
            <Glyph status="warning" />
            <span className="num">{summary?.warning_assets ?? '—'}</span>
          </span>
        </button>
        {alarm && (
          <button
            type="button"
            className={`annun-cell annun-alarm annun-${alarm.alert.severity}`}
            data-testid="annunciator-alarm"
            title="Abre Alertas"
            onClick={() => setPage('alerts')}
          >
            <Glyph status={alarm.alert.severity} />
            <b>{alarm.alert.severity === 'critical' ? 'Crítico' : 'Advertencia'}</b>
            <span className="annun-name">{alarm.alert.asset_name}</span>
            {alarm.alert.source === 'telemetry' ? <Sim /> : <Sim text="manual" />}
            {alarm.others > 0 && <span className="num annun-more">+{alarm.others}</span>}
          </button>
        )}
      </div>
    </div>
  );
}

/** «Tiempo real» and the clock (the readout's last cell on desktop; the top plate's on a phone). */
export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export const connectionWord = (connection: 'connecting' | 'connected' | 'offline') =>
  connection === 'connected'
    ? 'Tiempo real'
    : connection === 'offline'
      ? 'Reconectando'
      : 'Conectando';

/**
 * The phone's top plate (A/phone.png, floating as in C/phone.png): the installation as the title
 * (a selector), a line with the workspace, the asset count, «demo» and the real-time state, «Ir
 * a» and Menú; under it, while an alarm is active, the annunciator row («◆ 1 crítico · Sonda de
 * nivel · simulado · Ver»), which opens Alertas.
 */
export function PhonePlate() {
  const setPage = useUI((s) => s.setPage),
    connection = useUI((s) => s.connection);
  const { installationId, installations } = useInstallationChoice();
  const summary = useSummary().data,
    region = useOrganization().data?.region,
    alarm = activeAlarm(useAlerts(undefined, 'active').data);
  const setPalette = useTool((s) => s.setPalette);
  const api = useScene((s) => s.api);
  const [menu, setMenu] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const installation = installations?.find((i) => i.id === installationId);
  const total = installation ? installation.asset_count : summary?.total_assets;
  const workspace = region?.split(' (')[0] ?? '—';
  const critical = alarm?.alert.severity === 'critical';
  return (
    <div className="plate phone-plate" data-map-overlay data-testid="place-plate">
      <div className="phone-plate-row">
        <Brand />
        <div className="phone-title">
          <InstallationSelect />
          <p className="phone-sub">
            <span>{workspace}</span>
            <span aria-hidden="true"> · </span>
            <button
              type="button"
              className="link-plain"
              data-testid="annunciator-counts"
              aria-label={
                total !== undefined
                  ? `${count(total, 'activo', 'activos')}. Abre Activos.`
                  : 'Activos'
              }
              onClick={() => setPage('assets')}
            >
              {total !== undefined ? count(total, 'activo', 'activos') : '—'}
            </button>
            <span aria-hidden="true"> · </span>
            <span className="demo-tag" title="Instalaciones ficticias y telemetría simulada">
              demo
            </span>
            <span aria-hidden="true"> · </span>
            <span className={`connection ${connection}`} data-testid="connection">
              <i className="live-dot" aria-hidden="true" />
              {connectionWord(connection)}
            </span>
          </p>
        </div>
        <button
          type="button"
          className="plate-btn"
          aria-label="Ir a…"
          title="Ir a un activo, una instalación o una capa"
          onClick={() => setPalette(true)}
        >
          <Search size={18} aria-hidden="true" />
        </button>
        <div className="place-brand">
          <button
            ref={trigger}
            type="button"
            className="plate-btn menu-btn"
            aria-expanded={menu}
            aria-controls="geotwin-menu"
            onClick={() => setMenu(!menu)}
          >
            Menú
          </button>
          <GeoTwinMenu
            open={menu}
            setOpen={setMenu}
            trigger={trigger}
            className="menu-right"
            extra={
              <button
                type="button"
                disabled={!api}
                onClick={() => {
                  setMenu(false);
                  api?.home();
                }}
              >
                Encuadre inicial
              </button>
            }
          />
        </div>
      </div>
      {alarm && (
        <button
          type="button"
          className={`phone-annun annun-${alarm.alert.severity}`}
          data-testid="annunciator-alarm"
          title="Abre Alertas"
          onClick={() => setPage('alerts')}
        >
          <Glyph status={alarm.alert.severity} />
          <b>
            {alarm.same}{' '}
            {critical
              ? alarm.same === 1
                ? 'crítico'
                : 'críticos'
              : alarm.same === 1
                ? 'advertencia'
                : 'advertencias'}
          </b>
          <span className="annun-name">{alarm.alert.asset_name}</span>
          {alarm.alert.source === 'telemetry' ? <Sim /> : <Sim text="manual" />}
          {alarm.others >= alarm.same && (
            <span className="num annun-more">+{alarm.others - alarm.same + 1}</span>
          )}
          <span className="annun-go">Ver</span>
        </button>
      )}
    </div>
  );
}
