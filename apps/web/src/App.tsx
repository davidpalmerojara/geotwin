import {
  Activity,
  ArrowUpRight,
  Bell,
  Box,
  ChevronDown,
  Cloud,
  Database,
  Globe2,
  LayoutDashboard,
  Layers3,
  Settings2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useUI, type Page } from './stores/ui';
import { useInstallations, useSummary } from './hooks/data';
import { useRealtime } from './hooks/realtime';
import { Dashboard } from './features/dashboard/dashboard';
import { Twin } from './features/digital-twin/twin';
import { Assets } from './features/assets/assets';
import { Alerts } from './features/alerts/alerts';
import { Settings } from './pages/settings';
const nav: [Page, string, typeof Box][] = [
  ['overview', 'Resumen', LayoutDashboard],
  ['twin', 'Gemelo digital', Layers3],
  ['assets', 'Activos', Box],
  ['alerts', 'Alertas', Bell],
  ['settings', 'Ajustes', Settings2],
];
export default function App() {
  useRealtime();
  const page = useUI((s) => s.page),
    setPage = useUI((s) => s.setPage),
    connection = useUI((s) => s.connection),
    installationId = useUI((s) => s.installationId),
    setInstallation = useUI((s) => s.setInstallation);
  const installations = useInstallations(),
    summary = useSummary();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage('overview');
          }}
        >
          <div className="brand-icon">
            <Layers3 size={23} />
          </div>
          <div>
            GeoTwin<span>CLOUD PLATFORM</span>
          </div>
        </a>
        <div className="workspace-label">
          WORKSPACE <span>DEMO</span>
        </div>
        <div className="workspace-card">
          <Globe2 size={18} />
          <div>
            Valladolid Network<small>Infrastructure Lab</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">PLATFORM</div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              className={page === id ? 'active' : ''}
              key={id}
              onClick={() => setPage(id)}
              aria-current={page === id ? 'page' : undefined}
              title={label}
            >
              <Icon size={18} aria-hidden="true" />
              <span className="nav-text">{label}</span>
              {id === 'alerts' && !!summary.data?.active_alerts && (
                <b>{summary.data.active_alerts}</b>
              )}
              {page === id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="engine-card">
            <div>
              <Cloud size={17} />
              Connected infrastructure
            </div>
            <p>
              Visibilidad espacial.
              <br />
              Decisiones en tiempo real.
            </p>
            <span>
              <Database size={12} />
              Powered by PostGIS
            </span>
          </div>
          <div className="profile">
            <div>VL</div>
            <span>
              Valladolid Lab<small>Organización de demostración</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace
            <ChevronDown size={12} />
            <strong>Valladolid Network</strong>
            <span className="demo-badge">DEMO</span>
          </div>
          <div className="topbar-right">
            <span className={`connection ${connection}`} data-testid="connection">
              {connection === 'connected' ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span>
                {connection === 'connected'
                  ? 'Tiempo real'
                  : connection === 'offline'
                    ? 'Reconectando'
                    : 'Conectando'}
              </span>
            </span>
            <span className="sensor-count">
              <Activity size={14} />
              {summary.data?.active_sensors ?? '—'} sensores activos
            </span>
            <label className="installation-select">
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
            </label>
            <button
              className="notification-button"
              aria-label="Ver alertas"
              onClick={() => setPage('alerts')}
            >
              <Bell size={18} />
              {!!summary.data?.active_alerts && <i />}
            </button>
          </div>
        </header>
        {connection === 'offline' && (
          <div className="connection-warning" role="status">
            Conexión en tiempo real interrumpida. Reconectando automáticamente; se sincronizarán los
            datos con la API.
          </div>
        )}
        <main>
          {page === 'overview' ? (
            <Dashboard />
          ) : page === 'twin' ? (
            <Twin />
          ) : page === 'assets' ? (
            <Assets />
          ) : page === 'alerts' ? (
            <Alerts />
          ) : (
            <Settings />
          )}
        </main>
        <footer className="global-footer">
          <span>
            <span className="tiny-dot" />
            DEMO · Instalaciones ficticias en coordenadas reales · Telemetría simulada
          </span>
          <a href="/api/docs" target="_blank" rel="noreferrer">
            API documentation
            <ArrowUpRight size={12} />
          </a>
        </footer>
      </div>
    </div>
  );
}
