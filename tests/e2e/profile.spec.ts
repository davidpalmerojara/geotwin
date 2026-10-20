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
  const project = () =>
    page.evaluate(
      async ([lng, lat]) => {
        const { useScene } = (await import('/src/stores/viewer.ts' as string)) as {
          useScene: { getState(): { api: import('../../apps/web/src/stores/viewer').SceneApi } };
        };
        (window as unknown as { __geotwinViewer: V }).__geotwinViewer.scene.requestRender();
        const api = useScene.getState().api;
        return api.project(lng!, lat!, api.groundAt(lng!, lat!));
      },
      [p.lng, p.lat],
    );
  // The camera's matrices follow a setView on the next frame, which a slow renderer may not have
  // drawn yet: ask again until the point projects inside the page (a point off screen can never
  // be picked, however long the wait).
  const view = page.viewportSize()!;
  const onScreen = async () => {
    const at = await project();
    return !!at && at.x >= 0 && at.x <= view.width && at.y >= 0 && at.y <= view.height;
  };
  await expect
    .poll(onScreen, { message: `${p.lng}, ${p.lat} is on screen`, timeout: 30000 })
    .toBe(true);
  const at = (await project())!;
  return [at.x, at.y] as [number, number];
}
/**
 * The page position of a ground point once the globe drawn there is the ground itself. A and B are
 * picked on the rendered terrain (globe.pick) and the tool then walks the ray to the DTM, at most
 * 50 m. Right after the camera jumps, and for much longer on a loaded machine, the tile drawn under
 * the point can still be a coarse one or one of the previous view: the pick then meets it hundreds
 * of metres along the ray (A 354 m off made a 344,5 m line instead of 198 m). So the point counts as
 * pickable only once the globe under it is within 3 m of the point on the app's ground model.
 */
