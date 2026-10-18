import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { openCapas, openScene, panel } from './hud';

// The SYNTHETIC fixture (not measured data): 5,540 points near Laguna de Duero, two flat-roofed
// buildings (7,5 and 10 m) on rolling ground.
const fixture = 'apps/worker/tests/fixtures/synthetic-laguna-duero.laz';
const name = 'E2E · perfil sintético';
// A–B crosses both buildings and starts and ends outside the 120 m patch.
const A = { lng: -4.71795, lat: 41.582649 },
  B = { lng: -4.719955, lat: 41.583609 };

type V = import('cesium').Viewer;
/** The page position of a ground point, on the ground the viewer draws (its LiDAR DTM). */
async function screen(page: Page, p: { lng: number; lat: number }) {
  const at = await page.evaluate(
    async ([lng, lat]) => {
      const { useScene } = (await import('/src/stores/viewer.ts' as string)) as {
        useScene: { getState(): { api: import('../../apps/web/src/stores/viewer').SceneApi } };
      };
      const api = useScene.getState().api;
      return api.project(lng!, lat!, api.groundAt(lng!, lat!));
    },
    [p.lng, p.lat],
  );
  expect(at, `${p.lng}, ${p.lat} is in front of the camera`).not.toBeNull();
  return [at!.x, at!.y] as [number, number];
}
/**
 * The page position of a ground point once the globe can be picked there: A and B are picked on
 * the rendered terrain (globe.pick), and right after the camera jumps the terrain tiles under the
 * new view may not be drawn yet on a slow renderer, so a click would land on nothing.
 */
async function pickable(page: Page, p: { lng: number; lat: number }) {
  const at = await screen(page, p);
  await expect
    .poll(
      () =>
        page.evaluate(([x, y]) => {
          const v = (window as unknown as { __geotwinViewer: V }).__geotwinViewer;
          v.scene.requestRender();
          const ray = v.camera.getPickRay({ x, y } as never);
          return !!ray && !!v.scene.globe.pick(ray, v.scene);
        }, at),
      { timeout: 30000 },
    )
    .toBe(true);
  return at;
}
/** Waits until the camera has not moved for 1,5 s (the app's own first flights are over). */
async function stillCamera(page: Page) {
  let last: number[] = [],
    still = 0;
  for (let i = 0; i < 120 && still < 3; i++) {
    const now = await page.evaluate(() => {
      const c = (window as unknown as { __geotwinViewer: V }).__geotwinViewer.camera.positionWC;
      return [c.x, c.y, c.z];
    });
    still = last.length && Math.hypot(...now.map((v, k) => v - last[k]!)) < 0.05 ? still + 1 : 0;
    last = now;
    await page.waitForTimeout(500);
  }
}
/** How many LiDAR tilesets carry clipping (polygons or planes). */
const clipped = (page: Page) =>
  page.evaluate(() => {
    const v = (window as unknown as { __geotwinViewer: V }).__geotwinViewer;
    let n = 0;
    for (let i = 0; i < v.scene.primitives.length; i++) {
      const p = v.scene.primitives.get(i) as {
        isCesium3DTileset?: boolean;
        clippingPolygons?: { length: number };
        clippingPlanes?: { length: number };
      };
      if (
        p.isCesium3DTileset &&
        ((p.clippingPolygons?.length ?? 0) || (p.clippingPlanes?.length ?? 0))
      )
        n++;
    }
    return n;
  });

