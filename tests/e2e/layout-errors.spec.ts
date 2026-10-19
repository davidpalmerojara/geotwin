import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { card, map, menuButton, openCapas, openScene, panel } from './hud';

/*
 * Plates, panels, sheets, the card and the profile drawer resize one another as they open and
 * close (the stage measures the plates, the edge chips and the card watch their sizes): none of
 * that may raise a page error, «ResizeObserver loop completed with undelivered notifications»
 * among them, at desktop or at phone size.
 */
const sizes = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];
// A fixture asset used by no other spec's assertions.
const assetId = '20000000-0000-4000-8000-000000000005';

// Perfil needs the LiDAR relief: the SYNTHETIC fixture layer, loaded for this spec only.
const fixture = 'apps/worker/tests/fixtures/synthetic-laguna-duero.laz';
const layerName = 'E2E · capas sin errores';
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

/** Lets the page lay out and paint a few frames, so pending observers are delivered. */
const frames = (page: Page, n = 3) =>
  page.evaluate(
    (n) =>
      new Promise<void>((done) => {
        let left = n;
        const step = () => (--left <= 0 ? done() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    n,
  );

/**
 * The credits change as imagery tiles arrive and leave (a provider's line comes and goes): the
 * bottom plates grow by a line and shrink back, which moves where panels, sheets and the card end.
 */
async function creditsChange(page: Page) {
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      const plate = document.querySelector('[data-testid="credits"]')!;
      const line = document.createElement('div');
      line.className = 'e2e-credit';
      line.textContent = 'Ortofoto de prueba · una atribución larga que ocupa una línea más';
      (plate.querySelector('.credits-slot') ?? plate).append(line);
    });
    await frames(page);
    await page.evaluate(() => document.querySelectorAll('.e2e-credit').forEach((e) => e.remove()));
    await frames(page);
  }
}

/** Waits until the globe drawn under a page point can be picked (its terrain tiles are drawn). */
async function onGround(page: Page, x: number, y: number) {
  await expect
    .poll(
      () =>
        page.evaluate(
          ([x, y]) => {
            const v = (window as unknown as { __geotwinViewer: import('cesium').Viewer })
              .__geotwinViewer;
            v.scene.requestRender();
            const ray = v.camera.getPickRay({ x, y } as never);
            return !!ray && !!v.scene.globe.pick(ray, v.scene);
          },
          [x, y],
        ),
      { timeout: 30000 },
    )
    .toBe(true);
  return [x, y] as const;
}

/**
 * Every error the window reports, across reloads (a ResizeObserver loop is an ErrorEvent with no
 * error object, which the page's own listener sees as well as Playwright).
 */
async function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.exposeFunction('__e2eWindowError', (message: string) => errors.push(message));
  await page.addInitScript(() => {
    const report = (window as unknown as { __e2eWindowError: (m: string) => void })
      .__e2eWindowError;
    window.addEventListener('error', (event) => void report(String(event.message)));
  });
  return () => [...new Set(errors)];
}

for (const size of sizes)
  test(`opening and closing panels raises no page error (${size.name})`, async ({ page }) => {
    test.setTimeout(180000);
    const phone = size.width < 640;
    await page.setViewportSize(size);
    const errors = await collectErrors(page);
    await openScene(page);
    await expect(map(page)).toHaveAttribute('data-terrain', 'lidar', { timeout: 60000 });
    await frames(page);

    // Capas, open and closed twice (its list loads and grows the panel the first time).
    for (let i = 0; i < 2; i++) {
      const capas = await openCapas(page);
      await expect(capas).toBeVisible();
      await creditsChange(page);
      // On a phone Capas is a modal sheet over its own key: Esc closes it.
      if (phone) await page.keyboard.press('Escape');
      else await page.getByRole('button', { name: 'Capas', exact: true }).click();
      await expect(capas).toBeHidden();
      await frames(page);
    }

    // Two section sheets in turn, then closed with Esc.
    for (const name of ['Activos', 'Alertas'] as const) {
      await menuButton(page).click();
      await page
        .getByRole('navigation', { name: 'Secciones' })
        .getByRole('button', { name, exact: true })
        .click();
      const sheet = page.getByTestId('section-sheet');
      await expect(sheet.getByRole('heading', { name, exact: true })).toBeVisible();
      await creditsChange(page);
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await frames(page);
    }

    // The card, opened by its deep link and closed, then opened again with Capas beside it.
    await page.goto(`/gemelo?activo=${assetId}`);
    await expect(map(page)).toHaveAttribute('data-ready', 'true', { timeout: 60000 });
    await expect(card(page).getByTestId('meter').first()).toBeVisible();
    await creditsChange(page);
    await card(page).getByRole('button', { name: 'Cerrar la ficha' }).click();
    await expect(card(page)).toBeHidden();
    await frames(page);
    if (!phone) {
      await page.goto(`/gemelo?activo=${assetId}`);
      await expect(card(page).getByTestId('meter').first()).toBeVisible();
      await openCapas(page);
      await frames(page);
      await page.getByRole('button', { name: 'Capas', exact: true }).click();
      await expect(panel(page, 'Capas')).toBeHidden();
      await card(page).getByRole('button', { name: 'Cerrar la ficha' }).click();
      await expect(card(page)).toBeHidden();
    }

    // The profile drawer: A and B on the map, then Esc closes it.
    await page.getByRole('button', { name: 'Perfil', exact: true }).click();
    await expect(map(page)).toHaveAttribute('data-profile', 'on', { timeout: 30000 });
    const view = page.viewportSize()!;
    await page.mouse.click(...(await onGround(page, view.width * 0.4, view.height * 0.45)));
    await expect(page.getByTestId('profile-hint')).toContainText(/pon B/);
    await page.mouse.click(...(await onGround(page, view.width * 0.6, view.height * 0.5)));
    const drawer = page.getByTestId('profile-drawer');
    await expect(drawer).toBeVisible();
    // Under the chart, A at the left end of the axis and B at the right end, on one row.
    const ends = drawer.locator('.pd-legend kbd');
    await expect(ends).toHaveText(['A', 'B']);
    const [a, b] = await Promise.all([ends.nth(0).boundingBox(), ends.nth(1).boundingBox()]);
    const legend = (await drawer.locator('.pd-legend').boundingBox())!;
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
    expect(a!.x - legend.x).toBeLessThan(24);
    expect(legend.x + legend.width - (b!.x + b!.width)).toBeLessThan(24);
    await creditsChange(page);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await frames(page, 4);

    expect(errors()).toEqual([]);
  });
