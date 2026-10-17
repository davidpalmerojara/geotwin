import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { card, coveredCredits, openCapas, openScene, openSheet } from './hud';

/*
 * The floating HUD over the full-screen scene: no page scroll, plates that never overlap, credits
 * always readable, the one-key shortcuts and their guard, Esc and the focus, a viewer that is never
 * rebuilt, and the cursor readout over a LiDAR layer.
 */
const sizes = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];
// A fixture asset used by no other spec, with one active incident while the test runs.
const assetId = '20000000-0000-4000-8000-000000000010';

/** Pairs of plates (every element marked data-map-overlay) whose boxes overlap. */
function overlaps(page: Page) {
  return page.evaluate(() => {
    const plates = [...document.querySelectorAll('[data-map-overlay]')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        const name =
          el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.className;
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, name, el };
      })
      .filter((b) => b.right - b.left > 0 && b.bottom - b.top > 0);
    const found: string[] = [];
    for (let i = 0; i < plates.length; i++)
      for (let j = i + 1; j < plates.length; j++) {
        const a = plates[i]!,
          b = plates[j]!;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
          found.push(`${a.name} × ${b.name}`);
      }
    return found;
  });
}
const noScroll = (page: Page) =>
  page.evaluate(() => ({
    x: document.documentElement.scrollWidth <= innerWidth,
    y: document.documentElement.scrollHeight <= innerHeight,
    scrolled: scrollX === 0 && scrollY === 0,
  }));

for (const size of sizes)
  test(`plates float over the scene without overlapping at ${size.width} x ${size.height}`, async ({
    page,
    request,
  }) => {
    test.setTimeout(150000);
    // Re-runnable: clear incidents only on this dedicated fixture asset.
    const current = await request.get(`/api/alerts?asset_id=${assetId}&status=active`);
    for (const old of await current.json()) await request.patch(`/api/alerts/${old.id}/resolve`);
    const created = await request.post('/api/alerts', {
      data: { asset_id: assetId, severity: 'warning', message: 'Revisión de la interfaz (E2E)' },
    });
    expect(created.status()).toBe(201);
    const alert = (await created.json()) as { id: string };
    try {
      await page.setViewportSize(size);
      await openScene(page);
      // The scene runs to every edge and the page never scrolls.
      const canvas = await page.locator('.cesium-widget canvas').boundingBox();
      expect(canvas).toEqual({ x: 0, y: 0, width: size.width, height: size.height });
      expect(await noScroll(page)).toEqual({ x: true, y: true, scrolled: true });
      // The annunciator counts assets and shows the most severe active alarm (this one, a manual
      // warning, unless another spec left a worse one), with its tag.
      const alarm = page.getByTestId('annunciator-alarm');
      await expect(alarm).toContainText(/Advertencia|Crítico/);
      await expect(alarm).toContainText(/manual|simulado/);
      expect(await overlaps(page)).toEqual([]);
      expect((await coveredCredits(page)).covered).toEqual([]);

      // Capas and the asset card, then a sheet and the card: no overlaps, credits whole.
      await page.goto(`/gemelo?activo=${assetId}`);
      await expect(card(page).getByTestId('meter').first()).toBeVisible();
      await openCapas(page);
      await expect(page.getByRole('region', { name: 'Capas', exact: true })).toBeVisible();
      expect(await overlaps(page)).toEqual([]);
      const withCapas = await coveredCredits(page);
      expect(withCapas.shown).toBeGreaterThan(60);
      expect(withCapas.covered).toEqual([]);
      await openSheet(page, 'Alertas');
      await expect(page.getByRole('region', { name: 'Capas', exact: true })).toBeHidden();
      await expect(card(page)).toBeVisible();
      expect(await overlaps(page)).toEqual([]);
      expect((await coveredCredits(page)).covered).toEqual([]);
      expect(await noScroll(page)).toEqual({ x: true, y: true, scrolled: true });
      // Every panel, sheet and card ends at least 8 px above the credits plate.
      const credits = (await page.getByTestId('credits').boundingBox())!;
      for (const locator of [page.getByTestId('section-sheet'), card(page)]) {
        const box = (await locator.boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(credits.y - 8 + 0.5);
      }
    } finally {
      await request.patch(`/api/alerts/${alert.id}/resolve`);
    }
  });

test('keys 1, 2 and C work, but not while typing; Esc closes Capas and gives the focus back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openScene(page);
  const orbit = page.getByRole('button', { name: 'Orbitar', exact: true }),
    measure = page.getByRole('button', { name: 'Medir', exact: true }),
    capas = page.getByRole('button', { name: 'Capas', exact: true });
  await expect(orbit).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('2');
  await expect(measure).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Medir', exact: true })).toBeVisible();
  await page.keyboard.press('1');
  await expect(orbit).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Medir', exact: true })).toBeHidden();
  await page.keyboard.press('c');
  await expect(capas).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('C');
  await expect(capas).toHaveAttribute('aria-expanded', 'false');
  // Perfil and Corte are visible but not usable yet, and say why.
  const profile = page.getByRole('button', { name: 'Perfil', exact: true });
  await expect(profile).toHaveAttribute('aria-disabled', 'true');
  await expect(profile).toHaveAttribute('title', /paso posterior/);
  await page.keyboard.press('3');
  await expect(orbit).toHaveAttribute('aria-pressed', 'true');

  // Inside a text field the keys are text.
  await openSheet(page, 'Activos');
  const search = page.getByRole('textbox', { name: 'Buscar inventario' });
  await search.click();
  await page.keyboard.type('2c1');
  await expect(search).toHaveValue('2c1');
  await expect(orbit).toHaveAttribute('aria-pressed', 'true');
  await expect(capas).toHaveAttribute('aria-expanded', 'false');
  // Esc closes the sheet (the top-most thing open) even from the field.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('section-sheet')).toBeHidden();

  // Esc closes Capas and the focus returns to its button.
  await capas.click();
  const panel = page.getByRole('region', { name: 'Capas', exact: true });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Elegir', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(capas).toBeFocused();
  // So does its «Cerrar».
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Cerrar Capas' }).click();
  await expect(panel).toBeHidden();
  await expect(capas).toBeFocused();
});

