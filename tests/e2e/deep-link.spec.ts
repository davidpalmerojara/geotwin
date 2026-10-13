import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// The SYNTHETIC fixture (not measured data): ground at 700 m orthometric, about 753 m ellipsoidal.
const fixture = 'apps/worker/tests/fixtures/synthetic-laguna-duero.laz';
const name = 'E2E · relieve para un enlace';
const installationId = '10000000-0000-4000-8000-000000000002';
const assetId = '20000000-0000-4000-8000-000000000007';
type DevWindow = Window & {
  __geotwinViewer?: { camera: { positionCartographic: { height: number } } };
};

test('a shared link to an asset opened on a fresh page ends above the LiDAR ground', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
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
    let terrainUrl = '';
    await expect
      .poll(
        async () => {
          const layers = (await (await request.get('/api/layers')).json()) as {
            id: string;
            status: string;
            terrain_url: string | null;
          }[];
          const layer = layers.find((l) => l.id === id);
          terrainUrl = layer?.terrain_url ?? '';
          return layer?.status;
        },
        { timeout: 120000 },
      )
      .toBe('ready');
    expect(terrainUrl).not.toBe('');
    const dtm = (await (await request.get(terrainUrl)).json()) as { min: number; max: number };
    expect(dtm.min).toBeGreaterThan(700);

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/gemelo?instalacion=${installationId}&activo=${assetId}`);
    const map = page.getByTestId('cesium-view');
    await expect(map).toHaveAttribute('data-terrain', 'lidar', { timeout: 60000 });
    await expect(page.getByRole('heading', { name: 'Sensores del activo' })).toBeVisible();
    // The close-up is 650 m from the asset at 45°: about 460 m above its ground. Before the
    // terrain was taken into account the camera stayed ~300 m under the ground (h ≈ 460 m).
    const height = () =>
      page.evaluate(
        () => (window as DevWindow).__geotwinViewer?.camera.positionCartographic.height ?? 0,
      );
    await expect.poll(height, { timeout: 30000 }).toBeGreaterThan(dtm.max + 300);
    // And it stays there: no late flight brings it back down.
    await page.waitForTimeout(2000);
    expect(await height()).toBeGreaterThan(dtm.max + 300);
    expect(errors).toEqual([]);
  } finally {
    expect((await request.delete(`/api/layers/${id}`)).status()).toBe(204);
  }
});
