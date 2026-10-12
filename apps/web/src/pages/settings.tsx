// Capability labels reflect the running API configuration.
import { Database, Globe, Radio, ExternalLink, Lock } from 'lucide-react';
import { useHealth } from '../hooks/data';
import { useUI } from '../stores/ui';
import { SectionHeading, ErrorState, Loading } from '../components/common';
import { Button } from '../components/ui/button';
export function Settings() {
  const health = useHealth(),
    connection = useUI((s) => s.connection);
  return (
    <div className="page">
      <SectionHeading
        eyebrow="WORKSPACE / SETTINGS"
        title="Transparencia operativa"
        description="Configuración real del entorno y alcance de esta demostración."
      />
      {health.isPending ? (
        <Loading />
      ) : health.isError ? (
        <ErrorState error={health.error} />
      ) : (
        <div className="settings-grid">
          <section className="panel settings-card">
            <Database size={24} />
            <h2>Persistencia</h2>
            <p>PostgreSQL conectado · PostGIS {health.data.postgis}</p>
            <p>Migraciones versionadas, consultas SQL parametrizadas e índices GiST.</p>
            <Button asChild variant="outline">
              <a href="/api/docs" target="_blank" rel="noreferrer">
                Documentación de API
                <ExternalLink size={14} />
              </a>
            </Button>
          </section>
          <section className="panel settings-card">
            <Radio size={24} />
            <h2>Telemetría y conexión</h2>
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
            <Globe size={24} />
            <h2>Visualización geoespacial</h2>
            <p>
              {import.meta.env.VITE_CESIUM_ION_TOKEN
                ? 'Cesium ion configurado. Edificios 3D y relieve requieren lectura de Cesium OSM Buildings y Cesium World Terrain.'
                : 'Modo básico sin token: globo elipsoidal, PNOA y activos 3D. Sin terreno de alta resolución ni edificios ion.'}
            </p>
            <p>El control de capas permite cartografía local de baja resolución sin conexión.</p>
          </section>
          <section className="panel settings-card">
            <Lock size={24} />
            <h2>Organización única</h2>
            <p>Valladolid Infrastructure Lab · Entorno de demostración local.</p>
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
