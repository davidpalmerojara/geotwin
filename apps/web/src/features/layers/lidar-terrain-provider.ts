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
  type Scene,
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
import {
  refreshStep,
  type SurfaceTileLike,
  type TileLike,
  type VertexArrayLike,
} from './terrain-refresh';

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

/** The heights a provider draws from: replaced in place, numbered so tiles know their age. */
interface Source {
  terrain: LidarTerrain;
  generation: number;
}
const sources = new WeakMap<TerrainProvider, Source>();
// The generation of the heights each terrain tile was made from (Cesium's HeightmapTerrainData).
const generations = new WeakMap<object, number>();

export function createLidarTerrainProvider(terrain: LidarTerrain): TerrainProvider {
  const tilingScheme = new GeographicTilingScheme();
  const source: Source = { terrain, generation: 1 };
  const provider = new CustomHeightmapTerrainProvider({
    width: TILE_SIZE,
    height: TILE_SIZE,
    tilingScheme,
    callback: (x, y, level) => {
      const r = tilingScheme.tileXYToRectangle(x, y, level);
      return tileHeights(
        source.terrain,
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
  // Tag each tile's data with the generation of the heights it was cut from.
  const request = provider.requestTileGeometry.bind(provider);
  provider.requestTileGeometry = (x, y, level, req) => {
    const generation = source.generation;
    return request(x, y, level, req)?.then((data) => {
      if (data) generations.set(data, generation);
      return data;
    });
  };
  sources.set(provider, source);
  return provider;
}

interface TerrainVertexArray extends VertexArrayLike {
  destroy(): void;
  indexBuffer?: { isDestroyed(): boolean; destroy(): void; referenceCount?: number };
}
/**
 * Frees a terrain tile's vertex array as Cesium does (GlobeSurfaceTile._freeVertexArray): tiles of
 * one size share a reference-counted index buffer, which goes with its last user.
 */
function freeVertexArray(vertexArray: VertexArrayLike) {
  const array = vertexArray as TerrainVertexArray;
  const index = array.indexBuffer;
  if (!array.isDestroyed()) array.destroy();
  if (index && !index.isDestroyed() && index.referenceCount !== undefined) {
    index.referenceCount -= 1;
    if (index.referenceCount === 0) index.destroy();
  }
}

// Cesium's globe surface (a QuadtreePrimitive), private but stable within the pinned version.
interface Surface {
  forEachLoadedTile(callback: (tile: TileLike) => void): void;
}
// The refresh running on a scene, and the vertex arrays its tiles still draw from old heights.
const refreshing = new WeakMap<
  Scene,
  { stop: () => void; kept: Map<SurfaceTileLike, VertexArrayLike> }
>();

/**
 * Puts new heights under the globe without freeing its tiles (see terrain-refresh.ts): the
 * provider stays, its heights change, and every loaded tile reloads while it keeps drawing the
 * ground it had. False when this is not our provider or the globe is not as expected; the caller
 * then gives the globe a new provider.
 */
export function refreshLidarTerrain(
  viewer: Viewer,
  provider: TerrainProvider,
  terrain: LidarTerrain,
) {
  const source = sources.get(provider);
  const scene = viewer.scene;
  const surface = (scene.globe as unknown as { _surface?: Partial<Surface> })._surface;
  if (
    !source ||
    viewer.terrainProvider !== provider ||
    typeof surface?.forEachLoadedTile !== 'function'
  )
    return false;
  source.terrain = terrain;
  source.generation += 1;
  // A refresh still running gives way to this one, which also frees what it kept.
  const previous = refreshing.get(scene);
  previous?.stop();
  const kept = previous?.kept ?? new Map<SurfaceTileLike, VertexArrayLike>();
  const step = () => {
    if (viewer.isDestroyed()) return stop();
    const tiles: TileLike[] = [];
    surface.forEachLoadedTile!((tile) => tiles.push(tile));
    const { reset, loading } = refreshStep(
      tiles,
      (data) => generations.get(data),
      source.generation,
      kept,
      freeVertexArray,
    );
    // Keep frames coming while tiles reload (the scene renders on request).
    if (reset || loading) scene.requestRender();
    else if (!kept.size) stop();
  };
  const off = scene.postRender.addEventListener(step);
  const stop = () => {
    off();
    if (refreshing.get(scene)?.stop === stop) refreshing.delete(scene);
  };
  refreshing.set(scene, { stop, kept });
  scene.requestRender();
  return true;
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
      // A sheet more or less: the same provider takes the new heights, so the ground stays on
      // screen while the tiles reload (a new provider would blank the globe until they do).
      if (!ours.current || !refreshLidarTerrain(viewer, ours.current, terrain)) {
        const provider = createLidarTerrainProvider(terrain);
        ours.current = provider;
        viewer.terrainProvider = provider;
      }
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
