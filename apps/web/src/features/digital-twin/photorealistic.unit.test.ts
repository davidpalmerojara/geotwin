import { describe, expect, it, vi } from 'vitest';
import { RequestErrorEvent } from 'cesium';
import {
  classifyPhotorealError,
  loadPhotorealistic,
  PhotorealError,
  statusOf,
  TileFailureWatch,
} from './photorealistic';

const online = () => true;

describe('Google Photorealistic 3D Tiles loader', () => {
  it('returns the tileset when ion and Google answer', async () => {
    const create = vi.fn(async () => ({ id: 'google' }));
    await expect(loadPhotorealistic(create, online)).resolves.toEqual({ id: 'google' });
    expect(create).toHaveBeenCalledOnce();
  });

  it('reports a token without access to the asset', async () => {
    for (const status of [401, 403, 404]) {
      const failure = loadPhotorealistic(async () => {
        throw new RequestErrorEvent(status);
      }, online);
      await expect(failure).rejects.toBeInstanceOf(PhotorealError);
      await expect(failure).rejects.toMatchObject({ problem: 'access' });
      await expect(failure).rejects.toThrow(/2275207/);
    }
  });

  it('reports a used-up quota', async () => {
    await expect(
      loadPhotorealistic(async () => {
        throw new RequestErrorEvent(429);
      }, online),
    ).rejects.toMatchObject({ problem: 'quota' });
    expect(classifyPhotorealError(new Error('Monthly quota exceeded'))).toBe('quota');
  });

  it('reports being offline, from the browser or from a request with no response', async () => {
    await expect(
      loadPhotorealistic(
        async () => {
          throw new RequestErrorEvent();
        },
        () => false,
      ),
    ).rejects.toMatchObject({ problem: 'offline' });
    // Cesium rejects a request that never got an answer with a RequestErrorEvent without status.
    expect(classifyPhotorealError(new RequestErrorEvent())).toBe('offline');
    expect(classifyPhotorealError(new TypeError('Failed to fetch'))).toBe('offline');
  });

  it('keeps anything else as an unknown failure with a message in Spanish', async () => {
    const failure = loadPhotorealistic(async () => {
      throw new Error('boom');
    }, online);
    await expect(failure).rejects.toMatchObject({ problem: 'unknown' });
    await expect(failure).rejects.toThrow(/Sigue la vista LiDAR/);
    expect(classifyPhotorealError(new RequestErrorEvent(500))).toBe('unknown');
  });

  it('reads the status from Cesium errors and tile failure messages', () => {
    expect(statusOf(new RequestErrorEvent(403))).toBe(403);
    expect(statusOf({ status: 429 })).toBe(429);
    expect(statusOf('Request has failed. Status Code: 401')).toBe(401);
    expect(statusOf(new Error('Failed to load tile'))).toBeUndefined();
  });
});

describe('Tile failures after the layer is shown', () => {
  it('stops at once when a tile request is refused', () => {
    const watch = new TileFailureWatch(8, online);
    expect(watch.failed({ message: 'Request has failed. Status Code: 429' })).toBe('quota');
    expect(watch.failed({ message: 'Request has failed. Status Code: 403' })).toBe('access');
  });

  it('tolerates a few lost tiles, and a loaded tile resets the count', () => {
    const watch = new TileFailureWatch(3, online);
    expect(watch.failed({ message: 'Request has failed. Status Code: 500' })).toBeUndefined();
    expect(watch.failed({ message: 'Request has failed. Status Code: 500' })).toBeUndefined();
    watch.loaded();
    expect(watch.failed({ message: 'Request has failed. Status Code: 500' })).toBeUndefined();
    expect(watch.failed({ message: 'Request has failed. Status Code: 500' })).toBeUndefined();
    expect(watch.failed({ message: 'Request has failed. Status Code: 500' })).toBe('unknown');
  });

  it('reports the connection when the browser goes offline', () => {
    const watch = new TileFailureWatch(2, () => false);
    expect(watch.failed({ message: 'Request has failed.' })).toBeUndefined();
    expect(watch.failed({ message: 'Request has failed.' })).toBe('offline');
  });
});
