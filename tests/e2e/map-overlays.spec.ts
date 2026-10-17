import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { coveredCredits, openCapas } from './hud';

// The camera must leave every framed installation clear of the HUD's plates (the Capas panel, the
// tool bar, the readout and credits...), which float over the full-screen scene.
interface Marker {
  name: string;
  x: number;
  y: number;
}
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface DevViewer {
  camera: { positionWC: { x: number; y: number; z: number } };
  clock: { currentTime: unknown };
  entities: {
    values: { id: string; name?: string; position?: { getValue(time: unknown): unknown } }[];
  };
  scene: {
    canvas: HTMLCanvasElement;
    // Camera flights in progress.
    tweens: { length: number };
    cartesianToCanvasCoordinates(position: unknown): { x: number; y: number } | undefined;
  };
}

/** Camera position, rounded to decimetres. */
function cameraAt(page: Page) {
  return page.evaluate(() => {
    const v = (window as Window & { __geotwinViewer?: DevViewer }).__geotwinViewer;
    if (!v) return 'no viewer';
    const p = v.camera.positionWC;
    return [p.x, p.y, p.z].map((n) => n.toFixed(1)).join(',');
  });
}
/**
 * Waits for a flight that a click has just requested to start: under a software renderer the
 * first frame of the flight can take seconds, and a camera that has not moved yet looks settled.
 */
async function moved(page: Page, from: string) {
  await expect.poll(() => cameraAt(page), { timeout: 20000, intervals: [200] }).not.toBe(from);
}

/** Waits until the camera stops moving (flights last about a second). */
async function settle(page: Page) {
  let previous = '';
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => {
          const v = (window as Window & { __geotwinViewer?: DevViewer }).__geotwinViewer;
          if (!v) return 'no viewer';
          // A flight still running is not settled, even if two slow frames look alike.
          if (v.scene.tweens.length) return `flying ${Math.random()}`;
          const p = v.camera.positionWC;
          return [p.x, p.y, p.z].map((n) => n.toFixed(1)).join(',');
        });
        const still = now === previous && now !== 'no viewer';
        previous = now;
        return still;
      },
      { timeout: 20000, intervals: [400] },
    )
    .toBe(true);
}

/** Installation markers on screen (page coordinates), with the canvas and panel boxes. */
function screen(page: Page) {
  return page.evaluate(() => {
    const v = (window as Window & { __geotwinViewer?: DevViewer }).__geotwinViewer!;
    const canvas = v.scene.canvas.getBoundingClientRect();
    const markers: Marker[] = [];
    for (const entity of v.entities.values) {
      if (!entity.id.startsWith('installation:') || !entity.position) continue;
      const at = v.scene.cartesianToCanvasCoordinates(
        entity.position.getValue(v.clock.currentTime),
      );
      if (at)
        markers.push({
          name: entity.name ?? entity.id,
          x: canvas.left + at.x,
          y: canvas.top + at.y,
        });
    }
    const box = (r: DOMRect): Box => ({
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
    });
    const plates = [...document.querySelectorAll('[data-map-overlay]')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map(box);
    return { markers, canvas: box(canvas), plates };
  });
}

// A marker and its label (about 160 px wide, 50 px below it) are on the scene and clear of every
// plate of the HUD.
function hidden({ markers, canvas, plates }: Awaited<ReturnType<typeof screen>>) {
  return markers
    .filter(
      (m) =>
        m.x < canvas.left ||
        m.x > canvas.right ||
        m.y < canvas.top ||
        m.y > canvas.bottom ||
        plates.some(
          (p) => m.x + 80 > p.left && m.x - 80 < p.right && m.y + 63 > p.top && m.y - 10 < p.bottom,
        ),
    )
    .map((m) => m.name);
}

for (const width of [1280, 1440])
  test(`the camera frames every installation beside the open Capas panel at ${width} x 900`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/gemelo');
    await expect(page.getByTestId('cesium-view')).toHaveAttribute('data-ready', 'true', {
      timeout: 30000,
    });
    // The first framing already leaves the plates out.
    await settle(page);
    const first = await screen(page);
    expect(first.markers.length).toBeGreaterThanOrEqual(3);
    expect(hidden(first)).toEqual([]);

    // With Capas open, «Encuadre inicial» frames the network beside it.
    await openCapas(page);
    await page.getByRole('button', { name: 'Acercar', exact: true }).click();
    const zoomed = await cameraAt(page);
    await page.getByRole('button', { name: 'Encuadre inicial', exact: true }).click();
    await moved(page, zoomed);
    await settle(page);
    const network = await screen(page);
    expect(network.markers.length).toBeGreaterThanOrEqual(3);
    expect(hidden(network)).toEqual([]);

    // One installation: its marker and label stay clear of the panel too.
    const select = page.getByLabel('Seleccionar instalación');
    const value = await select.locator('option').nth(1).getAttribute('value');
    const before = await cameraAt(page);
    await select.selectOption(value!);
    await moved(page, before);
    await settle(page);
    const one = await screen(page);
    const name = await select.locator('option').nth(1).textContent();
    const own = one.markers.filter((m) => m.name === name);
    expect(own).toHaveLength(1);
    expect(hidden({ ...one, markers: own })).toEqual([]);
  });

