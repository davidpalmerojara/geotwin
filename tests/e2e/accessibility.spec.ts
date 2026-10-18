import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { card, menuButton, openCapas, openScene, openSheet, panel } from './hud';

// WCAG 2.1 A/AA checks with axe on the scene, every section sheet, Capas, the asset card and
// Medir, on desktop (1440 × 900) and on a phone (390 × 844), with an active incident; a walk
// with the keyboard alone; and the one-key shortcuts kept out of fields and switched off.
// Cesium's own widget (the WebGL canvas) is third-party and left out; its credits, now in the
// credits plate, are checked.
const sheets = ['/resumen', '/activos', '/alertas', '/ajustes'];
const sizes = [
  { name: 'escritorio', width: 1440, height: 900 },
  { name: 'móvil', width: 390, height: 844 },
];
// A fixture asset not used by the other specs.
const assetId = '20000000-0000-4000-8000-000000000002';

async function violations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .exclude('.cesium-viewer')
    .analyze();
  return results.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) => `${label} ${violation.id}: ${node.target.join(' ')} ${node.failureSummary ?? ''}`,
    ),
  );
}

async function ready(page: Page, path: string) {
  await openScene(page, path);
  await expect(page.getByTestId('connection')).toContainText('Tiempo real');
}

for (const size of sizes)
  test(`no axe violations on the scene, the sheets, Capas, the card and Medir (${size.name})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(240000);
    const created = await request.post('/api/alerts', {
      data: { asset_id: assetId, severity: 'warning', message: 'Revisión de accesibilidad (E2E)' },
    });
    expect(created.status()).toBe(201);
    const alert = await created.json();
    try {
      await page.setViewportSize(size);
      const found: string[] = [];
      await ready(page, '/gemelo');
      // The annunciator shows the incident.
      await expect(page.getByTestId('annunciator-alarm')).toBeVisible();
      found.push(...(await violations(page, 'escena')));
      for (const path of sheets) {
        await ready(page, path);
        await expect(page.getByTestId('section-sheet')).toBeVisible();
        found.push(...(await violations(page, path)));
      }
      // Capas (on a phone a modal sheet at 90 %).
      await ready(page, '/gemelo');
      await expect(await openCapas(page)).toBeVisible();
      found.push(...(await violations(page, 'capas')));
      // The asset card with its sensors, readings and the open incident.
      await ready(page, `/gemelo?activo=${assetId}`);
      await expect(card(page).getByTestId('meter').first()).toBeVisible();
      await expect(card(page)).toContainText('Revisión de accesibilidad');
      found.push(...(await violations(page, 'ficha')));
      // Medir, from its key on the tool bar.
      await page.getByRole('button', { name: 'Medir', exact: true }).click();
      await expect(panel(page, 'Medir')).toBeVisible();
      found.push(...(await violations(page, 'medir')));
      expect(found).toEqual([]);
    } finally {
      await request.patch(`/api/alerts/${alert.id}/resolve`);
    }
  });

/** What has the focus: its accessible name or text, and the plate it is in. */
function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const plate = el.closest(
      '[data-testid], nav[aria-label], [role="dialog"], section[aria-label], section[aria-labelledby]',
    );
    // Visible focus: the signal ring on the element or on the box that wraps it.
    let ring = false;
    for (let at: HTMLElement | null = el, i = 0; at && i < 3; at = at.parentElement, i++) {
      const style = getComputedStyle(at);
      if (style.boxShadow.includes('255, 210, 26') || style.outlineStyle !== 'none') ring = true;
    }
    const box = el.getBoundingClientRect();
    return {
      name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40),
      plate:
        plate?.getAttribute('data-testid') ??
        plate?.getAttribute('aria-label') ??
        plate?.getAttribute('aria-labelledby') ??
        '',
      ring,
      onScreen: box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight,
    };
  });
}

test('the keyboard alone reaches every plate with a visible focus; Esc closes in order', async ({
  page,
}) => {
  test.setTimeout(150000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page, '/gemelo');
  await expect(page.getByTestId('scene-assets').getByRole('button').first()).toBeAttached({
    timeout: 30000,
  });
  // Tab through the whole page once.
  const plates = new Set<string>(),
    names: string[] = [],
    unringed: string[] = [];
  for (let i = 0; i < 70; i++) {
    await page.keyboard.press('Tab');
    const now = await focused(page);
    if (!now) continue;
    plates.add(now.plate);
    names.push(now.name);
    if (!now.ring || !now.onScreen) unringed.push(`${now.plate} › ${now.name}`);
  }
  for (const plate of [
    'place-plate',
    'Herramientas del visor',
    'scene-assets',
    'heading-plate',
    'credits',
  ])
    expect([...plates], `Tab reaches ${plate}`).toContain(plate);
  for (const name of [
    'GeoTwin',
    'Seleccionar instalación',
    'Orbitar',
    'Capas',
    'Ir a…',
    'Encuadre inicial',
  ])
    expect(
      names.some((n) => n.startsWith(name)),
      `Tab reaches ${name}`,
    ).toBe(true);
  expect(unringed).toEqual([]);

  // Intro on an asset of the list selects it: its card opens.
  const list = page.getByTestId('scene-assets');
  const first = list.getByRole('button').first();
  await first.focus();
  await expect(list).toBeInViewport();
  const name = (await first.locator('.scene-list-name').textContent())!;
  await page.keyboard.press('Enter');
  await expect(card(page).getByRole('heading', { level: 2 })).toHaveText(name);

  // Esc closes the top-most thing: the palette, the panel, then the sheet, then the card.
  await menuButton(page).focus();
  await page.keyboard.press('Enter');
  const resumen = page
    .getByRole('navigation', { name: 'Secciones' })
    .getByRole('button', { name: 'Resumen', exact: true });
  await resumen.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('section-sheet')).toBeVisible();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('combobox', { name: /Ir a/ });
  await expect(palette).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  await expect(page.getByTestId('section-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('section-sheet')).toBeHidden();
  await expect(card(page)).toBeVisible();
  await page.keyboard.press('c');
  await expect(panel(page, 'Capas')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel(page, 'Capas')).toBeHidden();
  await expect(card(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();
});

async function noShortcut(page: Page, field: Locator) {
  // By id: a modal dialog hides the rest of the page from the accessibility tree.
  const measure = page.locator('#tool-measure'),
    capas = page.locator('#tool-layers');
  await page.keyboard.type('2c5');
  await expect(field).toHaveValue(/2c5$/);
  await expect(measure).toHaveAttribute('aria-pressed', 'false');
  await expect(capas).toHaveAttribute('aria-expanded', 'false');
}

test('shortcuts never fire in the rename field or the palette, and do nothing when switched off', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page, `/gemelo?activo=${assetId}`);
  // The rename field of the asset card.
  await card(page).getByRole('button', { name: 'Editar activo' }).click();
  const rename = page.getByRole('dialog').getByRole('textbox', { name: 'Nombre' });
  await rename.click();
  await rename.press('End');
  await noShortcut(page, rename);
  await page.keyboard.press('Escape');
  await expect(rename).toBeHidden();
  // The palette's search field.
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('combobox', { name: /Ir a/ });
  await expect(palette).toBeFocused();
  await noShortcut(page, palette);
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();

  // Ajustes › Atajos switches them off: the keys do nothing, Ctrl+K and Esc still work.
  await openSheet(page, 'Ajustes');
  const toggle = page.getByRole('switch', { name: /Teclas de una pulsación/ });
  // Ajustes is a lazy chunk fetched on this first opening: on the CI runner, with SwiftShader
  // holding the page, it twice took over 10 s to appear (the sheet's heading was already there).
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('section-sheet')).toContainText('Ctrl+K');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('section-sheet')).toBeHidden();
  await page.locator('body').click({ position: { x: 720, y: 450 } });
  for (const key of ['2', 'c', '5', '/']) await page.keyboard.press(key);
  await expect(page.getByRole('button', { name: 'Medir', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('button', { name: 'Capas', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(palette).toBeHidden();
  await page.keyboard.press('Control+k');
  await expect(palette).toBeFocused();
  await page.keyboard.press('Escape');
  // The choice is remembered on reload, and switching back on restores the keys.
  await page.reload();
  await openSheet(page, 'Ajustes');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('2');
  await expect(page.getByRole('button', { name: 'Medir', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
