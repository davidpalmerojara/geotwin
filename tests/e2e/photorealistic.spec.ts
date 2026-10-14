import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { ASSET, CENTRE, CREDIT, fakeIon, MESH_HEIGHT } from './fake-ion';

/*
 * The «Fotorrealista (Google)» layer without Google: Cesium ion's endpoint for the Google
 * Photorealistic 3D Tiles asset (2275207) is answered here with a small local tileset (a flat
 * 3 × 3 km mesh at the ground height of Torrelago), so the toggle, the hidden globe, the assets
 * clamped to the mesh, measuring on it, the on-screen credit and the error messages run without
 * a real token or network. Nothing here touches Google's servers or a real ion account.
 */
interface DevViewer {
  scene: {
    globe: {
      show: boolean;
      ellipsoid: {
        cartographicToCartesian(c: object): unknown;
        cartesianToCartographic(c: unknown): { height: number };
      };
    };
    canvas: HTMLCanvasElement;
    requestRender(): void;
    pickPosition(p: { x: number; y: number }): unknown;
  };
  camera: { setView(options: object): void };
  imageryLayers: { length: number; get(i: number): { show: boolean } };
  entities: {
    values: { id: string; point?: { heightReference?: { getValue(t: unknown): number } } }[];
  };
  clock: { currentTime: unknown };
}
type DevWindow = Window & { __geotwinViewer?: DevViewer };

const map = (page: Page) => page.getByTestId('cesium-view');
/** Whether each imagery layer above the Natural Earth base (the PNOA one) is shown. */
const overlayLayersShown = () => {
  const layers = (window as DevWindow).__geotwinViewer!.imageryLayers;
  return Array.from({ length: layers.length - 1 }, (_, i) => layers.get(i + 1).show);
};
const toggle = (page: Page) =>
  page.getByRole('button', { name: 'Fotorrealista (Google)', exact: true });

async function open(page: Page) {
  await page.goto('/gemelo');
  await expect(map(page)).toHaveAttribute('data-ready', 'true', { timeout: 60000 });
  // Without a token the option is not offered (a Compose build without one, for instance).
  if (!(await toggle(page).count())) test.skip(true, 'Built without VITE_CESIUM_ION_TOKEN');
}