test('Perfil A–B, Corte and Radio on a synthetic layer', async ({ page, request }) => {
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
    await page.setViewportSize({ width: 1440, height: 900 });
    const map = await openScene(page);
    await expect(map).toHaveAttribute('data-terrain', 'lidar', { timeout: 60000 });
    await expect(map).toHaveAttribute('data-pointclouds', '1', { timeout: 60000 });
    await stillCamera(page);
    // Look at the middle of the line from the south, 450 m away.
    await page.evaluate(
      ([lng, lat]) => {
        const v = (window as unknown as { __geotwinViewer: V }).__geotwinViewer;
        const r = Math.PI / 180,
          e = v.scene.globe.ellipsoid;
        const h = v.scene.globe.getHeight({ longitude: lng! * r, latitude: lat! * r } as never);
        const target = e.cartographicToCartesian({
          longitude: lng! * r,
          latitude: lat! * r,
          height: h ?? 753,
        } as never);
        // Across the line (it runs west-north-west), 600 m away and 50° down onto its middle.
        const up = e.geodeticSurfaceNormal(target, {} as never);
        const east = { x: -Math.sin(lng! * r), y: Math.cos(lng! * r), z: 0 };
        const north = {
          x: up.y * east.z - up.z * east.y,
          y: up.z * east.x - up.x * east.z,
          z: up.x * east.y - up.y * east.x,
        };
        const heading = 34 * r,
          pitch = -50 * r,
          range = 600;
        const dE = Math.sin(heading) * Math.cos(pitch),
          dN = Math.cos(heading) * Math.cos(pitch),
          dU = Math.sin(pitch);
        const position = {
          x: target.x - (east.x * dE + north.x * dN + up.x * dU) * range,
          y: target.y - (east.y * dE + north.y * dN + up.y * dU) * range,
          z: target.z - (east.z * dE + north.z * dN + up.z * dU) * range,
        };
        v.camera.cancelFlight();
        v.camera.setView({
          destination: position as never,
          orientation: { heading, pitch, roll: 0 },
        });
        v.scene.requestRender();
      },
      [(A.lng + B.lng) / 2, (A.lat + B.lat) / 2],
    );
    await stillCamera(page);
    // Key 3 and two clicks on the map: A, then B, and the drawer opens with the profile.
    const profile = page.getByRole('button', { name: 'Perfil', exact: true }),
      cut = page.getByRole('button', { name: 'Corte', exact: true });
    await page.keyboard.press('3');
    await expect(profile).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('profile-hint')).toContainText('poner A');
    // The scene side of the tool loads on demand: picking is on once the viewer says so.
    await expect(map).toHaveAttribute('data-profile', 'on', { timeout: 30000 });
    await page.mouse.click(...(await pickable(page, A)));
    await expect(page.getByTestId('profile-hint')).toContainText('Ahora pon B');
    await page.mouse.click(...(await pickable(page, B)));
    const drawer = page.getByTestId('profile-drawer');
    await expect(drawer.getByRole('heading', { name: 'Perfil A–B' })).toBeVisible();
    // The same points the API gives for that line (the clicks land within a metre or two).
    const meta = page.getByTestId('profile-meta');
    await expect(meta).toContainText('puntos', { timeout: 60000 });
    const text = await meta.innerText();
    const [, length] = text.match(/^(\d+,\d) m · rumbo \d+° · corte ±1,5 m · ([\d.]+) puntos$/)!;
    expect(Number(length!.replace(',', '.'))).toBeGreaterThan(190);
    expect(Number(length!.replace(',', '.'))).toBeLessThan(207);
    const points = Number(text.match(/([\d.]+) puntos$/)![1]!.replace(/\./g, ''));
    expect(points).toBeGreaterThan(300);
    // Both buildings, with their heights over the ground under them. The fixture puts the roofs
    // 7,5 and 10 m above its base level, and the rolling ground is 0,7 to 1,2 m above that level
    // under the first one and -0,3 to 0,1 m under the second: 6,3 to 6,8 m and 9,9 to 10,3 m.
    const heights = page.getByTestId('profile-heights');
    await expect(heights.locator('li')).toHaveCount(2);
    const values = (await heights.locator('li').allInnerTexts()).map((t) =>
      Number(t.match(/([\d,]+) m$/)![1]!.replace(',', '.')),
    );
    expect(values[0]).toBeGreaterThan(5.8);
    expect(values[0]).toBeLessThan(7.5);
    expect(values[1]).toBeGreaterThan(9);
    expect(values[1]).toBeLessThan(11.5);
    // The cursor over the plot reads a distance and the ground under it.
    const canvas = (await page.getByTestId('profile-canvas').boundingBox())!;
    await page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.6, {
      steps: 3,
    });
    const readout = page.getByTestId('profile-readout');
    await expect(readout).toContainText(/Distancia desde A\s*\d+,\d m/);
    await expect(readout).toContainText(/Suelo \(MDT\)\s*\d+,\d m/);

    // Exportar CSV: «;» and a decimal comma, one row per point.
    const download = page.waitForEvent('download');
    await drawer.getByRole('button', { name: 'Exportar CSV' }).click();
    const csv = readFileSync(await (await download).path(), 'utf8').replace(/^\uFEFF/, '');
    const rows = csv.trim().split('\r\n');
    expect(rows[0]).toBe('distancia_m;desvio_m;cota_m;suelo_mdt_m;sobre_suelo_m;clase;color');
    expect(rows).toHaveLength(points + 1);
    expect(rows[1]).toMatch(/^\d+,\d\d;-?\d,\d\d;\d+,\d\d;\d*,?\d*;-?\d*,?\d*;\d+;#[0-9A-F]{6}$/);

    // Key 4: the cut clips what is in front of the line; Atenuar and Ocultar switch its mode.
    await page.keyboard.press('4');
    await expect(cut).toHaveAttribute('aria-pressed', 'true');
    await expect(map).toHaveAttribute('data-cut', 'front');
    await expect.poll(() => clipped(page)).toBe(1);
    const outside = drawer.getByRole('group', { name: 'Fuera de la franja' });
    await outside.getByRole('button', { name: 'Atenuar' }).click();
    await expect(map).toHaveAttribute('data-cut', 'dim');
    await outside.getByRole('button', { name: 'Ocultar' }).click();
    await expect(map).toHaveAttribute('data-cut', 'hide');
    await expect.poll(() => clipped(page)).toBe(1);
    // [ and ] change the slab: the profile is read again.
    await page.keyboard.press(']');
    await expect(meta).toContainText('corte ±2,5 m');
    await page.keyboard.press('[');
    await expect(meta).toContainText('corte ±1,5 m');

    // Esc closes the profile and takes the clipping away.
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(map).not.toHaveAttribute('data-cut');
    await expect.poll(() => clipped(page)).toBe(0);
    await expect(profile).toHaveAttribute('aria-pressed', 'false');
    await expect(cut).toHaveAttribute('aria-pressed', 'false');

    // Without the relief, 3 and 4 are disabled and say why.
    const capas = await openCapas(page);
    const relief = capas.getByRole('checkbox', { name: 'Relieve del LiDAR', exact: true });
    await relief.uncheck();
    await expect(map).toHaveAttribute('data-terrain', 'ellipsoid');
    for (const key of [profile, cut]) {
      await expect(key).toHaveAttribute('aria-disabled', 'true');
      await expect(key).toHaveAttribute('title', /Relieve del LiDAR.*Perfil y Corte/);
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('3');
    await expect(profile).toHaveAttribute('aria-pressed', 'false');
    await expect(drawer).toBeHidden();
    await (await openCapas(page)).getByRole('checkbox', { name: 'Relieve del LiDAR' }).check();
    await expect(map).toHaveAttribute('data-terrain', 'lidar');
    await page.keyboard.press('Escape');

    // Radio draws its ring on the ground and lists the assets inside.
    await page.keyboard.press('5');
    const radio = panel(page, 'Radio');
    await expect(radio).toBeVisible();
    await radio.getByLabel('Radio de proximidad').selectOption('5000');
    await expect(map).toHaveAttribute('data-radius', '5000');
    const list = radio.getByTestId('radius-list');
    await expect(list.locator('li').first()).toBeVisible();
    const count = await list.locator('li').count();
    expect(count).toBeGreaterThan(3);
    await expect(map).toHaveAttribute('data-radius-count', String(count));
    await expect(radio.getByTestId('radius-count')).toContainText(
      `${count} activos a menos de 5 km`,
    );
    await page.keyboard.press('Escape');
    await expect(map).not.toHaveAttribute('data-radius');
  } finally {
    expect((await request.delete(`/api/layers/${id}`)).status()).toBe(204);
  }
});
