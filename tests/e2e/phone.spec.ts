import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { card, coveredCredits, menuButton, openCapas, openScene, panel } from './hud';

// The phone layout (390 × 844, A/phone.png with the floating plates of C/phone.png): a top
// plate, a floating tool bar and bottom sheets that rest at 25, 45 and 90 %, with the CC-BY
// credits always on screen above whatever sheet is open.
const PHONE = { width: 390, height: 844 };
// Fixture assets used by no other spec.
const assetId = '20000000-0000-4000-8000-000000000003';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(PHONE);
});

/** Nothing runs past the right edge: neither the page nor the content of an open sheet. */
function overflow(page: Page) {
  return page.evaluate(() => {
    const wide: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth) wide.push('page');
    for (const el of document.querySelectorAll<HTMLElement>('.sheet-scroll, .panel-body'))
      if (el.scrollWidth > el.clientWidth + 1) wide.push(el.className);
    for (const el of document.querySelectorAll<HTMLElement>('[data-map-overlay]')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.left < -0.5 || r.right > innerWidth + 0.5)) wide.push(el.className);
    }
    return wide;
  });
}

/** The credits sit above the sheet, and nothing covers a character of them. */
async function creditsAbove(page: Page, sheet: Locator) {
  const { shown, covered } = await coveredCredits(page);
  expect(shown).toBeGreaterThan(60);
  expect(covered).toEqual([]);
  await expect
    .poll(async () => {
      const [c, s] = [await page.getByTestId('credits').boundingBox(), await sheet.boundingBox()];
      return !!c && !!s && c.y + c.height <= s.y;
    })
    .toBe(true);
}

const sheetOf = (page: Page) => card(page);
/** Waits for a sheet to rest at its snap (its top edge glides there in 0,18 s). */
async function rests(sheet: Locator, snap: number) {
  await expect(sheet).toHaveAttribute('data-snap', String(snap));
  await expect
    .poll(async () => Math.abs((await sheet.boundingBox())!.y - 844 * (1 - snap / 100)))
    .toBeLessThan(2);
}
const handle = (sheet: Locator) => sheet.getByRole('slider', { name: /Altura de la hoja/ });

/**
 * The asset sheet's jumps (Histórico, Cercanos y radio, Laboratorio) that are whole inside the
 * sheet, above the tool bar, and the first thing under their own middle (nothing over them).
 */
function jumpsInReach(page: Page) {
  return page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="asset-card"]')!.getBoundingClientRect();
    const bar = document.querySelector('.phone-tools')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('.asset-sheet .card-acts .btn')]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return (
          r.top >= sheet.top &&
          r.bottom <= sheet.bottom &&
          r.bottom <= bar.top &&
          (hit === b || b.contains(hit))
        );
      })
      .map((b) => b.textContent!.trim());
  });
}

