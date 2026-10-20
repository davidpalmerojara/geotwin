import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { card, map, openScene, panel } from './hud';

/*
 * Once the camera stops and the tiles are in, the scene goes idle (request-render mode): nothing
 * the app places after a frame (the selected asset's mounting height, the tags, the installation
 * labels, Radio's distances, the edge chips) may move or come and go from one frame to the next,
 * nor ask for another frame. With Radio on, the value «41,9 m sobre el suelo» used to show and
 * hide on every frame, each frame asking for the next one.
 */
const towerId = '20000000-0000-4000-8000-000000000001';

// The mounting height is drawn on the LiDAR relief: the SYNTHETIC fixture layer, for this spec.
const fixture = 'apps/worker/tests/fixtures/synthetic-laguna-duero.laz';
const layerName = 'E2E · escena en reposo';
let layerId: string | undefined;

test.beforeAll(async ({ request }) => {
  test.setTimeout(180000);
  const buffer = readFileSync(fixture);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  for (const layer of await (await request.get('/api/layers')).json())
    if (layer.source.sha256 === sha256 || layer.name === layerName)
      expect((await request.delete(`/api/layers/${layer.id}`)).status()).toBe(204);
  const created = await request.post(`/api/layers?name=${encodeURIComponent(layerName)}`, {
    multipart: {
      file: { name: 'synthetic-laguna-duero.laz', mimeType: 'application/octet-stream', buffer },
    },
  });
  expect(created.status()).toBe(201);
  layerId = ((await created.json()) as { id: string }).id;
  await expect
    .poll(
      async () =>
        (
          (await (await request.get('/api/layers')).json()) as { id: string; status: string }[]
        ).find((l) => l.id === layerId)?.status,
      { timeout: 120000 },
    )
    .toBe('ready');
});
test.afterAll(async ({ request }) => {
  if (layerId) await request.delete(`/api/layers/${layerId}`);
});

type V = import('cesium').Viewer;

/**
 * Puts the camera `range` metres from the tower's mark, looking at it from `heading` degrees and
 * 45° down, as the views of the check (1,4 km from the east, 1,9 km from the south-south-west).
 */
async function lookAtTower(page: Page, range: number, heading: number) {
  await page.evaluate(
    async ([id, range, heading]) => {
      const { useScene } = (await import('/src/stores/viewer.ts' as string)) as {
        useScene: { getState(): { api: import('../../apps/web/src/stores/viewer').SceneApi } };
      };
      const asset = (await (await fetch(`/api/assets/${id}`)).json()) as {
        location: { lng: number; lat: number };
        mount_height_m: number;
      };
      const v = (window as unknown as { __geotwinViewer: V }).__geotwinViewer;
      const { lng, lat } = asset.location;
      const height = useScene.getState().api.groundAt(lng, lat) + asset.mount_height_m;
      const r = Math.PI / 180;
      const e = v.scene.globe.ellipsoid;
      const target = e.cartographicToCartesian({
        longitude: lng * r,
        latitude: lat * r,
        height,
      } as never);
      const up = e.geodeticSurfaceNormal(target, {} as never);
      const east = { x: -Math.sin(lng * r), y: Math.cos(lng * r), z: 0 };
      const north = {
        x: up.y * east.z - up.z * east.y,
        y: up.z * east.x - up.x * east.z,
        z: up.x * east.y - up.y * east.x,
      };
      const hd = heading * r,
        pt = -45 * r;
      const dE = Math.sin(hd) * Math.cos(pt),
        dN = Math.cos(hd) * Math.cos(pt),
        dU = Math.sin(pt);
      const dir = {
        x: east.x * dE + north.x * dN + up.x * dU,
        y: east.y * dE + north.y * dN + up.y * dU,
        z: east.z * dE + north.z * dN + up.z * dU,
      };
      v.camera.cancelFlight();
      v.camera.setView({
        destination: {
          x: target.x - dir.x * range,
          y: target.y - dir.y * range,
          z: target.z - dir.z * range,
        } as never,
        orientation: { heading: hd, pitch: pt, roll: 0 },
      });
      v.scene.requestRender();
    },
    [towerId, range, heading] as const,
  );
}

/** Waits until the camera has not moved for 1,5 s and every tile of the view has loaded. */
async function settled(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const v = (window as unknown as { __geotwinViewer: V }).__geotwinViewer;
          const w = window as unknown as { __e2eCam?: string; __e2eSince?: number };
          const c = v.camera.positionWC;
          const key = [c.x, c.y, c.z].map((n) => n.toFixed(2)).join(',');
          if (key !== w.__e2eCam) {
            w.__e2eCam = key;
            w.__e2eSince = performance.now();
          }
          let loaded = v.scene.globe.tilesLoaded;
          for (let i = 0; i < v.scene.primitives.length; i++) {
            const p = v.scene.primitives.get(i) as { isCesium3DTileset?: boolean; show: boolean };
            if (p.isCesium3DTileset && p.show && !(p as { tilesLoaded: boolean }).tilesLoaded)
              loaded = false;
          }
          if (!loaded) v.scene.requestRender();
          return loaded && performance.now() - w.__e2eSince! > 1500;
        }),
      { message: 'the camera is still and the tiles are in', timeout: 90000, intervals: [500] },
    )
    .toBe(true);
}

/**
 * Records every frame the scene draws for `ms` (after one requested frame): how many there are and
 * what the mounting height's value was after each one (shown or not, and where).
 */