async function pickable(page: Page, p: { lng: number; lat: number }) {
  const at = await screen(page, p);
  await expect
    .poll(
      () =>
        page.evaluate(
          async ([x, y, lng, lat]) => {
            const v = (window as unknown as { __geotwinViewer: V }).__geotwinViewer;
            v.scene.requestRender();
            const ray = v.camera.getPickRay({ x, y } as never);
            const hit = ray && v.scene.globe.pick(ray, v.scene);
            if (!hit) return Infinity;
            const { useScene } = (await import('/src/stores/viewer.ts' as string)) as {
              useScene: {
                getState(): { api: import('../../apps/web/src/stores/viewer').SceneApi };
              };
            };
            const r = Math.PI / 180;
            const ground = v.scene.globe.ellipsoid.cartographicToCartesian({
              longitude: lng! * r,
              latitude: lat! * r,
              height: useScene.getState().api.groundAt(lng!, lat!),
            } as never);
            return Math.hypot(hit.x - ground.x, hit.y - ground.y, hit.z - ground.z);
          },
          [...at, p.lng, p.lat],
        ),
      { message: `the globe drawn under ${p.lng}, ${p.lat} is the ground`, timeout: 30000 },
    )
    .toBeLessThan(3);
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
    // Look at the middle of the line from the south, 450 m away. The target's height is the
    // app's ground model (the LiDAR DTM), not globe.getHeight: that reads whatever terrain tile
    // happens to be drawn, and right after the relief arrives that can still be the ellipsoid, at
    // height 0, so the camera went 750 m under the ground and was pushed up to 1 m over it, with
    // A and B far off screen (the flaky «pickable» timeout on CI).
    await page.evaluate(
      async ([lng, lat]) => {
        const v = (window as unknown as { __geotwinViewer: V }).__geotwinViewer;
        const { useScene } = (await import('/src/stores/viewer.ts' as string)) as {
          useScene: { getState(): { api: import('../../apps/web/src/stores/viewer').SceneApi } };
        };
        const r = Math.PI / 180,
          e = v.scene.globe.ellipsoid;
        const h = useScene.getState().api.groundAt(lng!, lat!);
        const target = e.cartographicToCartesian({
          longitude: lng! * r,
          latitude: lat! * r,
          height: h,
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
    // How the heights are taken is said under the heading, inside the drawer however many
    // buildings the line crosses.
    const note = drawer.getByTestId('profile-heights-note');
    await expect(note).toContainText('percentil 95');
    const [noteBox, drawerBox] = [(await note.boundingBox())!, (await drawer.boundingBox())!];
    expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(drawerBox.y + drawerBox.height);
    // In the scene, E1 and E2 are far enough apart to keep their values (the labels are laid
    // out on screen and drop the value only when two would overlap).
    await expect
      .poll(() =>
        page.evaluate(() => {
          const v = (window as unknown as { __geotwinViewer: V }).__geotwinViewer;
          v.scene.requestRender();
          const source = v.dataSources.getByName('perfil')[0];
          return (source?.entities.values ?? [])
            .filter((e) => e.id.startsWith('perfil:altura:etiqueta'))
            .map((e) => String(e.label?.text?.getValue(v.clock.currentTime)))
            .sort();
        }),
      )
      .toEqual([
        expect.stringMatching(/^E1 · \d+,\d m$/),
        expect.stringMatching(/^E2 · \d+,\d m$/),
      ]);
    // Seen from 600 m the heights' labels keep off the line A–B and the labels of its ticks.
    await expect
      .poll(() =>
        page.evaluate(() => {
          type B = { left: number; top: number; right: number; bottom: number };
          const v = (window as unknown as { __geotwinViewer: V }).__geotwinViewer;
          v.scene.requestRender();
          const p = (window as unknown as { __geotwinProfile?: { labels(): B[]; line(): B[] } })
            .__geotwinProfile!;
          const line = p.line();
          return p
            .labels()
            .filter((a) =>
              line.some(
                (b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom,
              ),
            ).length;
        }),
      )
      .toBe(0);
    // The cursor over the plot reads a distance and the ground under it. Moving it moves only its
    // mark in the scene: the line stays the same entity (a full redraw emptied the polyline
    // batches and the line, the plane and the heights vanished until rebuilt, on every move).
    const lineEntity = () =>
      page.evaluate(() => {
        const v = (window as unknown as { __geotwinViewer: import('cesium').Viewer })
          .__geotwinViewer;
        const line = v.dataSources.getByName('perfil')[0]?.entities.getById('perfil:linea');
        const w = window as unknown as { __e2eLine?: unknown };
        const same = !!line && w.__e2eLine === line;
        w.__e2eLine = line;
        return same;
      });
    await lineEntity();
    const canvas = (await page.getByTestId('profile-canvas').boundingBox())!;
    await page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.6, {
      steps: 3,
    });
    const readout = page.getByTestId('profile-readout');
    await expect(readout).toContainText(/Distancia desde A\s*\d+,\d m/);
    await expect(readout).toContainText(/Suelo \(MDT\)\s*\d+,\d m/);
    expect(await lineEntity(), 'the line was redrawn when the cursor moved').toBe(true);
    // The readout plate at the bottom follows the chart's cursor too (A/desktop-signature): the
    // same distance from A, ground and Cota as the drawer, and the point's position.
    const plate = page.getByTestId('readout');
    const drawerValue = async (name: string) =>
      (
        await readout
          .getByText(name, { exact: true })
          .locator('xpath=following-sibling::dd[1]')
          .innerText()
      ).trim();
    await expect(plate.getByTestId('readout-along')).toHaveText(
      await drawerValue('Distancia desde A'),
    );
    await expect(plate.getByTestId('readout-suelo')).toHaveText(await drawerValue('Suelo (MDT)'));
    await expect(plate.getByTestId('readout-position')).toHaveText(/^41,\d{5}°\sN\s+4,\d{5}°\sO$/);
    const cota = await drawerValue('Cota');
    if (cota !== '—') await expect(plate.getByTestId('readout-cota')).toHaveText(cota);
    // «Desde A» takes UTM's place: at 1440 px UTM shows for the scene's cursor, not for the chart's.
    await expect(plate.locator('.ro-utm')).toBeHidden();
    // Off the chart, onto the scene: the plate reads the scene's cursor again.
    const [sx, sy] = await page.evaluate(
      ([x, y]) => {
        for (let dy = 80; dy < 400; dy += 20)
          for (const dx of [0, -80, 80, -160, 160])
            if (document.elementFromPoint(x! + dx, y! - dy)?.matches('.cesium-widget canvas'))
              return [x! + dx, y! - dy];
        return [x!, y! - 120];
      },
      [canvas.x + canvas.width * 0.5, canvas.y],
    );
    await page.mouse.move(sx!, sy!, { steps: 3 });
    await expect(plate.getByTestId('readout-along')).toHaveCount(0);
    await expect(plate.locator('.ro-k').first()).toHaveText('Cursor');
    await expect(plate.locator('.ro-utm')).toBeVisible();

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
    // The distances and the radius it writes in the scene are not covered by an installation
    // label, an asset's tag or an edge chip.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            type B = { left: number; top: number; right: number; bottom: number };
            const v = (window as unknown as { __geotwinViewer: V }).__geotwinViewer;
            v.scene.requestRender();
            const { values, boxes } = (
              window as unknown as { __geotwinLabels: { values: B[]; boxes: B[] } }
            ).__geotwinLabels;
            const canvas = v.scene.canvas.getBoundingClientRect();
            const onCanvas = (r: DOMRect): B => ({
              left: r.left - canvas.left,
              right: r.right - canvas.left,
              top: r.top - canvas.top,
              bottom: r.bottom - canvas.top,
            });
            const shown = (selector: string) =>
              [...document.querySelectorAll<HTMLElement>(selector)]
                .filter((e) => e.style.display !== 'none')
                .map((e) => onCanvas(e.getBoundingClientRect()))
                .filter((b) => b.right > b.left);
            const others = [
              ...boxes,
              ...shown('[data-testid="scene-tag"]'),
              ...shown('[data-testid="edge-chip"]'),
            ];
            const hit = (a: B, b: B) =>
              a.left < b.right - 1 &&
              b.left < a.right - 1 &&
              a.top < b.bottom - 1 &&
              b.top < a.bottom - 1;
            // Nor are they left under a plate or cut by the edge of the view: a distance moves to
            // the other side of its leader, or goes (the panel lists them all).
            const plates = shown('[data-map-overlay]');
            return {
              values: values.length,
              covered: values.filter((a) => others.some((b) => hit(a, b))).length,
              underPlate: values.filter((a) => plates.some((b) => hit(a, b))).length,
              outside: values.filter(
                (a) =>
                  a.left < 0 || a.top < 0 || a.right > canvas.width || a.bottom > canvas.height,
              ).length,
            };
          }),
        { timeout: 30000 },
      )
      .toEqual({ values: expect.any(Number), covered: 0, underPlate: 0, outside: 0 });
    await page.keyboard.press('Escape');
    await expect(map).not.toHaveAttribute('data-radius');
  } finally {
    expect((await request.delete(`/api/layers/${id}`)).status()).toBe(204);
  }
});
