// Capability labels reflect the running API configuration.
import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { saveShortcutsEnabled, shortcutsEnabled } from '../features/hud/shortcuts';
import { ShortcutList } from '../features/hud/geotwin-menu';
import { useHealth, useOrganization } from '../hooks/data';
import { useUI } from '../stores/ui';
import { ErrorState, Loading } from '../components/common';

/**
 * Ajustes: the one-key shortcuts (with their off switch, WCAG 2.1.4, and the list), the
 * coordinate systems, and what the running environment really has: database, real-time link,
 * simulator, map services and the scope of the demo.
 */
export function Settings() {
  const health = useHealth(),
    organization = useOrganization().data,
    connection = useUI((s) => s.connection);
  const [shortcuts, setShortcuts] = useState(shortcutsEnabled);
  return (
    <div className="page settings">
      <section className="sheet-sec" aria-labelledby="set-shortcuts">
        <h3 id="set-shortcuts">Atajos de teclado</h3>
        <div className="switch-row">
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={shortcuts}
            aria-labelledby="shortcuts-label"
            aria-describedby="shortcuts-help"
            onClick={() => {
              setShortcuts(!shortcuts);
              saveShortcutsEnabled(!shortcuts);
            }}
          >
            <i aria-hidden="true" />
          </button>
          <span>
            <span id="shortcuts-label" className="switch-label">
              Teclas de una pulsación (1–5, C, 0, N, /)
            </span>
            <span className="switch-state">{shortcuts ? 'Activadas' : 'Apagadas'}</span>
            <small id="shortcuts-help" className="f1">
              Nunca actúan mientras escribes en un campo. Apágalas si usas un lector de pantalla o
              un programa de dictado; Ctrl+K y Esc siguen funcionando.
            </small>
          </span>
        </div>
        <ShortcutList />
      </section>
      <section className="sheet-sec" aria-labelledby="set-coords">
        <h3 id="set-coords">Coordenadas y alturas</h3>
        <dl className="kv">
          <dt>Geometrías</dt>
          <dd>
            WGS 84 (<span className="num">SRID 4326</span>) en PostGIS; las de las instalaciones son
            de demostración.
          </dd>
          <dt>Lectura</dt>
          <dd>
            Latitud y longitud, y UTM huso 30 N (ETRS89, <span className="num">EPSG:25830</span>).
          </dd>
          <dt>Alturas</dt>
          <dd>Ortométricas, sobre el geoide de cada hoja LiDAR, como las da el PNOA.</dd>
        </dl>
      </section>
      {health.isPending ? (
        <Loading />
      ) : health.isError ? (
        <ErrorState error={health.error} />
      ) : (
        <>
          <section className="sheet-sec" aria-labelledby="set-data">
            <h3 id="set-data">Datos y API</h3>
            <dl className="kv">
              <dt>Base de datos</dt>
              <dd>
                PostgreSQL conectado · PostGIS <span className="num">{health.data.postgis}</span>
              </dd>
              <dt>Tiempo real</dt>
              <dd>
                WebSocket{' '}
                {connection === 'connected'
                  ? 'conectado'
                  : connection === 'offline'
                    ? 'sin conexión'
                    : 'conectando'}
              </dd>
              <dt>Simulador</dt>
              <dd>
                {health.data.simulator_enabled ? 'activo' : 'apagado'} · laboratorio de anomalías{' '}
                {health.data.demo_mode ? 'disponible' : 'apagado'}
              </dd>
            </dl>
            <p className="sheet-note">
              Toda la telemetría es simulada. Las instalaciones son ficticias.
            </p>
            <a className="btn" href="/api/docs" target="_blank" rel="noreferrer">
              Documentación de la API
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </section>
          <section className="sheet-sec" aria-labelledby="set-map">
            <h3 id="set-map">Mapa</h3>
            <p className="f1">
              {import.meta.env.VITE_CESIUM_ION_TOKEN
                ? 'Cesium ion configurado: Edificios 3D y Fotorrealista (Google) disponibles en Capas.'
                : 'Sin token de Cesium ion: el relieve sale de las hojas LiDAR cargadas; Edificios 3D y Fotorrealista no están disponibles.'}{' '}
              Fondo en Capas: ortofoto PNOA, neutro o el atlas Natural Earth sin conexión.
            </p>
          </section>
          <section className="sheet-sec" aria-labelledby="set-org">
            <h3 id="set-org">Organización</h3>
            <p className="f1">
              {organization?.name ?? '—'} · entorno de demostración. Sin autenticación ni separación
              entre empresas: hay que añadir OIDC, autorización y políticas de acceso antes de
              publicarlo.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