test('on a phone the measuring panel leaves the credits readable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/gemelo');
  await expect(page.getByTestId('cesium-view')).toHaveAttribute('data-ready', 'true', {
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Medir', exact: true }).click();
  const tool = page.getByRole('region', { name: 'Medir' });
  await expect(tool).toBeVisible();
  const credits = page.getByTestId('credits');
  await expect(credits).toContainText('telemetría simulada');
  // The panel docks once the credits are laid out; compare their boxes after it settles.
  await expect
    .poll(async () => {
      const [a, b] = [await tool.boundingBox(), await credits.boundingBox()];
      return !!a && !!b && a.y + a.height <= b.y;
    })
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('on a phone the installation labels keep clear of each other and of the plates', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/gemelo');
  await expect(page.getByTestId('cesium-view')).toHaveAttribute('data-ready', 'true', {
    timeout: 30000,
  });
  await settle(page);
  type Labels = { boxes: Box[]; blocked: Box[] };
  const labels = () =>
    page.evaluate(() => {
      const w = window as Window & { __geotwinLabels?: Labels };
      const canvas = document.querySelector('.cesium-widget canvas')!.getBoundingClientRect();
      const c = document.querySelector('.tool-bar')!.getBoundingClientRect();
      return {
        ...(w.__geotwinLabels ?? { boxes: [], blocked: [] }),
        // The tool bar measured here, independently of the viewer's own list.
        controls: {
          left: c.left - canvas.left,
          right: c.right - canvas.left,
          top: c.top - canvas.top,
          bottom: c.bottom - canvas.top,
        },
      };
    });
  await expect.poll(async () => (await labels()).boxes.length).toBeGreaterThanOrEqual(2);
  const { boxes, blocked, controls } = await labels();
  const apart = (a: Box, b: Box) =>
    a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
  for (let i = 0; i < boxes.length; i++) {
    expect(apart(boxes[i]!, controls), `label ${i} under the controls`).toBe(true);
    for (const b of blocked) expect(apart(boxes[i]!, b)).toBe(true);
    for (let j = i + 1; j < boxes.length; j++)
      expect(apart(boxes[i]!, boxes[j]!), `labels ${i} and ${j} overlap`).toBe(true);
  }

  // Without LiDAR relief a gateway on a 42 m tower roof is drawn on the globe, not in mid-air,
  // and a note says how to see it at its height.
  const layers = (await (await request.get('/api/layers')).json()) as {
    status: string;
    terrain_url: string | null;
  }[];
  test.skip(
    layers.some((l) => l.status === 'ready' && l.terrain_url),
    'a layer with a ground model is loaded: the map has relief',
  );
  await expect(page.getByTestId('relief-hint')).toContainText('Carga las hojas LiDAR en Capas');
  const height = await page.evaluate(() => {
    type V = {
      entities: { getById(id: string): { position: { getValue(t: unknown): unknown } } };
      clock: { currentTime: unknown };
      scene: { globe: { ellipsoid: { cartesianToCartographic(p: unknown): { height: number } } } };
    };
    const v = (window as Window & { __geotwinViewer?: V }).__geotwinViewer!;
    const gateway = v.entities.getById('asset:20000000-0000-4000-8000-000000000001');
    return v.scene.globe.ellipsoid.cartesianToCartographic(
      gateway.position.getValue(v.clock.currentTime),
    ).height;
  });
  expect(Math.abs(height)).toBeLessThan(0.01);
});

// The CC-BY credits (PNOA-LiDAR, PNOA orthophoto) must stay readable with the Capas panel open,
// with an error message (no orthophoto) and with the relief note, on desktop and on a phone.
async function openAndCheckCredits(page: Page, pnoa: 'on' | 'error', capas = false) {
  await page.goto('/gemelo');
  const map = page.getByTestId('cesium-view');
  await expect(map).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  await expect(map).toHaveAttribute('data-pnoa', pnoa, { timeout: 30000 });
  if (capas) await openCapas(page);
  if (pnoa === 'on') await expect(page.getByTestId('credits')).toContainText('Ortofoto PNOA');
  return coveredCredits(page);
}

for (const [width, height] of [
  [1280, 800],
  [1440, 900],
])
  test(`the map credits stay clear of the open Capas panel at ${width} x ${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const { shown, covered } = await openAndCheckCredits(page, 'on', true);
    await expect(page.getByRole('region', { name: 'Capas', exact: true })).toBeVisible();
    expect(shown).toBeGreaterThan(100);
    expect(covered).toEqual([]);
  });

test('on a phone the relief note leaves the map credits readable', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { shown, covered } = await openAndCheckCredits(page, 'on');
  expect(shown).toBeGreaterThan(100);
  expect(covered).toEqual([]);
  const layers = (await (await request.get('/api/layers')).json()) as { terrain_url: unknown }[];
  // Without a ground model the note is on screen (with one, the map has relief and no note).
  if (!layers.some((l) => l.terrain_url))
    await expect(page.getByTestId('relief-hint')).toBeVisible();
});

test.describe('without the orthophoto', () => {
  test.use({ pnoaMode: 'all-fail' });
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ])
    test(`the error message leaves the map credits readable at ${width} x ${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      const { shown, covered } = await openAndCheckCredits(page, 'error', width > 600);
      await expect(page.getByTestId('map-message')).toContainText('ortofoto PNOA');
      expect(shown).toBeGreaterThan(40);
      expect(covered).toEqual([]);
      // The message itself is not under the Capas panel.
      if (width > 600) {
        const [message, panel] = await Promise.all([
          page.getByTestId('map-message').boundingBox(),
          page.getByRole('region', { name: 'Capas', exact: true }).boundingBox(),
        ]);
        const apart =
          message!.x >= panel!.x + panel!.width ||
          panel!.x >= message!.x + message!.width ||
          message!.y >= panel!.y + panel!.height ||
          panel!.y >= message!.y + message!.height;
        expect(apart).toBe(true);
      }
    });
});
