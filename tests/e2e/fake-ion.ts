import type { Page, Route } from '@playwright/test';

/*
 * A stand-in for Cesium ion and the Google Photorealistic 3D Tiles asset (2275207): ion's
 * endpoint is answered with a small local tileset (a flat 3 × 3 km mesh at the ground height of
 * Torrelago), so the «Fotorrealista (Google)» layer runs without a real token or network.
 * Nothing here touches Google's servers or a real ion account.
 */
export const ASSET = 2275207;
// Ellipsoidal height of the ground at Torrelago (698.84 m orthometric + N = 53.1 m).
export const MESH_HEIGHT = 751.94;
export const CENTRE = { lng: -4.7255, lat: 41.5875 };
export const CREDIT = 'Teselas de prueba (no son de Google)';

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
 * answer at all (no connection). The status can change between requests. `mesh` answers the
 * tileset's only content (its root): 200 for the mesh, another status for an error, or 'hang'
 * for a request that never gets an answer.
 */
export async function fakeIon(
  page: Page,
  statusOf: number | (() => number) = 200,
  mesh: () => number | 'hang' = () => 200,
) {
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
  await page.route('**/__fake-google/mesh.glb', (route) => {
    const status = mesh();
    if (status === 'hang') return; // never answered while the page lives
    if (status !== 200) return route.fulfill({ status, headers: cors, body: 'Internal error' });
    return route.fulfill({ contentType: 'model/gltf-binary', body: flatMesh(1500) });
  });
  return requests;
}
