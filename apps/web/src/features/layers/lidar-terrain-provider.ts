/**
 * Puts the ground models (DTM) of the ready layers under the globe as a Cesium terrain, so the
 * imagery, the assets (clamped to terrain) and the point clouds share real heights without
 * Cesium ion. Lives in the lazy Cesium chunk.
 */
import { useEffect, useRef, useState } from 'react';
import {
  CustomHeightmapTerrainProvider,
  EllipsoidTerrainProvider,
  GeographicTilingScheme,
  Math as CesiumMath,
  type TerrainProvider,
  type Viewer,
} from 'cesium';
import { dtmMetaSchema } from '@geotwin/shared';
import { useLayers } from '../../hooks/data';
import {
  buildTerrain,
  decodeDtm,
  tileHeights,
  type DtmGrid,
  type LidarTerrain,
} from './lidar-terrain';

const TILE_SIZE = 65;
// Decoded grids are kept per URL: the URLs are immutable (one folder per processing run).
const grids = new Map<string, Promise<DtmGrid>>();

async function loadGrid(url: string): Promise<DtmGrid> {
  const metaResponse = await fetch(url);
  if (!metaResponse.ok) throw new Error(`DTM ${metaResponse.status}`);
  const meta = dtmMetaSchema.parse(await metaResponse.json());
  const data = await fetch(new URL(meta.data, new URL(url, window.location.href)));
  if (!data.ok) throw new Error(`DTM ${data.status}`);
  return decodeDtm(meta, await data.arrayBuffer());
}
function cachedGrid(url: string) {
  let grid = grids.get(url);
  if (!grid) {
    grid = loadGrid(url);
    grids.set(url, grid);
    grid.catch(() => grids.delete(url));
  }
  return grid;
}

export function createLidarTerrainProvider(terrain: LidarTerrain): TerrainProvider {
  const tilingScheme = new GeographicTilingScheme();
  return new CustomHeightmapTerrainProvider({
    width: TILE_SIZE,
    height: TILE_SIZE,
    tilingScheme,
    callback: (x, y, level) => {
      const r = tilingScheme.tileXYToRectangle(x, y, level);
      return tileHeights(
        terrain,
        {
          west: CesiumMath.toDegrees(r.west),
          south: CesiumMath.toDegrees(r.south),
          east: CesiumMath.toDegrees(r.east),
          north: CesiumMath.toDegrees(r.north),
        },
        TILE_SIZE,
      );
    },
  });
}

export type LidarTerrainState = 'off' | 'loading' | 'on' | 'error';

/**
 * Keeps `viewer.terrainProvider` on the LiDAR ground while `enabled` (the «Relieve LiDAR»
 * option, and no ion terrain loaded) and at least one ready layer has a DTM; otherwise the plain
 * ellipsoid. Returns the state and the terrain itself, for camera framing at ground height.
 */
export function useLidarTerrain(viewer: Viewer | null, ready: boolean, enabled: boolean) {
  const layers = useLayers().data;
  const urls = (layers ?? [])
    .filter((l) => l.status === 'ready' && l.terrain_url)
    .map((l) => l.terrain_url!)
    .sort();
  const key = urls.join('|');
  const [state, setState] = useState<{ state: LidarTerrainState; terrain?: LidarTerrain }>({
    state: 'off',
  });
  // Our provider, so switching off never replaces a terrain someone else (ion) put there.
  const ours = useRef<TerrainProvider | null>(null);
  useEffect(() => {
    if (!viewer || !ready) return;
    let cancelled = false;
    const reset = () => {
      if (!viewer.isDestroyed() && ours.current && viewer.terrainProvider === ours.current)
        viewer.terrainProvider = new EllipsoidTerrainProvider();
      ours.current = null;
    };
    if (!enabled || !key) {
      reset();
      setState({ state: 'off' });
      return;
    }
    setState((s) => ({ ...s, state: s.terrain ? s.state : 'loading' }));
    void Promise.allSettled(key.split('|').map(cachedGrid)).then((results) => {
      if (cancelled || viewer.isDestroyed()) return;
      const loaded = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      const terrain = buildTerrain(loaded);
      if (!terrain) {
        reset();
        setState({ state: 'error' });
        return;
      }
      const provider = createLidarTerrainProvider(terrain);
      ours.current = provider;
      viewer.terrainProvider = provider;
      viewer.scene.requestRender();
      setState({ state: loaded.length < results.length ? 'error' : 'on', terrain });
    });
    return () => {
      cancelled = true;
    };
  }, [viewer, ready, enabled, key]);
  // Give the globe back when the viewer goes away (or this hook stops being used).
  useEffect(
    () => () => {
      ours.current = null;
    },
    [viewer],
  );
  return state;
}