test('opening and closing Resumen and Alertas never rebuilds the viewer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openScene(page);
  await page.locator('.cesium-widget canvas').evaluate((canvas) => {
    canvas.dataset.probe = 'same-viewer';
  });
  await openSheet(page, 'Resumen');
  await expect(page).toHaveURL(/\/resumen$/);
  await expect(page.getByTestId('active-alerts')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar Resumen' }).click();
  await expect(page).toHaveURL(/\/gemelo$/);
  await openSheet(page, 'Alertas');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('section-sheet')).toBeHidden();
  // Back reopens the sheet: it is a history entry.
  await page.goBack();
  await expect(page).toHaveURL(/\/alertas$/);
  await expect(page.getByTestId('section-sheet')).toBeVisible();
  await expect(page.locator('.cesium-widget canvas')).toHaveAttribute('data-probe', 'same-viewer');
  await expect(page.locator('.cesium-widget canvas')).toHaveCount(1);
});

// The SYNTHETIC fixture (not measured data): ground at 700 m orthometric, about 753 m ellipsoidal.
const fixture = 'apps/worker/tests/fixtures/synthetic-laguna-duero.laz';
const name = 'E2E · lectura del cursor';

test('the readout gives position, UTM, altitude and height above the ground over a LiDAR layer', async ({
  page,
  request,
}) => {
  test.setTimeout(240000);
  const buffer = readFileSync(fixture);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  for (const layer of await (await request.get('/api/layers')).json())
    if (layer.source.sha256 === sha256 || layer.name === name)
      expect((await request.delete(`/api/layers/${layer.id}`)).status()).toBe(204);
  const created = await request.post(`/api/layers?name=${encodeURIComponent(name)}`, {
    multipart: {
      file: { name: 'synthetic-laguna-duero.laz', mimeType: 'application/octet-stream', buffer },
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  try {
    await expect
      .poll(
        async () =>
          (
            (await (await request.get('/api/layers')).json()) as { id: string; status: string }[]
          ).find((l) => l.id === id)?.status,
        { timeout: 120000 },
      )
      .toBe('ready');
    await page.setViewportSize({ width: 1280, height: 800 });
    const map = await openScene(page);
    await expect(map).toHaveAttribute('data-terrain', 'lidar', { timeout: 60000 });
    await expect(map).toHaveAttribute('data-pointclouds', '1', { timeout: 60000 });
    // «Ir a» the layer: the camera flies there and frames it in the middle of the free area.
    await page.keyboard.press('/');
    await page.getByRole('combobox', { name: /Ir a/ }).fill('lectura del cursor');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);
    const readout = page.getByTestId('readout');
    const value = (key: string) => readout.getByTestId(`readout-${key}`);
    await expect(readout).toContainText('Cursor');
    await expect(value('cota')).toHaveText('—');
    // The middle of the scene between the tool bar and the bottom plates.
    for (const [x, y] of [
      [640, 430],
      [650, 440],
    ])
      await page.mouse.move(x, y, { steps: 4 });
    await expect(value('position')).toHaveText(/^41,\d{5}°\sN\s+4,\d{5}°\sO$/, { timeout: 20000 });
    await expect(value('utm')).toHaveText(/^3\d{2}\s\d{3},\d\s+4\s60\d\s\d{3},\d$/);
    // About 700 m above sea level and a few metres at most above the synthetic ground.
    await expect(value('cota')).toHaveText(/^(69\d|70\d),\d\sm$/, { timeout: 20000 });
    await expect(value('suelo')).toHaveText(/^(69\d|70\d),\d\sm$/);
    await expect(value('sobre')).toHaveText(/^[+−]?\d{1,2},\d\sm$/);
    // Without the relief the heights would not be true: «—» and the reason.
    await openCapas(page);
    await page.getByRole('checkbox', { name: 'Relieve del LiDAR', exact: true }).uncheck();
    await expect(map).toHaveAttribute('data-terrain', 'ellipsoid');
    await page.keyboard.press('Escape');
    // The globe reloads its tiles without the relief: move until the cursor lands on it again.
    let step = 0;
    await expect
      .poll(
        async () => {
          await page.mouse.move(640 + (step++ % 5) * 4, 430, { steps: 2 });
          return value('cota').getAttribute('title');
        },
        { timeout: 60000, intervals: [1000] },
      )
      .toBe('activa Relieve del LiDAR');
    await expect(value('cota')).toHaveText('—');
    await expect(value('position')).toHaveText(/°\sN/);
  } finally {
    expect((await request.delete(`/api/layers/${id}`)).status()).toBe(204);
  }
});
