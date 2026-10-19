/**
 * Refreshing the globe's LiDAR ground in place. Giving Cesium a new terrain provider frees every
 * globe tile at once (GlobeSurfaceTileProvider invalidates the whole quadtree), so until the new
 * tiles load nothing of the ground is drawn: the scene went white under the clouds for a few
 * seconds each time a sheet became ready, and the scale said the centre of the view did not look
 * at the ground. Instead the provider stays and its heights change; each loaded tile is sent back
 * to load its terrain again while it keeps drawing the mesh it has, and that mesh is freed once
 * the new one replaces it.
 *
 * Pure bookkeeping over the few fields of Cesium's tiles it needs, so it is unit-tested without
 * WebGL. The states are Cesium's (private) TerrainState and QuadtreeTileLoadState values.
 */
export const TERRAIN_UNLOADED = 1;
export const TERRAIN_READY = 6;
export const TILE_LOADING = 1;

export interface VertexArrayLike {
  isDestroyed(): boolean;
}
/** The fields of a Cesium GlobeSurfaceTile that the refresh reads and writes. */
export interface SurfaceTileLike {
  terrainState: number;
  terrainData?: object;
  vertexArray?: VertexArrayLike;
}
/** The fields of a Cesium QuadtreeTile. */
export interface TileLike {
  state: number;
  data?: SurfaceTileLike;
}

export interface RefreshStep {
  /** Tiles sent back to load the new heights this step. */
  reset: number;
  /** Tiles still holding old heights while their terrain is on its way (nothing to do yet). */
  loading: number;
}

/**
 * One step, run after each frame while a refresh lasts. A tile drawn from an older generation of
 * the heights (`generationOf` its terrain data is below `current`) and done loading goes back to load
 * its terrain, keeping its vertex array (Cesium keeps a renderable tile renderable meanwhile);
 * one whose terrain is on its way is left to finish and picked up on a later step. Tiles whose
 * data is not ours (no generation: upsampled, or another provider's) are left alone. The vertex
 * arrays kept are freed (`free`) once the tile has a new one; a tile freed by Cesium in between
 * has already destroyed it.
 */
export function refreshStep(
  tiles: Iterable<TileLike>,
  generationOf: (terrainData: object) => number | undefined,
  current: number,
  kept: Map<SurfaceTileLike, VertexArrayLike>,
  free: (vertexArray: VertexArrayLike) => void,
): RefreshStep {
  let reset = 0,
    loading = 0;
  for (const tile of tiles) {
    const data = tile.data;
    const generation = data?.terrainData && generationOf(data.terrainData);
    if (!data || generation === undefined || generation >= current) continue;
    if (data.terrainState !== TERRAIN_READY) {
      // Back to UNLOADED by an earlier step and not yet asked again: the quadtree will ask when
      // the tile is in view. On its way (RECEIVING to TRANSFORMED): wait for it.
      if (data.terrainState !== TERRAIN_UNLOADED) loading++;
      continue;
    }
    if (data.vertexArray && !kept.has(data)) kept.set(data, data.vertexArray);
    data.terrainState = TERRAIN_UNLOADED;
    tile.state = TILE_LOADING;
    reset++;
  }
  for (const [data, old] of kept) {
    if (data.vertexArray === old) continue;
    if (!old.isDestroyed()) free(old);
    kept.delete(data);
  }
  return { reset, loading };
}