test('the scene, the sheets and Capas fit the width of a phone', async ({ page }) => {
  await openScene(page);
  await expect(page.getByTestId('place-plate')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Herramientas del visor' })).toBeVisible();
  // No Radio key on the phone: it starts from the asset sheet.
  await expect(page.getByRole('button', { name: 'Radio', exact: true })).toHaveCount(0);
  // Every tool can be tapped: 44 px or more.
  for (const name of ['Orbitar', 'Medir', 'Perfil', 'Corte', 'Capas']) {
    const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
    expect(box.height, name).toBeGreaterThanOrEqual(44);
    expect(box.width, name).toBeGreaterThanOrEqual(44);
  }
  expect(await overflow(page)).toEqual([]);
  for (const path of ['/resumen', '/activos', '/alertas', '/ajustes']) {
    await openScene(page, path);
    await expect(page.getByTestId('section-sheet')).toBeVisible();
    expect(await overflow(page), path).toEqual([]);
  }
  await openScene(page);
  await openCapas(page);
  expect(await overflow(page), 'Capas').toEqual([]);
});

test('the asset sheet rests at 25, 45 and 90 %, and is modal only at 90 %', async ({ page }) => {
  await openScene(page, `/gemelo?activo=${assetId}`);
  const sheet = sheetOf(page);
  await expect(sheet.getByTestId('meter').first()).toBeVisible();
  await rests(sheet, 45);
  await expect(sheet).not.toHaveAttribute('role', 'dialog');
  // At 45 % its three jumps are whole and in reach, above the sheet's edge and the tool bar.
  await expect
    .poll(() => jumpsInReach(page))
    .toEqual(['Histórico', 'Cercanos y radio', 'Laboratorio']);
  // The keyboard: arrows on the handle.
  await handle(sheet).focus();
  await page.keyboard.press('ArrowUp');
  await expect(sheet).toHaveAttribute('data-snap', '90');
  await expect(sheet).toHaveAttribute('role', 'dialog');
  await expect(sheet).toHaveAttribute('aria-modal', 'true');
  // At 90 % the focus stays inside the sheet.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await handle(sheet).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await rests(sheet, 25);
  await expect(sheet).not.toHaveAttribute('aria-modal', 'true');
  // A drag on the handle: up rests at the nearest snap.
  const box = (await handle(sheet).boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 120, { steps: 12 });
  await page.mouse.move(x, y - 160, { steps: 12 });
  await page.mouse.up();
  await rests(sheet, 45);
  // «Histórico» raises the sheet to 90 % at its section; «Cercanos y radio» starts Radio.
  await sheet.getByRole('button', { name: 'Histórico', exact: true }).click();
  await expect(sheet).toHaveAttribute('data-snap', '90');
  await expect(sheet.getByRole('heading', { name: /Histórico/ })).toBeInViewport();
  for (const name of [/Incidencias activas/, /Cercanos y radio/, /Laboratorio de anomalías/])
    await expect(sheet.getByRole('heading', { name })).toBeAttached();
  await sheet.getByRole('button', { name: 'Activos a menos de…' }).click();
  await expect(panel(page, 'Radio')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel(page, 'Radio')).toBeHidden();
  // Back to the asset sheet, which Esc closes; a drag well below its lowest snap closes it too.
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await page.goto(`/gemelo?activo=${assetId}`);
  await rests(sheet, 45);
  const grab = (await handle(sheet).boundingBox())!;
  await page.mouse.move(grab.x + 40, grab.y + 10);
  await page.mouse.down();
  await page.mouse.move(grab.x + 40, 820, { steps: 20 });
  await page.mouse.up();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/\/gemelo$/);
});

