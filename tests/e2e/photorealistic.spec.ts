import { test, expect } from './fixtures';
import type { Page, Route } from '@playwright/test';
import { mapBase, openCapas } from './hud';

/*
 * The «Fotorrealista (Google)» layer without Google: Cesium ion's endpoint for the Google
 * Photorealistic 3D Tiles asset (2275207) is answered here with a small local tileset (a flat
 * 3 × 3 km mesh at the ground height of Torrelago), so the toggle, the hidden globe, the assets
 * clamped to the mesh, measuring on it, the on-screen credit and the error messages run without
 * a real token or network. Nothing here touches Google's servers or a real ion account.
 */
const ASSET = 2275207;
// Ellipsoidal height of the ground at Torrelago (698.84 m orthometric + N = 53.1 m).
const MESH_HEIGHT = 751.94;
const CENTRE = { lng: -4.7255, lat: 41.5875 };
const CREDIT = 'Teselas de prueba (no son de Google)';

/** East-north-up frame at a WGS84 point, as a column-major 4 × 4 matrix (3D Tiles transform). */
function enuFrame(lngDeg: number, latDeg: number, h: number) {
  const a = 6378137,
    e2 = 6.69437999014e-3;
  const lng = (lngDeg * Math.PI) / 180,
    lat = (latDeg * Math.PI) / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const origin = [
    (n + h) * Math.cos(lat) * Math.cos(lng),
    (n + h) * Math.cos(lat) * Math.sin(lng),
    (n * (1 - e2) + h) * Math.sin(lat),
  ];
  const east = [-Math.sin(lng), Math.cos(lng), 0];
  const north = [-Math.sin(lat) * Math.cos(lng), -Math.sin(lat) * Math.sin(lng), Math.cos(lat)];
  const up = [Math.cos(lat) * Math.cos(lng), Math.cos(lat) * Math.sin(lng), Math.sin(lat)];
  return [...east, 0, ...north, 0, ...up, 0, ...origin, 1];
}

/** A binary glTF with one flat square (glTF is y-up; 3D Tiles turns it z-up). */
function flatMesh(half: number) {
  const positions = new Float32Array([
    -half,
    0,
    -half,
    half,
    0,
    -half,
    half,
    0,
    half,
    -half,
    0,
    half,
  ]);
  const indices = new Uint16Array([0, 2, 1, 0, 3, 2]);
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: { baseColorFactor: [0.55, 0.6, 0.5, 1], metallicFactor: 0 },
        doubleSided: true,
      },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      {
        buffer: 0,
        byteOffset: positions.byteLength,
        byteLength: indices.byteLength,
        target: 34963,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 4,
        type: 'VEC3',
        min: [-half, 0, -half],
        max: [half, 0, half],
      },
      { bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
  };
  const pad = (b: Buffer, fill: number) =>
    Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const jsonChunk = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const binChunk = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunk = (type: number, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(data.length, 0);
    head.writeUInt32LE(type, 4);
    return Buffer.concat([head, data]);
  };
  return Buffer.concat([header, chunk(0x4e4f534a, jsonChunk), chunk(0x004e4942, binChunk)]);
}

const cors = { 'access-control-allow-origin': '*' };
/**
 * Answers Cesium ion for the Google asset: a local tileset, an HTTP error or, with status 0, no
 * answer at all (no connection). The status can change between requests.
 */
async function fakeIon(page: Page, statusOf: number | (() => number) = 200) {
  const requests: string[] = [];
  await page.route('https://api.cesium.com/**', (route: Route) => {
    const url = route.request().url();
    const status = typeof statusOf === 'number' ? statusOf : statusOf();
    requests.push(url);
    if (status === 0) return route.abort('internetdisconnected');
    if (!url.includes(`/v1/assets/${ASSET}/endpoint`) || status !== 200)
      return route.fulfill({ status: status === 200 ? 404 : status, headers: cors, body: '{}' });
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify({
        type: '3DTILES',
        url: new URL('/__fake-google/tileset.json', page.url()).href,
        accessToken: 'fake-asset-token',
        attributions: [{ html: `<span>${CREDIT}</span>`, collapsible: false }],
      }),
    });
  });
  await page.route('**/__fake-google/tileset.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        asset: { version: '1.1' },
        geometricError: 100,
        root: {
          transform: enuFrame(CENTRE.lng, CENTRE.lat, MESH_HEIGHT),
          boundingVolume: { box: [0, 0, 0, 1500, 0, 0, 0, 1500, 0, 0, 0, 5] },
          geometricError: 0,
          refine: 'REPLACE',
          content: { uri: 'mesh.glb' },
        },
      }),
    }),
  );
  await page.route('**/__fake-google/mesh.glb', (route) =>
    route.fulfill({ contentType: 'model/gltf-binary', body: flatMesh(1500) }),
  );
  return requests;
}

