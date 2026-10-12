import { lazy, Suspense, useState } from 'react';
import { Search, Box, MapPin, LocateFixed } from 'lucide-react';
import { useAssets, useInstallations } from '../../hooks/data';
import { useUI } from '../../stores/ui';
import { Loading, ErrorState, Status, Empty } from '../../components/common';
import { AssetDetail } from '../assets/asset-detail';
import { Button } from '../../components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Asset, Installation } from '@geotwin/shared';
const CesiumView = lazy(() => import('./cesium-view'));
// Stable empty arrays so the viewer's effects do not re-run on every render while loading.
const noAssets: Asset[] = [];
const noInstallations: Installation[] = [];
export function Twin() {
  const assets = useAssets(),
    installations = useInstallations();
  const selected = useUI((s) => s.selectedAssetId),
    installationId = useUI((s) => s.installationId),
    select = useUI((s) => s.selectAsset),
    setInstallation = useUI((s) => s.setInstallation);
  const [search, setSearch] = useState(''),
    [radius, setRadius] = useState(500),
    [proximity, setProximity] = useState<{ lat: number; lng: number; radius: number } | null>(null);
  const nearby = useQuery({
    queryKey: ['geo', 'nearby', proximity],
    queryFn: () => api.nearby(proximity!.lat, proximity!.lng, proximity!.radius),
    enabled: !!proximity,
  });
  const center = installations.data?.find((i) => i.id === installationId)?.location ?? {
    lat: 41.655,
    lng: -4.737,
  };
  const visible = (assets.data ?? []).filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase()),
  );
  // The viewer is never gated on query state: unmounting it would destroy the WebGL
  // context, the chosen base layer, ion terrain/buildings and the camera.
  const failed = assets.isError || installations.isError;
  return (
    <div className="twin-layout">
      <div className="twin-main">
        <div className="twin-toolbar">
          <div>
            <span className="eyebrow">DIGITAL TWIN</span>
            <h1>
              Explora la red <span>{assets.data?.length ?? '—'} activos</span>
            </h1>
          </div>
          <label className="search-box">
            <Search size={16} />
            <input
              aria-label="Buscar activo en el visor"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar activo…"
            />
          </label>
        </div>
        {failed && (
          <ErrorState
            error={assets.error ?? installations.error}
            retry={() => {
              void assets.refetch();
              void installations.refetch();
            }}
          />
        )}
        <Suspense fallback={<Loading label="Inicializando motor geoespacial…" />}>
          <CesiumView
            assets={assets.data ?? noAssets}
            installations={installations.data ?? noInstallations}
            installationId={installationId}
            selectedId={selected}
            onSelect={select}
            onInstallation={setInstallation}
          />
        </Suspense>
        <div className="map-asset-strip">
          {assets.isPending ? (
            <Loading />
          ) : visible.length ? (
            visible.map((a) => (
              <button
                data-testid={`map-asset-${a.id}`}
                key={a.id}
                className={`map-asset-chip ${selected === a.id ? 'selected' : ''}`}
                onClick={() => select(a.id)}
              >
                <Box size={14} />
                {a.name}
                <span className={`dot-${a.status}`} />
              </button>
            ))
          ) : (
            <Empty />
          )}
        </div>
        <section className="spatial-bar">
          <div>
            <LocateFixed size={18} className="text-cyan-400" />
            <strong>Consulta espacial</strong>
            <span>ST_DWithin · PostGIS · centro de instalación</span>
          </div>
          <label>
            Radio{' '}
            <select
              aria-label="Radio de proximidad"
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
            >
              <option value={100}>100 m</option>
              <option value={500}>500 m</option>
              <option value={5000}>5 km</option>
            </select>
          </label>
          <Button size="sm" variant="outline" onClick={() => setProximity({ ...center, radius })}>
            Buscar cercanos
          </Button>
        </section>
        {proximity && (
          <div className="spatial-results">
            {nearby.isPending ? (
              <Loading />
            ) : nearby.isError ? (
              <ErrorState error={nearby.error} />
            ) : (
              <>
                <span>
                  <MapPin size={13} />
                  {nearby.data.length} activos en {proximity.radius} m (toda la red)
                </span>
                {nearby.data.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      if (a.installation_id !== installationId) setInstallation(a.installation_id);
                      select(a.id);
                    }}
                  >
                    {a.name} <small>{Math.round(a.distance_m)} m</small>
                    <Status status={a.status} />
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
      <AssetDetail id={selected} />
    </div>
  );
}
