import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAssets, useInstallations } from '../../hooks/data';
import { useUI } from '../../stores/ui';
import { useTool } from '../../stores/tool';
import { api } from '../../lib/api';
import { count } from '../../lib/format';
import { frameOf } from '../digital-twin/camera';
import { ErrorState, Loading } from '../../components/common';
import { Glyph } from './glyphs';
import { formatMetres } from './readout';

const RADII: [number, string][] = [
  [100, '100 m'],
  [250, '250 m'],
  [500, '500 m'],
  [5000, '5 km'],
];

/**
 * Tool 5, Radio: the assets within a radius (ST_DWithin in PostGIS) of the selected asset, the
 * selected installation or the middle of the network. The ring on the ground comes in a later step.
 */
export function RadiusPanel() {
  const assets = useAssets(),
    installations = useInstallations();
  const selected = useUI((s) => s.selectedAssetId),
    installationId = useUI((s) => s.installationId),
    select = useUI((s) => s.selectAsset),
    setInstallation = useUI((s) => s.setInstallation);
  const setRadius = useTool((s) => s.setRadius);
  const [radius, setMetres] = useState(250),
    [query, setQuery] = useState<{ lat: number; lng: number; radius: number } | null>(null);
  const installation = installations.data?.find((i) => i.id === installationId);
  const selectedAsset = assets.data?.find((a) => a.id === selected);
  const center =
    selectedAsset?.location ??
    installation?.location ??
    frameOf((installations.data ?? []).map((i) => i.location))?.center;
  const centerLabel = selectedAsset
    ? selectedAsset.name
    : installation
      ? `centro de ${installation.name}`
      : 'centro de la red';
  const nearby = useQuery({
    queryKey: ['geo', 'nearby', query],
    queryFn: () => api.nearby(query!.lat, query!.lng, query!.radius),
    enabled: !!query,
  });
  // The asset at the centre is not one of its own neighbours.
  const found = nearby.data?.filter((a) => a.id !== selectedAsset?.id);
  const foundCount = found?.length;
  useEffect(() => {
    setRadius(
      query && foundCount !== undefined ? { metres: query.radius, count: foundCount } : null,
    );
  }, [query, foundCount, setRadius]);
  useEffect(() => () => setRadius(null), [setRadius]);
  return (
    <div className="radius-panel">
      <p className="panel-note">
        Centro: <b>{centerLabel}</b>
      </p>
      <div className="row">
        <label className="field-inline">
          Radio
          <select
            aria-label="Radio de proximidad"
            value={radius}
            onChange={(e) => setMetres(Number(e.target.value))}
          >
            {RADII.map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn"
          disabled={!center}
          onClick={() => center && setQuery({ ...center, radius })}
        >
          Buscar cercanos
        </button>
      </div>
      {query &&
        (nearby.isPending ? (
          <Loading />
        ) : nearby.isError ? (
          <ErrorState error={nearby.error} />
        ) : (
          <>
            <p className="panel-note">
              {count(found?.length ?? 0, 'activo', 'activos')} a menos de{' '}
              {query.radius >= 1000 ? `${query.radius / 1000} km` : `${query.radius} m`} (toda la
              red) · <span className="f2">ST_DWithin · PostGIS</span>
            </p>
            <ul className="near-list">
              {(found ?? []).map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (installationId && a.installation_id !== installationId)
                        setInstallation(a.installation_id);
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
          </>
        ))}
    </div>
  );
}
