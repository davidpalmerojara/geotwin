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

/**
 * The place plate's parts as drawn: every visible leaf (text, tag, glyph, the selector) clipped by
 * the boxes that hide their overflow. Returns the pairs that are drawn over each other, the parts
 * drawn outside the plate, and how much of the alarm's asset name shows.
 */
function placePlateLayout(page: Page) {
  return page.evaluate(() => {
    const plate = document.querySelector<HTMLElement>('[data-testid="place-plate"]')!;
    const outer = plate.getBoundingClientRect();
    type Box = { left: number; right: number; top: number; bottom: number };
    const seen = (el: Element): Box | null => {
      const r = el.getBoundingClientRect();
      let box: Box = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      for (let p = el.parentElement; p && p !== plate.parentElement; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (style.clip !== 'auto') return null;
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        const c = p.getBoundingClientRect();
        box = {
          left: Math.max(box.left, c.left),
          right: Math.min(box.right, c.right),
          top: Math.max(box.top, c.top),
          bottom: Math.min(box.bottom, c.bottom),
        };
      }
      return box.right - box.left > 1 && box.bottom - box.top > 1 ? box : null;
    };
    const parts = [...plate.querySelectorAll('span, b, svg, select, kbd')]
      .filter(
        (el) => !el.parentElement?.closest('svg') && !el.querySelector('span, b, svg, select'),
      )
      .filter((el) => getComputedStyle(el).clip === 'auto')
      .map((el) => ({ el, box: seen(el), text: (el.textContent ?? '').trim() || el.tagName }))
      .filter((p): p is { el: Element; box: Box; text: string } => p.box !== null);
    const overprinted: string[] = [];
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i]!.box,
          b = parts[j]!.box;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left),
          h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 1 && h > 1) overprinted.push(`${parts[i]!.text} × ${parts[j]!.text}`);
      }
    const outside = parts
      .filter(
        ({ box }) =>
          box.left < outer.left - 0.5 ||
          box.right > outer.right + 0.5 ||
          box.top < outer.top - 0.5 ||
          box.bottom > outer.bottom + 0.5,
      )
      .map((p) => p.text);
    const name = plate.querySelector('.annun-name');
    const nameBox = name && seen(name);
    return {
      overprinted,
      outside,
      name: name?.textContent ?? '',
      nameShown: nameBox ? nameBox.right - nameBox.left : 0,
      nameWidth: name?.scrollWidth ?? 0,
    };
  });
}

// The documented desktop minimum (1024) and the tablet range (640–1023): the place plate gives way
// in steps and never draws its parts over each other, with the longest installation name chosen.
for (const size of [
  { width: 1024, height: 768 },
  { width: 900, height: 700 },
  { width: 700, height: 700 },
])
  test(`the place plate keeps its parts apart and the alarm readable at ${size.width} x ${size.height}`, async ({
    page,
    request,
  }) => {
    test.setTimeout(150000);
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
      const alarm = page.getByTestId('annunciator-alarm');
      await expect(alarm).toContainText(/Advertencia|Crítico/);
      await expect(alarm).toContainText(/manual|simulado/);
      const select = page.getByLabel('Seleccionar instalación');
      const names = await select.locator('option').allInnerTexts();
      const longest = names.reduce((a, b) => (b.length > a.length ? b : a));
      for (const choice of [names[0]!, longest]) {
        await select.selectOption({ label: choice });
        await expect(select.locator('option:checked')).toHaveText(choice);
        const layout = await placePlateLayout(page);
        expect(layout.overprinted).toEqual([]);
        expect(layout.outside).toEqual([]);
        // The asset of the alarm shows, whole or at least its first 60 px before the ellipsis.
        expect(layout.name.length).toBeGreaterThan(0);
        expect(layout.nameShown).toBeGreaterThanOrEqual(Math.min(layout.nameWidth, 60) - 0.5);
        await expect(alarm.getByText(/Advertencia|Crítico/)).toBeVisible();
        expect(await overlaps(page)).toEqual([]);
        expect(await noScroll(page)).toEqual({ x: true, y: true, scrolled: true });
        expect((await coveredCredits(page)).covered).toEqual([]);
      }
      // A tablet's tool keys show their icon beside the number when there is room for it.
      if (size.width < 1024 && size.width >= 800)
        await expect(page.locator('.tool-bar .soft-icon:visible')).toHaveCount(6);
      // The keys keep their names for screen readers at every width.
      await expect(page.getByRole('button', { name: 'Medir', exact: true })).toBeVisible();
    } finally {
      await request.patch(`/api/alerts/${alert.id}/resolve`);
    }
  });