async function record(page: Page, ms: number) {
  return page.evaluate(
    (ms) =>
      new Promise<{ frames: number; states: string[]; last: number }>((done) => {
        const v = (window as unknown as { __geotwinViewer: V }).__geotwinViewer;
        const states: string[] = [];
        const start = performance.now();
        let last = 0;
        const off = v.scene.postRender.addEventListener(() => {
          const value = document.querySelector<HTMLElement>('[data-testid="mount-dimension"]');
          last = performance.now() - start;
          states.push(
            !value || value.style.display === 'none'
              ? 'hidden'
              : `${Math.round(value.getBoundingClientRect().left)},${Math.round(value.getBoundingClientRect().top)}`,
          );
        });
        v.scene.requestRender();
        setTimeout(() => {
          off();
          done({ frames: states.length, states, last });
        }, ms);
      }),
    ms,
  );
}

const toggles = (states: string[]) => states.filter((s, i) => i > 0 && s !== states[i - 1]).length;

/** Draws `n` frames one after another, each requested once the last is done; the value after each. */
async function stepFrames(page: Page, n: number) {
  return page.evaluate(
    (n) =>
      new Promise<string[]>((done) => {
        const v = (window as unknown as { __geotwinViewer: V }).__geotwinViewer;
        const states: string[] = [];
        const off = v.scene.postRender.addEventListener(() => {
          const value = document.querySelector<HTMLElement>('[data-testid="mount-dimension"]')!;
          const box = value.getBoundingClientRect();
          states.push(
            value.style.display === 'none'
              ? 'hidden'
              : `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)}`,
          );
          if (states.length >= n) {
            off();
            done(states);
          } else setTimeout(() => v.scene.requestRender(), 0);
        });
        v.scene.requestRender();
      }),
    n,
  );
}

/**
 * Two plates beside the mounting dimension's value point, 13 px off it on either side: the value
 * (left or right of the line, or a step above or below either) fits in none of its six spots and
 * must stay hidden. A spot measured with the value hidden, as 0 × 0 px, fitted.
 */
async function hemIn(page: Page) {
  await page.evaluate(async (id) => {
    const v = (window as unknown as { __geotwinViewer: V }).__geotwinViewer;
    const { useScene } = (await import('/src/stores/viewer.ts' as string)) as {
      useScene: { getState(): { api: import('../../apps/web/src/stores/viewer').SceneApi } };
    };
    const { mountDimension } = (await import(
      '/src/features/measure/dimension-lines.ts' as string
    )) as typeof import('../../apps/web/src/features/measure/dimension-lines');
    const asset = (await (await fetch(`/api/assets/${id}`)).json()) as {
      location: { lng: number; lat: number };
      mount_height_m: number;
    };
    const { lng, lat } = asset.location;
    const ground = useScene.getState().api.groundAt(lng, lat);
    const label = mountDimension(lng, lat, ground, asset.mount_height_m).labels[0]!;
    const at = v.scene.cartesianToCanvasCoordinates(label.at);
    const canvas = v.scene.canvas.getBoundingClientRect();
    const x = canvas.left + at.x,
      y = canvas.top + at.y;
    for (const [left, right] of [
      [x - 260, x - 13],
      [x + 13, x + 260],
    ]) {
      const plate = document.createElement('div');
      plate.className = 'e2e-plate';
      plate.dataset.mapOverlay = '';
      plate.style.cssText = `position:fixed;left:${left}px;width:${right - left}px;top:${y - 70}px;height:140px;background:#0E0E0D;z-index:30`;
      document.body.append(plate);
    }
    v.scene.requestRender();
  }, towerId);
}

test('with Radio on, the mounting height and the scene settle once the camera stops', async ({
  page,
}) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScene(page, `/gemelo?activo=${towerId}`);
  await expect(map(page)).toHaveAttribute('data-terrain', 'lidar', { timeout: 60000 });
  await expect(card(page).getByRole('heading', { level: 2 })).toHaveText(
    'Pasarela LoRa · torre sur',
  );
  await page.keyboard.press('5');
  const radio = panel(page, 'Radio');
  await expect(radio).toBeVisible();
  await radio.getByLabel('Radio de proximidad').selectOption('300');
  await expect(map(page)).toHaveAttribute('data-radius', '300', { timeout: 60000 });
  await expect(page.getByTestId('mount-dimension')).toHaveText('41,9 m sobre el suelo');
  // As the check had it: 1,4 km from the east, 45° down.
  await lookAtTower(page, 1400, 90);
  await settled(page);
  // Let the placement settle on the still view (Radio's labels move once the camera stops and
  // again once the plates are steady, at most 3 s later).
  await page.waitForTimeout(4000);
  // Frame after frame the value keeps one state, shown at one spot or hidden.
  const free = await stepFrames(page, 8);
  expect(toggles(free), free.join(' ')).toBe(0);
  // With no room beside the line, it stays hidden, frame after frame.
  await hemIn(page);
  const hemmed = await stepFrames(page, 8);
  expect(hemmed.slice(1), hemmed.join(' ')).toEqual(Array(7).fill('hidden'));
  // And nothing asks for frames on its own: once the last placement has settled the scene is idle.
  await page.waitForTimeout(2000);
  const idle = await record(page, 5000);
  expect(toggles(idle.states), idle.states.join(' ')).toBe(0);
  expect(idle.frames, `${idle.frames} frames in 5 s: ${idle.states.join(' ')}`).toBeLessThanOrEqual(
    2,
  );
});
