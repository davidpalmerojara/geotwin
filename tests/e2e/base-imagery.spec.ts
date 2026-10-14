import { test, expect, type PnoaRequest } from './fixtures';
import type { Page } from '@playwright/test';

/*
 * The PNOA orthophoto under the clouds, with every PNOA server answered by the fixture (MOCK
 * checkerboard tiles, never the real imagery): the source probe, the on-screen credit, the
 * toggle to the offline atlas, and the fallbacks when a source is blocked, down or missing.
 */
// Torrelago, where the probe tile is.
const TORRELAGO = { lng: -4.7252, lat: 41.589 };

async function openTwin(page: Page) {
  await page.goto('/gemelo');
  const map = page.getByTestId('cesium-view');
  await expect(map).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  return map;
}

/** Looks down at Torrelago from `height` m and renders until the globe has its tiles. */
async function frameTorrelago(page: Page, height = 700) {
  await page.evaluate(
    ({ lng, lat, height }) => {
      type V = import('cesium').Viewer;
      const v = (window as unknown as { __geotwinViewer: V }).__geotwinViewer;
      const r = Math.PI / 180;
      v.camera.setView({
        destination: v.scene.globe.ellipsoid.cartographicToCartesian({
          longitude: lng * r,
          latitude: lat * r,
          height,
        } as import('cesium').Cartographic),
        orientation: { heading: 0, pitch: -80 * r, roll: 0 },
      });
      v.scene.requestRender();
    },
    { ...TORRELAGO, height },
  );
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const v = (window as unknown as { __geotwinViewer: import('cesium').Viewer })
            .__geotwinViewer;
          v.scene.requestRender();
          return v.scene.globe.tilesLoaded;
        }),
      { timeout: 60000 },
    )
    .toBe(true);
}

/**
 * Share of the map's pixels in the mock tiles' magenta and violet (never in real ground). The
 * panels over the map cover part of it.
 */
async function mockShare(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { __geotwinViewer: import('cesium').Viewer }
    ).__geotwinViewer.scene.requestRender(),
  );
  await page.waitForTimeout(300);
  const shot = await page.locator('.cesium-widget canvas').screenshot();
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let mock = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 1]! < 70 && pixels[i]! > 80 && pixels[i + 2]! > 70) mock++;
    return mock / (pixels.length / 4);
  }, shot.toString('base64'));
}

const deep = (log: PnoaRequest[], source: PnoaRequest['source']) =>
  log.filter((r) => r.source === source && r.z >= 16).length;