interface DevViewer {
  scene: {
    globe: {
      show: boolean;
      ellipsoid: {
        cartographicToCartesian(c: object): unknown;
        cartesianToCartographic(c: unknown): { height: number };
      };
    };
    canvas: HTMLCanvasElement;
    requestRender(): void;
    pickPosition(p: { x: number; y: number }): unknown;
  };
  camera: { setView(options: object): void };
  entities: {
    values: { id: string; point?: { heightReference?: { getValue(t: unknown): number } } }[];
  };
  clock: { currentTime: unknown };
}
type DevWindow = Window & { __geotwinViewer?: DevViewer };

const map = (page: Page) => page.getByTestId('cesium-view');
const toggle = (page: Page) =>
  page.getByRole('button', { name: 'Fotorrealista (Google)', exact: true });

/** Opens the scene and Capas, where the option lives. */
async function open(page: Page) {
  await page.goto('/gemelo');
  await expect(map(page)).toHaveAttribute('data-ready', 'true', { timeout: 60000 });
  await openCapas(page);
  // Without a token the option is shown disabled, with the reason (a Compose build without one).
  if (await toggle(page).isDisabled()) {
    await expect(page.locator('#photoreal-help')).toContainText('token de Cesium ion');
    test.skip(true, 'Built without VITE_CESIUM_ION_TOKEN');
  }
}

