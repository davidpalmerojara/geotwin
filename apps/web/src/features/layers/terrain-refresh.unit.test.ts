import { describe, expect, it } from 'vitest';
import {
  refreshStep,
  TERRAIN_READY,
  TERRAIN_UNLOADED,
  TILE_LOADING,
  type SurfaceTileLike,
  type TileLike,
  type VertexArrayLike,
} from './terrain-refresh';

const DONE = 2,
  RECEIVING = 2,
  TRANSFORMED = 5;
class Va implements VertexArrayLike {
  destroyed = false;
  isDestroyed() {
    return this.destroyed;
  }
}
const generations = new WeakMap<object, number>();
function tile(generation: number | undefined, terrainState = TERRAIN_READY): TileLike {
  const terrainData = {};
  if (generation !== undefined) generations.set(terrainData, generation);
  return { state: DONE, data: { terrainState, terrainData, vertexArray: new Va() } };
}
const generationOf = (terrainData: object) => generations.get(terrainData);

describe('Refreshing the LiDAR ground in place', () => {
  it('sends old tiles back to load while they keep drawing their mesh', () => {
    const old = tile(1),
      fresh = tile(2),
      upsampled = tile(undefined);
    const kept = new Map<SurfaceTileLike, VertexArrayLike>();
    const freed: VertexArrayLike[] = [];
    const before = old.data!.vertexArray;
    const step = refreshStep([old, fresh, upsampled], generationOf, 2, kept, (v) => freed.push(v));
    expect(step).toEqual({ reset: 1, loading: 0 });
    // Loading again, but still with its vertex array: the ground stays on screen.
    expect(old.state).toBe(TILE_LOADING);
    expect(old.data!.terrainState).toBe(TERRAIN_UNLOADED);
    expect(old.data!.vertexArray).toBe(before);
    // Current or foreign data is left alone.
    expect(fresh.state).toBe(DONE);
    expect(upsampled.state).toBe(DONE);
    expect(freed).toEqual([]);
  });

  it('waits for tiles on their way and frees each old mesh once, after its replacement', () => {
    const kept = new Map<SurfaceTileLike, VertexArrayLike>();
    const freed: VertexArrayLike[] = [];
    const free = (v: VertexArrayLike) => {
      freed.push(v);
      (v as Va).destroyed = true;
    };
    const busy = tile(1, RECEIVING),
      a = tile(1),
      b = tile(1);
    const oldA = a.data!.vertexArray as Va,
      oldB = b.data!.vertexArray as Va;
    expect(refreshStep([busy, a, b], generationOf, 2, kept, free)).toEqual({
      reset: 2,
      loading: 1,
    });
    // Asked again but not yet answered: nothing to do, nothing freed.
    expect(refreshStep([busy, a, b], generationOf, 2, kept, free)).toEqual({
      reset: 0,
      loading: 1,
    });
    expect(freed).toEqual([]);
    // a gets its new mesh (new data, new vertex array): the old one is freed, once.
    const fresh = {};
    generations.set(fresh, 2);
    a.data!.terrainData = fresh;
    a.data!.vertexArray = new Va();
    a.data!.terrainState = TERRAIN_READY;
    // b is dropped by Cesium's tile cache, which destroys the vertex array it still had.
    oldB.destroyed = true;
    b.data!.vertexArray = undefined;
    // The busy tile arrives with the old heights: it is sent back on the next step.
    busy.data!.terrainState = TRANSFORMED;
    expect(refreshStep([busy, a, b], generationOf, 2, kept, free).loading).toBe(1);
    busy.data!.terrainState = TERRAIN_READY;
    expect(refreshStep([busy, a, b], generationOf, 2, kept, free).reset).toBe(1);
    expect(freed).toEqual([oldA]);
    expect(kept.has(a.data!)).toBe(false);
    expect(kept.has(b.data!)).toBe(false);
  });
});
