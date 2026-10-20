import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openScene } from './hud';

/*
 * When the set of LiDAR sheets changes (one becomes ready, one is deleted), the relief under the
 * globe is rebuilt. Giving Cesium a new terrain provider frees every globe tile at once, so for a
 * few seconds no ground was drawn at all (the scene went white under the clouds). The same
 * provider now takes the new heights and the tiles reload in place: the globe never draws an
 * empty frame. The test rebuilds the relief over the SYNTHETIC fixture sheet both ways.
 */
const fixture = 'apps/worker/tests/fixtures/synthetic-laguna-duero.laz';
const layerName = 'E2E · relieve sin huecos';
let layer: { id: string; center: { lat: number; lng: number } } | undefined;

test.beforeAll(async ({ request }) => {
  test.setTimeout(180000);
  const buffer = readFileSync(fixture);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  for (const l of await (await request.get('/api/layers')).json())
    if (l.source.sha256 === sha256 || l.name === layerName)
      expect((await request.delete(`/api/layers/${l.id}`)).status()).toBe(204);
  const created = await request.post(`/api/layers?name=${encodeURIComponent(layerName)}`, {
    multipart: {
      file: { name: 'synthetic-laguna-duero.laz', mimeType: 'application/octet-stream', buffer },
    },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { id: string }).id;
  await expect
    .poll(
      async () => {
        const list = (await (await request.get('/api/layers')).json()) as {
          id: string;
          status: string;
          center: { lat: number; lng: number } | null;
        }[];
        const found = list.find((l) => l.id === id);
        if (found?.status === 'ready' && found.center) layer = { id, center: found.center };
        return found?.status;
      },
      { timeout: 120000 },
    )
    .toBe('ready');
});
test.afterAll(async ({ request }) => {
  if (layer) await request.delete(`/api/layers/${layer.id}`);
});

interface Rebuild {
  frames: number;
  empty: number;
  loaded: boolean;
  inPlace: boolean;
}

test('rebuilding the relief keeps the ground on screen while its tiles reload', async ({
  page,
}) => {
  test.setTimeout(150000);
  // The rebuilds are bound by the scene's renders: each reload of the view's tiles takes some 45
  // of them, and at 1280 × 720 under SwiftShader on a loaded machine a render took over a second,
  // so a reload came close to the 60 s the test gives it. The relief does not need a large view:
  // at 800 × 500 the reload needs fewer and cheaper renders.
  await page.setViewportSize({ width: 800, height: 500 });
  const map = await openScene(page);
  await expect(map).toHaveAttribute('data-terrain', 'lidar', { timeout: 60000 });
  // Over the sheet, looking down at it.
  await page.evaluate(({ lng, lat }) => {
    const v = (window as unknown as { __geotwinViewer: import('cesium').Viewer }).__geotwinViewer;
    const r = Math.PI / 180;
    v.camera.cancelFlight();
    v.camera.setView({
      destination: v.scene.globe.ellipsoid.cartographicToCartesian({
        longitude: lng * r,
        latitude: (lat - 0.004) * r,
        height: 1200,
      } as import('cesium').Cartographic),
      orientation: { heading: 0, pitch: -50 * r, roll: 0 },
    });
    v.scene.requestRenderMode = false;
    // Frames drawn from this view on, and how many of them had ground.
    const w = window as unknown as { __groundFrames: number };
    w.__groundFrames = 0;
    const surface = (v.scene.globe as unknown as { _surface: { _tilesToRender: unknown[] } })
      ._surface;
    v.scene.postRender.addEventListener(() => {
      if (surface._tilesToRender.length > 0) w.__groundFrames++;
    });
  }, layer!.center);
  // The ground is on screen: frames of this view draw globe tiles. Not every tile of the view has
  // to be in (on a loaded machine that took a minute of the test's budget): the new provider below
  // frees them all and the rebuild waits until they are loaded again.
  const ground = () =>
    page.evaluate(() => (window as unknown as { __groundFrames: number }).__groundFrames);
  await expect.poll(ground, { timeout: 60000 }).toBeGreaterThan(3);

  /** Rebuilds the relief with the same heights, in place or with a new provider (as before). */
  const rebuild = (inPlace: boolean) =>
    page.evaluate(async (inPlace): Promise<Rebuild> => {
      type Viewer = import('cesium').Viewer;
      type Provider = import('cesium').TerrainProvider;
      const provider = (await import(
        '/src/features/layers/lidar-terrain-provider.ts' as string
      )) as {
        createLidarTerrainProvider(terrain: unknown): Provider;
        refreshLidarTerrain(viewer: Viewer, provider: Provider, terrain: unknown): boolean;
      };
      const { useScene } = (await import('/src/stores/viewer.ts' as string)) as {
        useScene: { getState(): { lidar: unknown } };
      };
      const v = (window as unknown as { __geotwinViewer: Viewer }).__geotwinViewer;
      const terrain = useScene.getState().lidar;
      const surface = (v.scene.globe as unknown as { _surface: { _tilesToRender: unknown[] } })
        ._surface;
      const counts: number[] = [];
      const off = v.scene.postRender.addEventListener(() =>
        counts.push(surface._tilesToRender.length),
      );
      let done = false;
      if (inPlace) done = provider.refreshLidarTerrain(v, v.terrainProvider, terrain);
      else v.terrainProvider = provider.createLidarTerrainProvider(terrain);
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () =>
          (counts.length > 10 && v.scene.globe.tilesLoaded) || performance.now() - start > 60000
            ? resolve()
            : setTimeout(tick, 200);
        tick();
      });
      off();
      return {
        frames: counts.length,
        empty: counts.filter((n) => n === 0).length,
        loaded: v.scene.globe.tilesLoaded,
        inPlace: done,
      };
    }, inPlace);

  // The cause: a new provider leaves the globe with nothing to draw until its tiles load.
  const swapped = await rebuild(false);
  expect(swapped.loaded).toBe(true);
  expect(swapped.empty, 'a new provider blanks the globe').toBeGreaterThan(0);
  // The fix: the same provider, new heights, every frame still has ground.
  const refreshed = await rebuild(true);
  expect(refreshed.inPlace).toBe(true);
  expect(refreshed.loaded).toBe(true);
  expect(refreshed.frames).toBeGreaterThan(10);
  expect(refreshed.empty, 'frames without any ground tile').toBe(0);
});
