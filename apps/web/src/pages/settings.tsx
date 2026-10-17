// Capability labels reflect the running API configuration.
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { saveShortcutsEnabled, shortcutsEnabled } from '../features/hud/shortcuts';
import { useHealth, useOrganization } from '../hooks/data';
import { useUI } from '../stores/ui';
import { SectionHeading, ErrorState, Loading } from '../components/common';
import { Button } from '../components/ui/button';
export function Settings() {
  const health = useHealth(),
    organization = useOrganization().data,
    connection = useUI((s) => s.connection);
  const [shortcuts, setShortcuts] = useState(shortcutsEnabled);
  return (
    <div className="page">
      <SectionHeading description="Configuración real del entorno y alcance de esta demostración." />
      <section className="panel settings-card">
        <h3>Atajos de teclado</h3>
        <label className="layer-check">
          <input
            type="checkbox"
            checked={shortcuts}
            aria-describedby="shortcuts-help"
            onChange={(e) => {
              setShortcuts(e.target.checked);
              saveShortcutsEnabled(e.target.checked);
            }}
          />
          <span>
            Teclas de una pulsación (1–5, C, 0, N, /)
            <small id="shortcuts-help">
              Nunca actúan mientras escribes en un campo. Apágalas si usas un lector de pantalla o
              un programa de dictado; Ctrl+K y Esc siguen funcionando.
            </small>
          </span>
        </label>
      </section>
      {health.isPending ? (
        <Loading />
      ) : health.isError ? (
        <ErrorState error={health.error} />
      ) : (
        <div className="settings-grid">
          <section className="panel settings-card">
            <h3>Persistencia</h3>
            <p>PostgreSQL conectado · PostGIS {health.data.postgis}</p>
            <p>Migraciones versionadas, consultas SQL parametrizadas e índices GiST.</p>
            <Button asChild variant="outline">
              <a href="/api/docs" target="_blank" rel="noreferrer">
                Documentación de la API
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            </Button>
          </section>
          <section className="panel settings-card">
            <h3>Telemetría y conexión</h3>
            <p>
              WebSocket:{' '}
              {connection === 'connected'
                ? 'conectado'
                : connection === 'offline'
                  ? 'sin conexión'
                  : 'conectando'}
            </p>
            <p>
              Simulador: {health.data.simulator_enabled ? 'activo' : 'desactivado'} · Control de
              anomalías: {health.data.demo_mode ? 'habilitado' : 'deshabilitado'}
            </p>
            <p>Todos los datos operativos son simulados. No representan instalaciones reales.</p>
          </section>
          <section className="panel settings-card">
            <h3>Visualización geoespacial</h3>
            <p>
              {import.meta.env.VITE_CESIUM_ION_TOKEN
                ? 'Cesium ion configurado. Edificios 3D y relieve requieren lectura de Cesium OSM Buildings y Cesium World Terrain.'
                : 'Modo básico sin token: globo elipsoidal, PNOA y activos 3D. Sin terreno de alta resolución ni edificios ion.'}
            </p>
            <p>
              Fondo: ortofoto PNOA, fondo neutro o el atlas Natural Earth sin conexión, en Capas.
              Coordenadas WGS 84 (SRID 4326); geometrías de las instalaciones de demostración.
            </p>
          </section>
          <section className="panel settings-card">
            <h3>Organización única</h3>
            <p>{organization?.name ?? '—'} · Entorno de demostración local.</p>
            <p>
              Este MVP no incluye autenticación ni aislamiento multiempresa. Añadir OIDC,
              autorización y políticas de acceso antes de exponerlo públicamente.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
