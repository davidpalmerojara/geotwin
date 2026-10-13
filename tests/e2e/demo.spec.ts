import { test, expect } from '@playwright/test';
test('dashboard → 3D twin → persisted anomaly → resolved incident', async ({
  page,
  request,
  context,
}) => {
  const assetId = '20000000-0000-4000-8000-000000000001';
  const installationId = '10000000-0000-4000-8000-000000000001';
  // Re-runnable: clear incidents only on this dedicated fixture asset.
  const current = await request.get(`/api/alerts?asset_id=${assetId}&status=active`);
  for (const alert of await current.json()) await request.patch(`/api/alerts/${alert.id}/resolve`);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Tu infraestructura. En perspectiva.' }),
  ).toBeVisible();
  await expect(page.getByTestId('connection')).toContainText('Tiempo real');
  const observer = await context.newPage();
  await observer.goto('/');
  await expect(observer.getByTestId('connection')).toContainText('Tiempo real');
  await expect(observer.getByTestId('active-alerts')).toContainText('00');
  await page.getByRole('button', { name: 'Gemelo digital', exact: true }).click();
  await expect(page.getByTestId('cesium-view')).toHaveAttribute('data-ready', 'true', {
    timeout: 30000,
  });
  await expect(page.locator('.cesium-widget canvas')).toBeVisible();
  // Exercise the real offline layer control; external imagery is not needed for the business flow.
  await page.getByRole('button', { name: 'Alternar cartografía', exact: true }).click();
  await expect(page.locator('.map-top')).toContainText('Local');
  // Tag the WebGL canvas: if the viewer were rebuilt, the new canvas would not carry it.
  await page.locator('.cesium-widget canvas').evaluate((canvas) => {
    canvas.dataset.probe = 'same-viewer';
  });
  await page.getByLabel('Seleccionar instalación').selectOption(installationId);
  await expect(page.locator('.cesium-widget canvas')).toHaveAttribute('data-probe', 'same-viewer');
  await expect(page.locator('.map-top')).toContainText('Local');
  await page.getByTestId(`map-asset-${assetId}`).click();
  await expect(page.getByRole('heading', { name: 'Sensores del activo' })).toBeVisible();
  // Values with a decimal comma, each marked as simulated next to it.
  await expect(page.locator('.sensor-card > strong').first()).toHaveText(/^\d+,\d°C\s*simulado$/);
  const link = `/gemelo?instalacion=${installationId}&activo=${assetId}`;
  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === link);
  await page.getByRole('button', { name: 'Simular fallo', exact: true }).click();
  await expect(page.locator('.detail-panel .status-critical')).toContainText('Crítico');
  // Observer has no mutation invalidation: this update must arrive through realtime.
  await expect(observer.getByTestId('active-alerts')).toContainText('01');
  await expect(page.getByTestId(`map-asset-${assetId}`).locator('.dot-critical')).toBeVisible();
  await expect(page.getByTestId(`map-asset-${assetId}`).locator('.dot-critical')).toHaveCSS(
    'background-color',
    'rgb(251, 113, 133)',
  );
  await page.mouse.move(1200, 30);
  const active = await request.get(`/api/alerts?asset_id=${assetId}&status=active`);
  const alert = (await active.json())[0];
  expect(alert.severity).toBe('critical');
  await page.getByRole('button', { name: 'Alerta crítica', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Detalle de incidencia' })).toBeVisible();
  await page.getByRole('button', { name: 'Marcar como resuelta' }).click();
  await expect(page.locator('.detail-panel .status-healthy')).toContainText('Operativo');
  await expect(observer.getByTestId('active-alerts')).toContainText('00');
  await observer.close();
  const persisted = await request.get(`/api/alerts?asset_id=${assetId}&status=resolved`);
  expect(
    (await persisted.json()).some(
      (a: { id: string; resolved_at: string }) => a.id === alert.id && !!a.resolved_at,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Resumen', exact: true }).click();
  await expect(page.getByTestId('active-alerts')).toContainText('00');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('active-alerts')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // Icon-only navigation on a phone still exposes each destination by name.
  for (const name of ['Resumen', 'Gemelo digital', 'Activos', 'Alertas', 'Ajustes'])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Alertas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cada señal, una acción' })).toBeVisible();
  // A shared link opens the same installation and asset; Back returns to the previous page.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Sensores del activo' })).toBeVisible();
  await expect(page.getByLabel('Seleccionar instalación')).toHaveValue(installationId);
  await page.getByRole('button', { name: 'Alertas', exact: true }).click();
  await expect(page).toHaveURL(/\/alertas\?/);
  await page.goBack();
  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === link);
  await expect(page.getByRole('heading', { name: 'Sensores del activo' })).toBeVisible();
  expect(errors).toEqual([]);
});