/** Whether the asset's mark is on screen and outside every plate (a docked card, a sheet). */
function markInSight(page: Page, id: string) {
  return page.evaluate((id) => {
    const mark = document.querySelector<HTMLElement>(`.scene-mark[data-asset="${id}"]`);
    if (!mark || mark.style.display === 'none') return 'no mark';
    const r = mark.getBoundingClientRect();
    const x = r.left,
      y = r.top;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return 'off screen';
    const under = [...document.querySelectorAll('[data-map-overlay]')]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
      })
      .map((el) => el.getAttribute('data-testid') ?? el.className);
    return under.length ? `under ${under.join(', ')}` : 'in sight';
  }, id);
}

test('a shared link to an asset with a sheet frames it between the sheet and its card; Esc gives the focus to the scene', async ({
  page,
}) => {
  test.setTimeout(150000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openScene(page, `/alertas?activo=${assetId}`);
  await expect(page.getByTestId('section-sheet')).toBeVisible();
  await expect(card(page)).toBeVisible();
  // The card docks after the camera has been aimed: the view is aimed again once it settles,
  // so the asset is not left behind its own card.
  await expect.poll(() => markInSight(page, assetId), { timeout: 90000 }).toBe('in sight');
  // In sight, it has no edge chip.
  const name = (await card(page).locator('#asset-card-title').innerText()).trim();
  await expect(page.getByTestId('edge-chip').filter({ hasText: name })).toHaveCount(0);
  // Esc closes the sheet, then the card; the focus ends on the scene, not on the page body.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('section-sheet')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();
  await expect(page.getByTestId('cesium-view')).toBeFocused();
});

test('F «Centrar activo» flies back to the asset of the card, and says so when there is none', async ({
  page,
}) => {
  test.setTimeout(150000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScene(page, `/gemelo?activo=${assetId}`);
  await expect(card(page)).toBeVisible();
  await expect.poll(() => markInSight(page, assetId), { timeout: 90000 }).toBe('in sight');
  const centre = page.getByRole('button', { name: 'Centrar activo' });
  await expect(centre).toBeVisible();
  await expect(centre).toHaveAttribute('aria-keyshortcuts', 'F');
  // The camera goes 3 km east, looking further east: the asset is behind it...
  await page.evaluate(() => {
    const v = (window as unknown as { __geotwinViewer: import('cesium').Viewer }).__geotwinViewer;
    const at = v.camera.positionCartographic;
    v.camera.setView({
      destination: v.scene.globe.ellipsoid.cartographicToCartesian({
        longitude: at.longitude + 0.0006,
        latitude: at.latitude,
        height: 600,
      } as import('cesium').Cartographic),
      orientation: { heading: Math.PI / 2, pitch: -0.4, roll: 0 },
    });
    v.scene.requestRender();
  });
  await expect.poll(() => markInSight(page, assetId)).not.toBe('in sight');
  // ...and F brings it back into the free area, keeping the heading.
  await page.keyboard.press('f');
  await expect.poll(() => markInSight(page, assetId), { timeout: 30000 }).toBe('in sight');
  const heading = await page.evaluate(
    () =>
      (window as unknown as { __geotwinViewer: import('cesium').Viewer }).__geotwinViewer.camera
        .heading,
  );
  expect(heading).toBeCloseTo(Math.PI / 2, 2);
  // Without a card F has nothing to centre: a short note says so, and the button goes.
  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();
  await expect(centre).toBeHidden();
  await page.keyboard.press('f');
  await expect(page.getByTestId('hint')).toHaveText(/primero selecciona un activo/);
  await expect(page.getByTestId('hint')).toBeHidden({ timeout: 10000 });
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
  // Without LiDAR relief (no layers here) Perfil and Corte are disabled, and say why.
  const profile = page.getByRole('button', { name: 'Perfil', exact: true });
  await expect(profile).toHaveAttribute('aria-disabled', 'true');
  await expect(profile).toHaveAttribute('title', /Relieve del LiDAR/);
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

test('over an asset mark the readout gives that asset’s position, not dashes', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openScene(page);
  const readout = page.getByTestId('readout');
  const value = (key: string) => readout.getByTestId(`readout-${key}`);
  // A mark the layout shows and nothing covers (the marks sit over the canvas).
  await expect(page.locator('.scene-mark i:visible').first()).toBeVisible({ timeout: 30000 });
  const found = () =>
    page.evaluate(() => {
      for (const ring of document.querySelectorAll('.scene-mark i')) {
        const r = ring.getBoundingClientRect();
        if (!r.width) continue;
        const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
        if (document.elementFromPoint(x, y)?.closest('.scene-mark') === ring.parentElement)
          return { id: ring.parentElement!.getAttribute('data-asset')!, x, y };
      }
      return null;
    });
  await expect.poll(found).not.toBeNull();
  const { id, x, y } = (await found())!;
  const asset = (await (await request.get(`/api/assets/${id}`)).json()) as {
    location: { lat: number; lng: number };
  };
  const lat = asset.location.lat.toFixed(5).replace('.', ','),
    lng = Math.abs(asset.location.lng).toFixed(5).replace('.', ',');
  // From the scene onto the mark: the pointer leaves the canvas, the readout keeps a place.
  // A point of bare scene near the mark (no other mark, tag, label or plate on it).
  const [sx, sy] = await page.evaluate(
    ([x, y]) => {
      for (let r = 40; r < 400; r += 20)
        for (let a = 0; a < 360; a += 30) {
          const px = x! + r * Math.cos((a * Math.PI) / 180),
            py = y! + r * Math.sin((a * Math.PI) / 180);
          if (document.elementFromPoint(px, py)?.tagName === 'CANVAS') return [px, py];
        }
      return [x! + 40, y! + 40];
    },
    [x, y],
  );
  await page.mouse.move(sx!, sy!, { steps: 2 });
  await page.mouse.move(x, y, { steps: 4 });
  await expect(readout.locator('.ro-k').first()).toHaveText('Activo');
  await expect(value('position')).toHaveText(new RegExp(`^${lat}°\\sN\\s+${lng}°\\sO$`));
  await expect(value('utm')).toHaveText(/^\d{3}\s\d{3},\d\s+4\s\d{3}\s\d{3},\d$/);
  // Its Cota and height above the ground are there too (DTM plus mount; without the LiDAR relief
  // of this database they say why they are missing), unlike the shorter selection line.
  await expect(value('cota')).toBeVisible();
  await expect(value('sobre')).toBeVisible();
  await expect(value('sobre')).toHaveAttribute('title', 'activa Relieve del LiDAR');
  // Back on the scene, it reads the cursor again.
  await page.mouse.move(sx!, sy!, { steps: 4 });
  await expect(readout.locator('.ro-k').first()).toHaveText('Cursor');
  // The pointer stays still on the mark and the camera moves: the mark leaves the pointer, and
  // «Activo» goes with it.
  await page.mouse.move(x, y, { steps: 4 });
  await expect(readout.locator('.ro-k').first()).toHaveText('Activo');
  await page.evaluate(async () => {
    const { useScene } = (await import('/src/stores/viewer.ts' as string)) as {
      useScene: { getState(): { api: { zoom(direction: 1 | -1): void } } };
    };
    useScene.getState().api.zoom(-1);
  });
  await expect
    .poll(() =>
      page.evaluate(
        ([x, y]) => !document.elementFromPoint(x!, y!)?.closest('.scene-tags [data-asset]'),
        [x, y],
      ),
    )
    .toBe(true);
  await expect(readout.locator('.ro-k').first()).not.toHaveText('Activo');
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });
  test('a tap on an asset mark selects it and leaves no «Activo» behind', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openScene(page);
    const readout = page.getByTestId('readout');
    await expect(page.locator('.scene-mark i:visible').first()).toBeVisible({ timeout: 30000 });
    const found = () =>
      page.evaluate(() => {
        for (const ring of document.querySelectorAll('.scene-mark i')) {
          const r = ring.getBoundingClientRect();
          if (!r.width) continue;
          const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
          if (document.elementFromPoint(x, y)?.closest('.scene-mark') === ring.parentElement)
            return { x, y };
        }
        return null;
      });
    await expect.poll(found).not.toBeNull();
    const { x, y } = (await found())!;
    await page.touchscreen.tap(x, y);
    await expect(page.getByTestId('asset-card')).toBeVisible();
    await expect(readout.locator('.ro-k').first()).toHaveText('Selección');
  });
});
