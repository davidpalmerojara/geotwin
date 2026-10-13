import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// The SYNTHETIC fixture (not measured data): 5,540 points near Laguna de Duero, EPSG:25830.
const fixture = 'apps/worker/tests/fixtures/synthetic-laguna-duero.laz';
const name = 'E2E · nube sintética';
const attribution = 'Nube SINTÉTICA de prueba (E2E, no son datos medidos)';

test('upload through the interface → worker → 3D Tiles on the map → style → measure', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  // Re-runnable: a file already uploaded answers 409, so remove any earlier copy first.
  const sha256 = createHash('sha256').update(readFileSync(fixture)).digest('hex');
  for (const layer of await (await request.get('/api/layers')).json())
    if (layer.source.sha256 === sha256 || layer.name === name)
      expect((await request.delete(`/api/layers/${layer.id}`)).status()).toBe(204);

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Every GET of the layer list: after the first load, progress must arrive over the WebSocket.
  let listRequests = 0;
  page.on('request', (r) => {
    if (r.method() === 'GET' && new URL(r.url()).pathname === '/api/layers') listRequests++;
  });

  await page.goto('/gemelo');
  await expect(page.getByTestId('connection')).toContainText('Tiempo real');
  const map = page.getByTestId('cesium-view');
  await expect(map).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  await page.getByRole('button', { name: 'Alternar cartografía', exact: true }).click();
  await expect(page.locator('.map-top')).toContainText('Local');

  const panel = page.getByRole('region', { name: 'Capas LiDAR' });
  await expect(panel.getByText(/hasta 150 MB/)).toBeVisible();
  await panel.getByText('Nombre y atribución (opcional)').click();
  await panel.getByLabel('Nombre', { exact: true }).fill(name);
  await panel.getByLabel('Atribución').fill(attribution);
  const before = listRequests;
  await panel.getByLabel('Fichero LAS o LAZ').setInputFiles(fixture);

  const row = panel.locator('.layer-row', { hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-status', 'ready', { timeout: 120000 });
  await expect(row).toContainText('5540 puntos');
  expect(listRequests, 'the layer list was polled instead of updated by events').toBe(before);

  // Ready: the tileset is drawn and its attribution joins the viewer credits.
  await expect(map).toHaveAttribute('data-pointclouds', '1', { timeout: 30000 });
  const credits = page.locator('.cesium-widget-credits');
  await expect(credits).toContainText(attribution);

  // Hide and show again; the credit follows the visibility.
  await row.getByRole('button', { name: `Ocultar ${name}` }).click();
  await expect(map).toHaveAttribute('data-pointclouds', '0');
  await expect(credits).not.toContainText(attribution);
  await row.getByRole('button', { name: `Mostrar ${name}` }).click();
  await expect(map).toHaveAttribute('data-pointclouds', '1');
  await expect(credits).toContainText(attribution);

  // Colour modes and class filters.
  await panel.getByRole('button', { name: 'Altura', exact: true }).click();
  await expect(map).toHaveAttribute('data-color-mode', 'height');
  await expect(panel.locator('.height-legend')).toContainText('m');
  await panel.getByRole('button', { name: 'Clasificación', exact: true }).click();
  await expect(map).toHaveAttribute('data-color-mode', 'classification');
  const ground = panel.getByRole('checkbox', { name: 'Suelo' });
  await ground.uncheck();
  await expect(ground).not.toBeChecked();
  await ground.check();

  // Measure a distance: one point from the keyboard (the crosshair at the centre), then the map
  // is panned with an arrow key and the second point is picked with the mouse.
  await page.getByRole('button', { name: 'Medir', exact: true }).click();
  const results = page.getByTestId('measure-results');
  await expect(results).toBeVisible();
  await page.getByRole('button', { name: 'Añadir punto en el centro' }).click();
  await map.focus();
  await page.keyboard.press('ArrowRight');
  const canvas = await page.locator('.cesium-widget canvas').boundingBox();
  if (!canvas) throw new Error('no canvas');
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  const distance = results.locator('div', { hasText: '3D' }).locator('dd');
  await expect(distance).toHaveText(/^\d+(,\d+)? (m|km)$/);
  await expect(results.locator('div', { hasText: 'Desnivel' }).locator('dd')).toHaveText(
    /^[+−±]\d/,
  );
  // Keyboard: Backspace undoes the last point, Escape closes the tool.
  await page.keyboard.press('Backspace');
  await expect(distance).toHaveText('—');
  await page.keyboard.press('Escape');
  await expect(results).toBeHidden();

  // A rejected file while the panel is scrolled down to the style controls: the message is
  // scrolled into view instead of appearing out of sight above the list.
  const body = panel.locator('#layers-body');
  await body.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect(panel.getByText('Altura real sobre el globo básico')).toBeInViewport();
  await panel
    .getByLabel('Fichero LAS o LAZ')
    .setInputFiles({ name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') });
  const alert = panel.getByRole('alert');
  await expect(alert).toContainText('«notas.txt» no es un fichero .las o .laz.');
  await expect(alert).toBeInViewport();

  // Delete with confirmation: the row, the tileset and the credit go away.
  await row.getByRole('button', { name: `Borrar ${name}` }).click();
  await page.getByRole('button', { name: 'Borrar capa' }).click();
  await expect(row).toBeHidden();
  await expect(map).toHaveAttribute('data-pointclouds', '0');
  await expect(credits).not.toContainText(attribution);
  const remaining = await (await request.get('/api/layers')).json();
  expect(remaining.some((l: { name: string }) => l.name === name)).toBe(false);
  expect(errors).toEqual([]);
});
