import { test, expect } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { card, map, openScene } from './hud';

/*
 * The assets in the scene: a tag with the value of the worst sensor next to each mark, a beam
 * over every asset with an active alert and rings around it until the alert is acknowledged
 * («Reconocer», key R). The beam stays until the alert is resolved.
 */
const installationId = '10000000-0000-4000-8000-000000000001';
const assetId = '20000000-0000-4000-8000-000000000001';
const sensorId = '30000000-0000-4000-8000-000000000001';

async function resolveAll(request: APIRequestContext) {
  const active = await request.get(`/api/alerts?asset_id=${assetId}&status=active`);
  for (const alert of (await active.json()) as { id: string }[])
    await request.patch(`/api/alerts/${alert.id}/resolve`);
}
const tag = (page: Page, id = assetId) =>
  page.locator(`[data-testid="scene-tag"][data-asset="${id}"]`);
// Under a software renderer a frame can take seconds: scene checks wait longer.
const slow = { timeout: 60000 };

test.beforeEach(async ({ request }) => resolveAll(request));
test.afterEach(async ({ request }) => resolveAll(request));

test('an injected alert gets a critical tag, a beam and rings until it is acknowledged', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openScene(page, `/gemelo?instalacion=${installationId}&activo=${assetId}`);
  await expect(card(page).getByRole('heading', { level: 2 })).toHaveText(
    'Pasarela LoRa · torre sur',
  );
  // Nothing is alarmed yet: no beam and no rings.
  await expect(map(page)).toHaveAttribute('data-beams', '0', slow);
  await expect(map(page)).toHaveAttribute('data-pulses', '0');

  // Operational tags show the value of their worst sensor with a decimal comma.
  const quiet = page.locator('[data-testid="scene-tag"][data-status="healthy"]:visible');
  await expect(quiet.first()).toBeVisible(slow);
  for (const text of await quiet.locator('.tag-value').allTextContents())
    expect(text).toMatch(/^(\d+,\d+ \S+|—)$/);

  const injected = await request.post('/api/demo/anomalies', {
    data: { sensor_id: sensorId, mode: 'critical' },
  });
  expect(injected.status()).toBe(201);
  // The tag turns critical: diamond, name, value and word.
  await expect(tag(page)).toHaveAttribute('data-status', 'critical', slow);
  await expect(tag(page)).toBeVisible(slow);
  await expect(tag(page).locator('.glyph-critical')).toBeVisible();
  await expect(tag(page)).toHaveAttribute('data-lod', 'full');
  await expect(tag(page)).toContainText('Pasarela LoRa · torre sur');
  await expect(tag(page)).toContainText('crítico');
  await expect(tag(page).locator('.tag-value')).toHaveText(/^\d+,\d °C$/);
  await expect(tag(page)).toHaveAttribute(
    'aria-label',
    /^Pasarela LoRa · torre sur, crítico, temperatura \d+,\d °C, simulado$/,
  );
  // One beam over it and its rings.
  await expect(map(page)).toHaveAttribute('data-beams', '1', slow);
  await expect(map(page)).toHaveAttribute('data-pulses', '1');
  const beam = await page.evaluate(() => {
    type V = {
      dataSources: { getByName(name: string): { entities: { values: { id: string }[] } }[] };
    };
    const v = (window as Window & { __geotwinViewer?: V }).__geotwinViewer!;
    return v.dataSources.getByName('haces')[0]?.entities.values.map((e) => e.id);
  });
  expect(beam).toEqual([`haz:${assetId}`]);

  // «Reconocer» stops the rings; the beam stays.
  const incident = card(page).locator('.incident-critical');
  await incident.getByRole('button', { name: /^Reconocer/ }).click();
  await expect(map(page)).toHaveAttribute('data-pulses', '0', slow);
  await expect(map(page)).toHaveAttribute('data-beams', '1');
  await expect(incident.getByTestId('acknowledged')).toContainText('reconocida a las');
  const [stored] = await (
    await request.get(`/api/alerts?asset_id=${assetId}&status=active`)
  ).json();
  expect(stored.acknowledged_at).toBeTruthy();

  // «Resolver» takes the beam away and the tag back to operational.
  await incident.getByRole('button', { name: 'Resolver', exact: true }).click();
  await expect(map(page)).toHaveAttribute('data-beams', '0', slow);
  await expect(tag(page)).toHaveAttribute('data-status', 'healthy', slow);

  // Every tag tells a screen reader that its value is simulated, and the hidden list of the
  // scene's assets mirrors the tags' values.
  const labels = await page
    .locator('[data-testid="scene-tag"]')
    .evaluateAll((tags) => tags.map((t) => t.getAttribute('aria-label') ?? ''));
  expect(labels.length).toBeGreaterThan(5);
  for (const label of labels) expect(label).toMatch(/, simulado$/);
  const listed = page.getByTestId('scene-assets').getByRole('button').first();
  await expect(listed).toContainText(/\d,\d|—/);
  await expect(listed).toContainText('simulado');
  expect(errors).toEqual([]);
});

test('the R key acknowledges the alerts of the open card', async ({ page, request }) => {
  await openScene(page, `/gemelo?instalacion=${installationId}&activo=${assetId}`);
  await expect(card(page).getByRole('heading', { level: 2 })).toHaveText(
    'Pasarela LoRa · torre sur',
  );
  await request.post('/api/demo/anomalies', { data: { sensor_id: sensorId, mode: 'warning' } });
  await expect(tag(page)).toHaveAttribute('data-status', 'warning', slow);
  await expect(tag(page).locator('.glyph-warning')).toBeAttached();
  await expect(map(page)).toHaveAttribute('data-pulses', '1', slow);
  await expect(card(page).getByRole('button', { name: /^Reconocer/ })).toBeVisible();
  await page.locator('body').press('r');
  await expect(map(page)).toHaveAttribute('data-pulses', '0', slow);
  await expect(map(page)).toHaveAttribute('data-beams', '1');
  await expect(card(page).getByTestId('acknowledged')).toBeVisible();
});

test('Alertas acknowledges a row and keeps it active', async ({ page, request }) => {
  await request.post('/api/demo/anomalies', { data: { sensor_id: sensorId, mode: 'critical' } });
  await openScene(page, '/alertas');
  const row = page.locator('.alert-row', { hasText: 'Pasarela LoRa · torre sur' });
  await row
    .getByRole('button', { name: 'Reconocer la alerta de Pasarela LoRa · torre sur' })
    .click();
  await expect(row.getByRole('button', { name: /^Reconocer/ })).toBeHidden();
  await expect(row.locator('td[data-label="Reconocida"]')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  await expect(map(page)).toHaveAttribute('data-pulses', '0', slow);
  await expect(map(page)).toHaveAttribute('data-beams', '1');
});