/** Looks straight down at the mesh from 600 m and returns the ellipsoidal height picked there. */
async function pickedHeightAtCentre(page: Page) {
  return page.evaluate(
    async ({ lng, lat, h }) => {
      const v = (window as DevWindow).__geotwinViewer!;
      const r = Math.PI / 180;
      const scene = v.scene;
      const ellipsoid = scene.globe.ellipsoid;
      v.camera.setView({
        destination: ellipsoid.cartographicToCartesian({
          longitude: lng * r,
          latitude: lat * r,
          height: h + 600,
        }),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      for (let i = 0; i < 40; i++) {
        scene.requestRender();
        await new Promise((done) => setTimeout(done, 250));
        const picked = scene.pickPosition({
          x: scene.canvas.clientWidth / 2,
          y: scene.canvas.clientHeight / 2,
        });
        if (picked) return ellipsoid.cartesianToCartographic(picked).height;
      }
      return null;
    },
    { ...CENTRE, h: MESH_HEIGHT },
  );
}

test('Fotorrealista (Google) replaces the globe and keeps assets and measuring on top', async ({
  page,
}) => {
  test.setTimeout(150000);
  const requests = await fakeIon(page);
  await open(page);
  // The PNOA orthophoto (mock tiles from the fixture) is on before the mesh.
  await expect(map(page)).toHaveAttribute('data-pnoa', 'on', { timeout: 30000 });
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await toggle(page).click();
  await expect(map(page)).toHaveAttribute('data-photoreal', 'on', { timeout: 60000 });
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  expect(requests.some((url) => url.includes(`/v1/assets/${ASSET}/endpoint`))).toBe(true);
  // The tiles include the ground: the globe (and the LiDAR relief on it) is hidden.
  expect(await page.evaluate(() => (window as DevWindow).__geotwinViewer!.scene.globe.show)).toBe(
    false,
  );
  // The provider's attribution is shown on the map, not only behind the credits link, once the
  // mesh has loaded (several seconds under a software renderer).
  await expect(page.locator('.cesium-widget-credits')).toContainText(CREDIT, { timeout: 30000 });
  await expect(page.locator('.map-top')).toContainText('FOTORREALISTA');
  // The PNOA layer goes with the globe, and its credit with it.
  await expect(map(page)).toHaveAttribute('data-base-imagery', 'google');
  expect(await page.evaluate(overlayLayersShown)).toEqual([false]);
  await expect(page.locator('.cesium-widget-credits')).not.toContainText('Ortofoto PNOA');
  // The mesh hides the base map: its control is disabled (and keeps its value) meanwhile.
  const base = page.getByRole('button', { name: 'Alternar cartografía', exact: true });
  await expect(base).toBeDisabled();
  await expect(base).toHaveAttribute('title', /Oculto con Fotorrealista/);
  await expect(base).toHaveAttribute('aria-pressed', 'true');

  // Assets stand on the mesh: their height is taken from the 3D tiles, not from the terrain.
  const references = await page.evaluate(() => {
    const v = (window as DevWindow).__geotwinViewer!;
    return v.entities.values
      .filter((e) => e.id.startsWith('asset:'))
      .map((e) => e.point?.heightReference?.getValue(v.clock.currentTime));
  });
  expect(references.length).toBeGreaterThan(0);
  // HeightReference.RELATIVE_TO_3D_TILE
  expect(new Set(references)).toEqual(new Set([6]));

  // A click lands on the mesh (what the measuring tool reads).
  const picked = await pickedHeightAtCentre(page);
  expect(picked).not.toBeNull();
  expect(Math.abs(picked! - MESH_HEIGHT)).toBeLessThan(1.5);

  // Measuring still works on top: two clicks on the flat mesh give a distance and no height
  // difference. The clicks stay clear of the «Capas» panel and of the tool's own panel.
  await page.getByRole('button', { name: 'Medir', exact: true }).click();
  await expect(page.getByText('0/2 puntos')).toBeVisible({ timeout: 20000 });
  const box = (await page.locator('.cesium-widget canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await expect(page.getByText('1/2 puntos')).toBeVisible({ timeout: 20000 });
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.2);
  const results = page.getByTestId('measure-results');
  await expect(results).toContainText(/Horizontal\s*\d+(,\d+)?\s*m/i, { timeout: 20000 });
  await expect(results).toContainText(/Desnivel\s*[±+−-]0,0\d\s*m/i);
  await page.getByRole('button', { name: 'Medir', exact: true }).click();

  // Switching it off brings the globe and the LiDAR view back.
  await toggle(page).click();
  await expect(map(page)).toHaveAttribute('data-photoreal', 'off');
  expect(await page.evaluate(() => (window as DevWindow).__geotwinViewer!.scene.globe.show)).toBe(
    true,
  );
  await expect(page.locator('.cesium-widget-credits')).not.toContainText(CREDIT);
  await expect(base).toBeEnabled();
  await expect(map(page)).toHaveAttribute('data-base-imagery', 'pnoa');
  expect(await page.evaluate(overlayLayersShown)).toEqual([true]);
});

test('Fotorrealista (Google) gives up when its root content fails, and a click starts over', async ({
  page,
}) => {
  test.setTimeout(150000);
  // The tileset arrives but its root content answers 500 once: nothing could ever be drawn.
  let mesh = 500;
  const requests = await fakeIon(page, 200, () => mesh);
  const endpoint = () => requests.filter((url) => url.includes(`/v1/assets/${ASSET}/endpoint`));
  await open(page);
  await toggle(page).click();
  await expect(map(page)).toHaveAttribute('data-photoreal', 'error', { timeout: 60000 });
  await expect(page.locator('.map-message')).toContainText(
    'No se pudo cargar la capa fotorrealista de Google. Sigue la vista LiDAR.',
  );
  expect(await page.evaluate(() => (window as DevWindow).__geotwinViewer!.scene.globe.show)).toBe(
    true,
  );
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(map(page)).toHaveAttribute('data-base-imagery', 'pnoa');
  // The failed tileset was dropped: the next click asks ion again and the mesh loads.
  const asked = endpoint().length;
  mesh = 200;
  await toggle(page).click();
  await expect(map(page)).toHaveAttribute('data-photoreal', 'on', { timeout: 60000 });
  expect(endpoint().length).toBeGreaterThan(asked);
  await expect(page.locator('.cesium-widget-credits')).toContainText(CREDIT, { timeout: 30000 });
  await expect(page.locator('.map-message')).toHaveCount(0);
});

test('Fotorrealista (Google) gives up when no tile arrives in 30 s', async ({ page }) => {
  test.setTimeout(150000);
  // The root content request never gets an answer.
  await fakeIon(page, 200, () => 'hang');
  await open(page);
  await toggle(page).click();
  await expect(map(page)).toHaveAttribute('data-photoreal', 'on', { timeout: 60000 });
  await expect(map(page)).toHaveAttribute('data-photoreal', 'error', { timeout: 60000 });
  await expect(page.locator('.map-message')).toContainText('ninguna tesela en 30 s');
  expect(await page.evaluate(() => (window as DevWindow).__geotwinViewer!.scene.globe.show)).toBe(
    true,
  );
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
});

for (const [status, text] of [
  [401, /no da acceso/],
  [429, /cuota/],
] as const) {
  test(`Fotorrealista (Google) with HTTP ${status} keeps the LiDAR view`, async ({ page }) => {
    await fakeIon(page, status);
    await open(page);
    await toggle(page).click();
    await expect(map(page)).toHaveAttribute('data-photoreal', 'error', { timeout: 30000 });
    await expect(page.locator('.map-message')).toContainText(text);
    await expect(page.locator('.map-message')).toContainText('Sigue la vista LiDAR');
    expect(await page.evaluate(() => (window as DevWindow).__geotwinViewer!.scene.globe.show)).toBe(
      true,
    );
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  });
}

test('Fotorrealista (Google) can be tried again after a failure, without reloading', async ({
  page,
}) => {
  test.setTimeout(150000);
  let status = 0;
  const requests = await fakeIon(page, () => status);
  const endpoint = () => requests.filter((url) => url.includes(`/v1/assets/${ASSET}/endpoint`));
  await open(page);
  await toggle(page).click();
  await expect(map(page)).toHaveAttribute('data-photoreal', 'error', { timeout: 30000 });
  await expect(page.locator('.map-message')).toContainText('Sin conexión');
  const asked = endpoint().length;
  expect(asked).toBeGreaterThan(0);
  // The connection is back: the next click asks ion again and the layer loads.
  status = 200;
  await toggle(page).click();
  await expect(map(page)).toHaveAttribute('data-photoreal', 'on', { timeout: 60000 });
  expect(endpoint().length).toBeGreaterThan(asked);
  await expect(page.locator('.map-message')).toHaveCount(0);
});
