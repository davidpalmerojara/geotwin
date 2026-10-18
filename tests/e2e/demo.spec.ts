import { test, expect } from './fixtures';
import { card, chooseBase, map, mapBase, openScene, openSheet } from './hud';
test('scene → Resumen → asset card → persisted anomaly → resolved incident', async ({
  page,
  request,
  context,
}) => {
  // The longest walk through the app, with a second page rendering its own scene: on a busy CI
  // runner it has taken over 90 s.
  test.setTimeout(180000);
  const assetId = '20000000-0000-4000-8000-000000000001';
  const installationId = '10000000-0000-4000-8000-000000000001';
  // Re-runnable: clear incidents only on this dedicated fixture asset.
  const current = await request.get(`/api/alerts?asset_id=${assetId}&status=active`);
  for (const alert of await current.json()) await request.patch(`/api/alerts/${alert.id}/resolve`);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // The root path is the scene: it leads to /gemelo.
  await openScene(page, '/');
  await expect(page).toHaveURL(/\/gemelo$/);
  await expect(page.getByTestId('connection')).toContainText('Tiempo real');
  await expect(page.locator('.cesium-widget canvas')).toBeVisible();
  // The observer renders its own scene under a software renderer, which can hold its main thread
  // for seconds: its checks wait longer.
  const observer = await context.newPage();
  const slow = { timeout: 30000 };
  await observer.goto('/resumen');
  await expect(observer.getByTestId('connection')).toContainText('Tiempo real');
  await expect(observer.getByTestId('active-alerts')).toContainText('00', slow);
  // The PNOA orthophoto (mock tiles from the fixture) and the offline atlas in Capas › Fondo.
  await expect(map(page)).toHaveAttribute('data-pnoa', 'on');
  await expect(mapBase(page)).toContainText('Ortofoto PNOA');
  await chooseBase(page, 'Natural Earth');
  await expect(map(page)).toHaveAttribute('data-base-imagery', 'natural-earth');
  await expect(mapBase(page)).toContainText('Atlas Natural Earth');
  await page.keyboard.press('Escape');
  // Tag the WebGL canvas: if the viewer were rebuilt, the new canvas would not carry it.
  await page.locator('.cesium-widget canvas').evaluate((canvas) => {
    canvas.dataset.probe = 'same-viewer';
  });
  await page.getByLabel('Seleccionar instalación').selectOption(installationId);
  await expect(page.locator('.cesium-widget canvas')).toHaveAttribute('data-probe', 'same-viewer');
  await expect(mapBase(page)).toContainText('Atlas Natural Earth');
  // «Ir a» finds the asset without minding accents or capitals, and Intro opens its card.
  await page.keyboard.press('/');
  await page.getByRole('combobox', { name: /Ir a/ }).fill('pasarela lora torre sur');
  await page.keyboard.press('Enter');
  await expect(card(page).getByRole('heading', { level: 2 })).toHaveText(
    'Pasarela LoRa · torre sur',
  );
  // Values with a decimal comma, each marked as simulated next to it.
  const meter = card(page).getByTestId('meter').first();
  await expect(meter.locator('.meter-value')).toHaveText(/^\d+,\d°C$/);
  await expect(meter).toContainText('simulado');
  // The history chart's axis too: no decimal point.
  const ticks = card(page).locator(
    '.card-chart .recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value',
  );
  await expect(ticks.first()).toBeVisible();
  expect((await ticks.allTextContents()).filter((t) => /\d\.\d/.test(t))).toEqual([]);
  const link = `/gemelo?instalacion=${installationId}&activo=${assetId}`;
  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === link);
  await card(page).getByRole('button', { name: 'Simular fallo', exact: true }).click();
  await expect(card(page).locator('.status-critical').first()).toContainText('Crítico');
  // Observer has no mutation invalidation: this update must arrive through realtime.
  await expect(observer.getByTestId('active-alerts')).toContainText('01', slow);
  // The annunciator shows the alarm with shape, colour and word, marked as simulated.
  const alarm = page.getByTestId('annunciator-alarm');
  await expect(alarm).toContainText('Crítico');
  await expect(alarm).toContainText('Pasarela LoRa · torre sur');
  await expect(alarm).toContainText('simulado');
  await expect(alarm.locator('.glyph-critical')).toHaveCSS('background-color', 'rgb(255, 90, 76)');
  const active = await request.get(`/api/alerts?asset_id=${assetId}&status=active`);
  const alert = (await active.json())[0];
  expect(alert.severity).toBe('critical');
  await card(page).getByRole('button', { name: 'Alerta crítica', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Detalle de incidencia' })).toBeVisible();
  await page.getByRole('button', { name: 'Marcar como resuelta' }).click();
  await expect(card(page).locator('.status-healthy').first()).toContainText('Operativo');
  await expect(observer.getByTestId('active-alerts')).toContainText('00', slow);
  await expect(alarm).toBeHidden();
  await observer.close();
  const persisted = await request.get(`/api/alerts?asset_id=${assetId}&status=resolved`);
  expect(
    (await persisted.json()).some(
      (a: { id: string; resolved_at: string }) => a.id === alert.id && !!a.resolved_at,
    ),
  ).toBe(true);
  await openSheet(page, 'Resumen');
  await expect(page.getByTestId('active-alerts')).toContainText('00');
  await expect(page.locator('.cesium-widget canvas')).toHaveAttribute('data-probe', 'same-viewer');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('active-alerts')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // On a phone the section is a sheet over 90 % of the screen; closed, Menú reaches every
  // section by name.
  await expect(page.getByTestId('section-sheet')).toHaveAttribute('aria-modal', 'true');
  await page.getByRole('button', { name: 'Cerrar Resumen' }).click();
  await page.getByRole('button', { name: 'Menú', exact: true }).click();
  const sections = page.getByRole('navigation', { name: 'Secciones' });
  for (const name of ['Gemelo', 'Resumen', 'Activos', 'Alertas', 'Ajustes'])
    await expect(sections.getByRole('button', { name, exact: true })).toBeVisible();
  await sections.getByRole('button', { name: 'Alertas', exact: true }).click();
  await expect(
    page.getByTestId('section-sheet').getByRole('heading', { name: 'Alertas' }),
  ).toBeVisible();
  // A shared link opens the same installation and asset; Back closes the sheet opened after it.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(link);
  await expect(card(page).getByRole('heading', { level: 2 })).toHaveText(
    'Pasarela LoRa · torre sur',
  );
  await expect(page.getByLabel('Seleccionar instalación')).toHaveValue(installationId);
  await openSheet(page, 'Alertas');
  await expect(page).toHaveURL(/\/alertas\?/);
  await page.goBack();
  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === link);
  await expect(page.getByTestId('section-sheet')).toBeHidden();
  await expect(card(page).getByRole('heading', { level: 2 })).toHaveText(
    'Pasarela LoRa · torre sur',
  );
  expect(errors).toEqual([]);
});
