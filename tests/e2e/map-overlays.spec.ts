import { test, expect, type Page } from '@playwright/test';

// The camera must leave every framed installation outside the «Capas» panel, which floats over
// the right of the map and is open by default on desktop.
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
    cartesianToCanvasCoordinates(position: unknown): { x: number; y: number } | undefined;
  };
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
    const panel = document.querySelector('.layers-panel')!.getBoundingClientRect();
    return { markers, canvas: box(canvas), panel: box(panel) };
  });
}

// A marker and its label (about 160 px wide, 50 px below it) are clear of the panel and on the map.
function hidden({ markers, canvas, panel }: Awaited<ReturnType<typeof screen>>) {
  return markers
    .filter(
      (m) =>
        m.x < canvas.left ||
        m.x > canvas.right ||
        m.y < canvas.top ||
        m.y > canvas.bottom ||
        (m.x + 80 > panel.left && m.y + 60 > panel.top && m.y < panel.bottom),
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
    const panel = page.getByRole('region', { name: 'Capas LiDAR' });
    await expect(panel.getByRole('button', { name: /Capas/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await settle(page);
    const network = await screen(page);
    expect(network.markers.length).toBeGreaterThanOrEqual(3);
    expect(hidden(network)).toEqual([]);

    // «Centrar red» frames the same way.
    await page.getByRole('button', { name: 'Acercar', exact: true }).click();
    await page.getByRole('button', { name: 'Centrar red', exact: true }).click();
    await settle(page);
    expect(hidden(await screen(page))).toEqual([]);

    // One installation: its marker and label stay clear of the panel too.
    const select = page.getByLabel('Seleccionar instalación');
    const value = await select.locator('option').nth(1).getAttribute('value');
    await select.selectOption(value!);
    await settle(page);
    const one = await screen(page);
    const name = await select.locator('option').nth(1).textContent();
    const own = one.markers.filter((m) => m.name === name);
    expect(own).toHaveLength(1);
    expect(hidden({ ...one, markers: own })).toEqual([]);
  });