/** Looks straight down at the mesh from 600 m and returns the ellipsoidal height picked there. */
async function pickedHeightAtCentre(page: Page) {
  return page.evaluate(
    async ({ lng, lat, h }) => {
      const v = (window as DevWindow).__geotwinViewer!;
      const r = Math.PI / 180;
      const scene = v.scene;
      const ellipsoid = scene.globe.ellipsoid;
      v.camera.setView({
        destination: ellipsoid.cartographicToCartesian({
          longitude: lng * r,
          latitude: lat * r,
          height: h + 600,
        }),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      for (let i = 0; i < 40; i++) {
        scene.requestRender();
        await new Promise((done) => setTimeout(done, 250));
        const picked = scene.pickPosition({
          x: scene.canvas.clientWidth / 2,
          y: scene.canvas.clientHeight / 2,
        });
        if (picked) return ellipsoid.cartesianToCartographic(picked).height;
      }
      return null;
    },
    { ...CENTRE, h: MESH_HEIGHT },
  );
}

test('Fotorrealista (Google) replaces the globe and keeps assets and measuring on top', async ({
  page,
}) => {
  test.setTimeout(150000);
  const requests = await fakeIon(page);
  await open(page);
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await toggle(page).click();
  await expect(map(page)).toHaveAttribute('data-photoreal', 'on', { timeout: 60000 });
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  expect(requests.some((url) => url.includes(`/v1/assets/${ASSET}/endpoint`))).toBe(true);
  // The tiles include the ground: the globe (and the LiDAR relief on it) is hidden.
  expect(await page.evaluate(() => (window as DevWindow).__geotwinViewer!.scene.globe.show)).toBe(
    false,
  );
  // The provider's attribution is shown on the map, not only behind the credits link, once the
  // mesh has loaded (several seconds under a software renderer).
  await expect(page.locator('.cesium-widget-credits')).toContainText(CREDIT, { timeout: 30000 });
  await expect(mapBase(page)).toContainText('Fotorrealista (Google)');
  // The mesh hides the base map: its control is disabled (and keeps its value) meanwhile.
  const fondo = page.getByRole('group', { name: 'Fondo' });
  const base = fondo.getByRole('button', { name: 'Ortofoto PNOA', exact: true });
  await expect(base).toBeDisabled();
  await expect(fondo).toHaveAttribute('title', /Oculto con Fotorrealista/);
  await expect(base).toHaveAttribute('aria-pressed', 'true');

  // Assets stand on the mesh: their height is taken from the 3D tiles, not from the terrain.
  const references = await page.evaluate(() => {
    const v = (window as DevWindow).__geotwinViewer!;
    return v.entities.values
      .filter((e) => e.id.startsWith('asset:'))
      .map((e) => e.point?.heightReference?.getValue(v.clock.currentTime));
  });
  expect(references.length).toBeGreaterThan(0);
  // HeightReference.RELATIVE_TO_3D_TILE
  expect(new Set(references)).toEqual(new Set([6]));

  // A click lands on the mesh (what the measuring tool reads).
  const picked = await pickedHeightAtCentre(page);
  expect(picked).not.toBeNull();
  expect(Math.abs(picked! - MESH_HEIGHT)).toBeLessThan(1.5);

  // Measuring still works on top: two clicks on the flat mesh give a distance and no height
  // difference. The clicks stay clear of the plates and of the tool's own panel.
  await page.getByRole('button', { name: 'Medir', exact: true }).click();
  await expect(page.getByText('0/2 puntos')).toBeVisible({ timeout: 20000 });
  const box = (await page.locator('.cesium-widget canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await expect(page.getByText('1/2 puntos')).toBeVisible({ timeout: 20000 });
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.2);
  const results = page.getByTestId('measure-results');
  await expect(results).toContainText(/Horizontal\s*\d+(,\d+)?\s*m/i, { timeout: 20000 });
  await expect(results).toContainText(/Desnivel\s*[±+−-]0,0\d\s*m/i);
  await page.getByRole('button', { name: 'Medir', exact: true }).click();
  await expect(results).toBeHidden();

  // Switching it off (in Capas again) brings the globe and the LiDAR view back.
  await openCapas(page);
  await toggle(page).click();
  await expect(map(page)).toHaveAttribute('data-photoreal', 'off');
  expect(await page.evaluate(() => (window as DevWindow).__geotwinViewer!.scene.globe.show)).toBe(
    true,
  );
  await expect(page.locator('.cesium-widget-credits')).not.toContainText(CREDIT);
  await expect(base).toBeEnabled();
  await expect(map(page)).toHaveAttribute('data-base-imagery', 'pnoa');
});

for (const [status, text] of [
  [401, /no da acceso/],
  [429, /cuota/],
] as const) {
  test(`Fotorrealista (Google) with HTTP ${status} keeps the LiDAR view`, async ({ page }) => {
    await fakeIon(page, status);
    await open(page);
    await toggle(page).click();
    await expect(map(page)).toHaveAttribute('data-photoreal', 'error', { timeout: 30000 });
    await expect(page.getByTestId('map-message')).toContainText(text);
    await expect(page.getByTestId('map-message')).toContainText('Sigue la vista LiDAR');
    expect(await page.evaluate(() => (window as DevWindow).__geotwinViewer!.scene.globe.show)).toBe(
      true,
    );
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  });
}

test('Fotorrealista (Google) can be tried again after a failure, without reloading', async ({
  page,
}) => {
  test.setTimeout(150000);
  let status = 0;
  const requests = await fakeIon(page, () => status);
  const endpoint = () => requests.filter((url) => url.includes(`/v1/assets/${ASSET}/endpoint`));
  await open(page);
  await toggle(page).click();
  await expect(map(page)).toHaveAttribute('data-photoreal', 'error', { timeout: 30000 });
  await expect(page.getByTestId('map-message')).toContainText('Sin conexión');
  const asked = endpoint().length;
  expect(asked).toBeGreaterThan(0);
  // The connection is back: the next click asks ion again and the layer loads.
  status = 200;
  await toggle(page).click();
  await expect(map(page)).toHaveAttribute('data-photoreal', 'on', { timeout: 60000 });
  expect(endpoint().length).toBeGreaterThan(asked);
  await expect(page.getByTestId('map-message')).toHaveCount(0);
});