test('the orthophoto drapes the globe, credits the IGN and gives way to the offline atlas', async ({
  page,
  pnoa,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const map = await openTwin(page);
  await expect(map).toHaveAttribute('data-pnoa', 'on');
  await expect(map).toHaveAttribute('data-pnoa-source', 'idee');
  await expect(map).toHaveAttribute('data-base-imagery', 'pnoa');
  await expect(page.locator('.map-top')).toContainText('ORTOFOTO PNOA');
  // /ortho/ (no local copy here) was probed first and refused, then IDEE.
  expect(pnoa[0]).toMatchObject({ source: 'local', status: 404 });
  expect(
    pnoa.some((r) => r.source === 'idee' && r.z === 15 && r.x === 15953 && r.y === 12214),
  ).toBe(true);

  await frameTorrelago(page);
  await expect.poll(() => deep(pnoa, 'idee')).toBeGreaterThan(0);
  const credits = page.locator('.cesium-widget-credits');
  await expect(credits).toContainText('Ortofoto PNOA máxima actualidad CC-BY 4.0');
  await expect(credits).toContainText('scne.es');
  await expect(credits).toContainText('Instituto Geográfico Nacional');
  expect(await mockShare(page)).toBeGreaterThan(0.3);

  // Natural Earth: the photo layer is only hidden, its credit goes and no tile is asked for.
  const toggle = page.getByRole('button', { name: 'Alternar cartografía', exact: true });
  await toggle.click();
  await expect(map).toHaveAttribute('data-base-imagery', 'natural-earth');
  await expect(page.locator('.map-top')).toContainText('ATLAS NATURAL EARTH');
  await page.waitForTimeout(1500);
  const before = pnoa.length;
  await frameTorrelago(page, 450);
  expect(pnoa.length).toBe(before);
  expect(await mockShare(page)).toBeLessThan(0.01);
  await expect(credits).not.toContainText('scne.es');
  // Back to the photo: the same layer, no new probe.
  await toggle.click();
  await expect(map).toHaveAttribute('data-base-imagery', 'pnoa');
  await frameTorrelago(page, 450);
  expect(await mockShare(page)).toBeGreaterThan(0.3);
  expect(pnoa.filter((r) => r.source === 'local').length).toBe(1);
  expect(errors).toEqual([]);
});

test.describe('blocked by the browser (CORS)', () => {
  test.use({ pnoaMode: 'no-cors' });
  test('falls back to the IGN WMTS', async ({ page, pnoa }) => {
    const blocked: string[] = [];
    page.on('console', (m) => /blocked by CORS policy/.test(m.text()) && blocked.push(m.text()));
    const map = await openTwin(page);
    await expect(map).toHaveAttribute('data-pnoa-source', 'ign');
    await expect(map).toHaveAttribute('data-pnoa', 'on');
    await frameTorrelago(page);
    await expect.poll(() => deep(pnoa, 'ign')).toBeGreaterThan(0);
    expect(deep(pnoa, 'idee')).toBe(0);
    // A real CORS refusal by the browser, not a failed request.
    expect(blocked.some((m) => m.includes('tms-pnoa-ma.idee.es'))).toBe(true);
    expect(await mockShare(page)).toBeGreaterThan(0.3);
  });
});

test.describe('every source refused or unreachable', () => {
  test.use({ pnoaMode: 'all-fail' });
  test('says so and keeps the offline atlas', async ({ page }) => {
    const map = await openTwin(page);
    await expect(map).toHaveAttribute('data-pnoa', 'error', { timeout: 30000 });
    await expect(map).toHaveAttribute('data-base-imagery', 'natural-earth');
    await expect(page.getByTestId('map-message')).toHaveText(
      'No se pudo cargar la ortofoto PNOA (sin conexión o bloqueada por el navegador). Se muestra el atlas local.',
    );
    await expect(page.locator('.map-top')).toContainText(
      'ATLAS NATURAL EARTH (PNOA NO DISPONIBLE)',
    );
    await expect(page.locator('.cesium-widget-credits')).not.toContainText('scne.es');
    // Choosing the atlas on purpose removes the warning: the button says so.
    const base = page.getByRole('button', { name: 'Alternar cartografía', exact: true });
    await expect(base).toHaveAttribute('title', 'Ocultar el aviso y quedarse con el atlas');
    await base.click();
    await expect(page.getByTestId('map-message')).toBeHidden();
  });
});

test.describe('a source that stops answering', () => {
  test.use({ pnoaMode: 'outage' });
  test('hands over to the next one', async ({ page, pnoa }) => {
    const map = await openTwin(page);
    await expect(map).toHaveAttribute('data-pnoa-source', 'idee');
    await frameTorrelago(page);
    await expect(map).toHaveAttribute('data-pnoa-source', 'ign', { timeout: 30000 });
    expect(
      pnoa.filter((r) => r.source === 'idee' && r.status === 504).length,
    ).toBeGreaterThanOrEqual(8);
    await frameTorrelago(page, 500);
    await expect.poll(() => deep(pnoa, 'ign')).toBeGreaterThan(0);
  });
});

test.describe('downloaded tiles in apps/web/public/ortho', () => {
  test.use({ pnoaMode: 'local' });
  test('are used before any server', async ({ page, pnoa }) => {
    const map = await openTwin(page);
    await expect(map).toHaveAttribute('data-pnoa-source', 'local');
    await expect(page.locator('.map-top')).toContainText('ORTOFOTO PNOA (DESCARGADA)');
    await frameTorrelago(page);
    await expect.poll(() => deep(pnoa, 'local')).toBeGreaterThan(0);
    expect(pnoa.filter((r) => r.source !== 'local')).toEqual([]);
    expect(await mockShare(page)).toBeGreaterThan(0.3);
  });
});