test('the CC-BY credits stay above every sheet, Capas and the Medir panel', async ({ page }) => {
  test.setTimeout(150000);
  // The asset sheet at 45 %.
  await openScene(page, `/gemelo?activo=${assetId}`);
  await expect(sheetOf(page).getByTestId('meter').first()).toBeVisible();
  await creditsAbove(page, sheetOf(page));
  // The same sheet at 90 %: the plates behind it step aside, the credits stay.
  await handle(sheetOf(page)).focus();
  await page.keyboard.press('End');
  await expect(sheetOf(page)).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByTestId('place-plate')).toBeHidden();
  await creditsAbove(page, sheetOf(page));
  await page.keyboard.press('Escape');
  // Medir, a sheet at 45 % beside the scene.
  await openScene(page);
  await page.getByRole('button', { name: 'Medir', exact: true }).click();
  const measure = panel(page, 'Medir');
  await expect(measure).toBeVisible();
  await expect(measure).toHaveAttribute('data-snap', '45');
  await creditsAbove(page, measure);
  // Its crosshair sits in the middle of the scene left between the top plates and the credits
  // over the sheet (the middle of the screen would be on the credits), and «Centro» measures
  // the point under it.
  await rests(measure, 45);
  const cross = page.getByTestId('measure-crosshair');
  await expect
    .poll(async () => {
      const c = (await cross.boundingBox())!;
      const at = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
      return page.evaluate((at) => {
        const plates = [...document.querySelectorAll('[data-map-overlay]')]
          .map((p) => p.getBoundingClientRect())
          .filter((b) => b.width > 0);
        const under = plates.some(
          (b) => at.x >= b.left && at.x <= b.right && at.y >= b.top && at.y <= b.bottom,
        );
        const above = Math.max(...plates.filter((b) => b.bottom < at.y).map((b) => b.bottom));
        const below = Math.min(...plates.filter((b) => b.top > at.y).map((b) => b.top));
        const credits = document.querySelector('[data-testid="credits"]')!.getBoundingClientRect();
        return {
          under,
          centred: Math.abs(at.y - (above + below) / 2) < 2 && Math.abs(at.x - innerWidth / 2) < 2,
          aboveCredits: at.y < credits.top,
        };
      }, at);
    })
    .toEqual({ under: false, centred: true, aboveCredits: true });
  await measure.getByRole('button', { name: 'Añadir punto en el centro' }).click();
  const c = (await cross.boundingBox())!;
  await expect
    .poll(() =>
      page.evaluate(() => {
        const v = (window as unknown as { __geotwinViewer: import('cesium').Viewer })
          .__geotwinViewer;
        const point = v.dataSources
          .getByName('medicion')[0]
          ?.entities.getById('medida:0')
          ?.position?.getValue(v.clock.currentTime);
        if (!point) return null;
        const at = v.scene.cartesianToCanvasCoordinates(point);
        const rect = v.scene.canvas.getBoundingClientRect();
        return at ? [rect.left + at.x, rect.top + at.y] : null;
      }),
    )
    .toEqual([expect.closeTo(c.x + c.width / 2, -1), expect.closeTo(c.y + c.height / 2, -1)]);
  // Capas, a modal sheet at 90 %.
  const capas = await openCapas(page);
  await expect(capas).toHaveAttribute('aria-modal', 'true');
  await expect(capas.getByRole('group', { name: 'Fondo' })).toBeAttached();
  await creditsAbove(page, capas);
  // Esc closes Capas and gives the focus back to its key.
  await page.keyboard.press('Escape');
  await expect(capas).toBeHidden();
  await expect(page.getByRole('button', { name: 'Capas', exact: true })).toBeFocused();
  // A section sheet.
  await menuButton(page).click();
  await page
    .getByRole('navigation', { name: 'Secciones' })
    .getByRole('button', { name: 'Resumen', exact: true })
    .click();
  const resumen = page.getByTestId('section-sheet');
  await expect(resumen.getByTestId('active-alerts')).toBeVisible();
  await creditsAbove(page, resumen);
  // The credits always name the ground under the scene.
  await expect(page.getByTestId('map-base')).toContainText(/Ortofoto PNOA|Fondo neutro|Atlas/);
});

test('the top plate shows the alarm row, which opens Alertas', async ({ page, request }) => {
  const created = await request.post('/api/alerts', {
    data: { asset_id: assetId, severity: 'critical', message: 'Prueba del móvil (E2E)' },
  });
  expect(created.status()).toBe(201);
  const alert = await created.json();
  try {
    await openScene(page);
    const alarm = page.getByTestId('annunciator-alarm');
    await expect(alarm).toContainText(/\d+ crítico/);
    // A hand-made incident is tagged «manual» (telemetry ones, «simulado»).
    await expect(alarm).toContainText('manual');
    await expect(alarm).toContainText('Ver');
    await expect(alarm.locator('.glyph-critical')).toBeVisible();
    await alarm.click();
    const sheet = page.getByTestId('section-sheet');
    await expect(sheet).toHaveAttribute('data-sheet', 'alerts');
    await expect(sheet).toContainText('Prueba del móvil (E2E)');
    expect(await overflow(page)).toEqual([]);
  } finally {
    await request.patch(`/api/alerts/${alert.id}/resolve`);
  }
});
