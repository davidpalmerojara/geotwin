import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { Alert } from '@geotwin/shared';
import { useAlerts, useInstallations, useOrganization, useSummary } from '../../hooks/data';
import { useUI, type Page } from '../../stores/ui';
import { pageTitle } from '../../lib/route';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { Brand, Caret, Glyph, Kbd, Sim } from './glyphs';
import { SHORTCUTS } from './shortcuts';

const MENU: Page[] = ['twin', 'overview', 'assets', 'alerts', 'settings'];

/** The most severe active alert, the most recent among equals, and how many others there are. */
export function activeAlarm(alerts: Alert[] | undefined) {
  const active = (alerts ?? []).filter((a) => a.status === 'active');
  if (!active.length) return null;
  const sorted = [...active].sort(
    (a, b) =>
      Number(b.severity === 'critical') - Number(a.severity === 'critical') ||
      b.triggered_at.localeCompare(a.triggered_at),
  );
  return { alert: sorted[0]!, others: sorted.length - 1 };
}

/**
 * Top-left plate: the GeoTwin menu, the workspace with its «demo» tag, the installation selector
 * and the annunciator (asset counts, which open Activos, and the active alarm, which opens
 * Alertas).
 */
export function PlacePlate() {
  const page = useUI((s) => s.page),
    setPage = useUI((s) => s.setPage),
    installationId = useUI((s) => s.installationId),
    setInstallation = useUI((s) => s.setInstallation);
  const installations = useInstallations(),
    summary = useSummary().data,
    region = useOrganization().data?.region,
    alarm = activeAlarm(useAlerts(undefined, 'active').data);
  const [menu, setMenu] = useState(false),
    [shortcuts, setShortcuts] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  // A shared link may name an installation that no longer exists: show the whole network.
  const unknownInstallation =
    !!installationId && !!installations.data?.every((i) => i.id !== installationId);
  useEffect(() => {
    if (unknownInstallation) setInstallation('');
  }, [unknownInstallation, setInstallation]);
  // The menu closes on Esc (focus back to its button) and on a click elsewhere.
  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setMenu(false);
      trigger.current?.focus();
    };
    const onDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && event.target !== trigger.current)
        setMenu(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [menu]);
  const go = (target: Page) => {
    setMenu(false);
    setPage(target);
  };
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
        {menu && (
          <div className="menu plate" id="geotwin-menu" ref={menuRef}>
            <nav aria-label="Secciones">
              {MENU.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-current={page === p ? 'page' : undefined}
                  onClick={() => go(p)}
                >
                  {pageTitle[p]}
                  {p === 'alerts' && !!summary?.active_alerts && (
                    <span className="menu-count num" aria-hidden="true">
                      {summary.active_alerts}
                    </span>
                  )}
                </button>
              ))}
            </nav>
            <div className="menu-rule" />
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                setShortcuts(true);
              }}
            >
              Atajos de teclado
            </button>
            <a href="/api/docs" target="_blank" rel="noreferrer">
              Documentación de la API <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          </div>
        )}
      </div>
      <div className="place-context">
        <span className="workspace">{workspace}</span>
        <span className="demo-tag" title="Instalaciones ficticias y telemetría simulada">
          demo
        </span>
        <span className="f2" aria-hidden="true">
          /
        </span>
        <label className="select-plain">
          <select
            aria-label="Seleccionar instalación"
            value={installationId}
            onChange={(e) => setInstallation(e.target.value)}
          >
            <option value="">Todas las instalaciones</option>
            {installations.data?.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <Caret />
        </label>
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
      <Dialog open={shortcuts} onOpenChange={setShortcuts}>
        <DialogContent>
          <DialogTitle className="dialog-title">Atajos de teclado</DialogTitle>
          <DialogDescription className="dialog-description">
            Funcionan en toda la página salvo al escribir en un campo. Se pueden apagar en Ajustes.
          </DialogDescription>
          <dl className="shortcut-list">
            {SHORTCUTS.map(([key, label]) => (
              <div key={key}>
                <dt>
                  <Kbd>{key}</Kbd>
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}
