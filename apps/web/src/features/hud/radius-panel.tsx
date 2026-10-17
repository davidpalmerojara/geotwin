import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAssets, useInstallations } from '../../hooks/data';
import { useUI } from '../../stores/ui';
import { RADII, useTool, type RadiusItem } from '../../stores/tool';
import { api } from '../../lib/api';
import { count } from '../../lib/format';
import { frameOf } from '../digital-twin/camera';
import { ErrorState, Loading } from '../../components/common';
import { Glyph } from './glyphs';
import { formatMetres } from './readout';

export const radiusLabel = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);

/** The radius select, shared by the Radio panel and the asset card. */
export function RadiusSelect({ label = 'Radio de proximidad' }: { label?: string }) {
  const metres = useTool((s) => s.radiusMetres),
    setMetres = useTool((s) => s.setRadiusMetres);
  return (
    <select aria-label={label} value={metres} onChange={(e) => setMetres(Number(e.target.value))}>
      {RADII.map((m) => (
        <option key={m} value={m}>
          {radiusLabel(m)}
        </option>
      ))}
    </select>
  );
}

/** The assets of a Radio result, nearest first; a click selects one. */
export function RadiusList({ items }: { items: RadiusItem[] }) {
  const installationId = useUI((s) => s.installationId),
    select = useUI((s) => s.selectAsset),
    setInstallation = useUI((s) => s.setInstallation);
  const assets = useAssets().data;
  return (
    <ul className="near-list" data-testid="radius-list">
      {items.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            onClick={() => {
              const installation = assets?.find((x) => x.id === a.id)?.installation_id;
              if (installationId && installation && installation !== installationId)
                setInstallation(installation);
              select(a.id);
            }}
          >
            <Glyph status={a.status} />
            <span>{a.name}</span>
            <span className="num">{formatMetres(a.distance_m, 0)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Tool 5, Radio: the assets within a radius (ST_DWithin in PostGIS) of a point picked on the map,
 * the selected asset, the selected installation or the middle of the network. The query runs as
 * soon as the centre or the radius changes; the scene draws the ring on the DTM (radius-ring.ts)
 * and the asset card lists the result under «Cercanos».
 */
export function RadiusPanel() {
  const assets = useAssets(),
    installations = useInstallations();
  const selected = useUI((s) => s.selectedAssetId),
    installationId = useUI((s) => s.installationId);
  const setRadius = useTool((s) => s.setRadius),
    point = useTool((s) => s.radiusPoint),
    metres = useTool((s) => s.radiusMetres);
  const installation = installations.data?.find((i) => i.id === installationId);
  const selectedAsset = assets.data?.find((a) => a.id === selected);
  const center =
    point ??
    selectedAsset?.location ??
    installation?.location ??
    frameOf((installations.data ?? []).map((i) => i.location))?.center;
  const centerLabel = point
    ? 'punto del mapa'
    : selectedAsset
      ? selectedAsset.name
      : installation
        ? `centro de ${installation.name}`
        : 'centro de la red';
  const query = center ? { lat: center.lat, lng: center.lng, radius: metres } : null;
  const nearby = useQuery({
    queryKey: ['geo', 'nearby', query],
    queryFn: () => api.nearby(query!.lat, query!.lng, query!.radius),
    enabled: !!query,
  });
  // The asset at the centre is not one of its own neighbours.
  const found = nearby.data?.filter((a) => a.id !== (point ? undefined : selectedAsset?.id));
  const key = found?.map((a) => `${a.id}:${a.status}:${Math.round(a.distance_m)}`).join(',');
  useEffect(() => {
    if (!query || !found) {
      setRadius(null);
      return;
    }
    const items: RadiusItem[] = found.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      distance_m: a.distance_m,
      lng: a.location.lng,
      lat: a.location.lat,
    }));
    setRadius({
      metres: query.radius,
      count: items.length,
      ids: items.map((i) => i.id),
      center: { lng: query.lng, lat: query.lat },
      centerLabel,
      items,
    });
    // The result changes with its key (ids, states and distances), the centre and the radius.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, query?.lat, query?.lng, query?.radius, centerLabel, setRadius]);
  useEffect(() => () => setRadius(null), [setRadius]);
  return (
    <div className="radius-panel">
      <p className="panel-note">
        Centro: <b>{centerLabel}</b>
        <span className="f2"> · clic en el mapa para otro centro</span>
      </p>
      <div className="row">
        <label className="field-inline">
          Radio
          <RadiusSelect />
        </label>
      </div>
      {query &&
        (nearby.isPending ? (
          <Loading />
        ) : nearby.isError ? (
          <ErrorState error={nearby.error} />
        ) : (
          <>
            <p className="panel-note" data-testid="radius-count">
              {count(found?.length ?? 0, 'activo', 'activos')} a menos de{' '}
              {radiusLabel(query.radius)} (toda la red) ·{' '}
              <span className="f2">ST_DWithin · PostGIS</span>
            </p>
            <RadiusList
              items={(found ?? []).map((a) => ({
                id: a.id,
                name: a.name,
                status: a.status,
                distance_m: a.distance_m,
                lng: a.location.lng,
                lat: a.location.lat,
              }))}
            />
          </>
        ))}
    </div>
  );
}
