import { test as base, expect, type Page, type Route } from '@playwright/test';
import { crc32, deflateSync } from 'node:zlib';

/*
 * No test touches the PNOA servers: every request to the IDEE TMS, the IGN WMTS and the local
 * /ortho/ folder is answered here. The default mode serves small MOCK tiles (a checkerboard, one
 * colour per zoom level, with CORS headers), so the orthophoto path runs in every spec; a test
 * can pick another mode with `test.use({ pnoaMode })` to check the fallbacks. A developer's own
 * apps/web/public/ortho/ copy never changes a result: /ortho/ is answered here as well.
 */
export type PnoaMode =
  /** IDEE answers with mock tiles. */
  | 'mock'
  /** IDEE answers for another origin only (the browser blocks it: CORS); the WMTS works. */
  | 'no-cors'
  /** Every source is refused or unreachable. */
  | 'all-fail'
  /** IDEE answers the probe and a few tiles, then 504 for every tile; the WMTS works. */
  | 'outage'
  /** /ortho/ serves the mock tiles, as after scripts/fetch-ortho.sh. */
  | 'local';

export interface PnoaRequest {
  source: 'idee' | 'ign' | 'local';
  z: number;
  x: number;
  y: number;
  status: number;
}

// Mock colours per zoom level: saturated and far from any real ground or the Natural Earth atlas.
export const MOCK_COLOURS: Record<number, [number, number, number]> = {
  13: [255, 0, 200],
  14: [255, 0, 200],
  15: [255, 0, 200],
  16: [200, 0, 255],
  17: [255, 0, 120],
  18: [140, 0, 255],
  19: [255, 60, 255],
};
const colourOf = (z: number) => MOCK_COLOURS[Math.max(13, Math.min(19, z))]!;

function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}
const tiles = new Map<number, Buffer>();
/** A 256 px PNG checkerboard (32 px squares) in the zoom level's colour and a darker shade. */
export function mockTile(z: number) {
  const cached = tiles.get(z);
  if (cached) return cached;
  const [r, g, b] = colourOf(z);
  const size = 256;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const dark = ((x >> 5) + (y >> 5)) % 2 === 1;
      const k = dark ? 0.7 : 1;
      raw[row + 1 + x * 3] = Math.round(r * k);
      raw[row + 2 + x * 3] = Math.round(g * k);
      raw[row + 3 + x * 3] = Math.round(b * k);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  tiles.set(z, png);
  return png;
}

const CORS = { 'access-control-allow-origin': '*' };
function tileOf(source: PnoaRequest['source'], url: URL) {
  if (source === 'ign') {
    const p = url.searchParams;
    return {
      z: Number(p.get('tilematrix')),
      x: Number(p.get('tilecol')),
      y: Number(p.get('tilerow')),
    };
  }
  const [z, x, y] = url.pathname
    .split('/')
    .slice(-3)
    .map((s) => Number.parseInt(s, 10));
  // The IDEE TMS counts rows from the south: report XYZ rows like the other sources.
  return source === 'idee' ? { z: z!, x: x!, y: 2 ** z! - 1 - y! } : { z: z!, x: x!, y: y! };
}

/** Answers every PNOA request of the page according to `mode`; returns the requests seen. */
export async function routePnoa(page: Page, mode: PnoaMode, okTiles = 6) {
  const log: PnoaRequest[] = [];
  let ideeServed = 0;
  const answer = async (route: Route, source: PnoaRequest['source']) => {
    const url = new URL(route.request().url());
    const tile = tileOf(source, url);
    let status = 200,
      headers: Record<string, string> = { ...CORS, 'content-type': 'image/png' };
    if (source === 'local' && mode !== 'local') status = 404;
    if (source === 'idee') {
      if (mode === 'all-fail') status = 403;
      if (mode === 'local') status = 503;
      // Playwright adds Access-Control-Allow-Origin to a fulfilled response that has none, so
      // the refusal is an allowed origin that is not this page's: the browser blocks it for real.
      if (mode === 'no-cors')
        headers = {
          'access-control-allow-origin': 'https://otro-origen.example',
          'content-type': 'image/png',
        };
      if (mode === 'outage' && ideeServed++ >= okTiles) status = 504;
    }
    // When every source fails, the WMTS is unreachable (no answer at all).
    if (source === 'ign' && mode === 'all-fail') {
      log.push({ source, ...tile, status: 0 });
      return route.abort('connectionrefused');
    }
    log.push({ source, ...tile, status });
    if (status !== 200)
      return route.fulfill({
        status,
        headers: { ...CORS, 'content-type': 'text/plain' },
        body: '',
      });
    return route.fulfill({ status, headers, body: mockTile(tile.z) });
  };
  await page.route('https://tms-pnoa-ma.idee.es/**', (route) => answer(route, 'idee'));
  await page.route('https://www.ign.es/wmts/**', (route) => answer(route, 'ign'));
  await page.route(/\/ortho\/\d+\/\d+\/\d+\.jpg$/, (route) => answer(route, 'local'));
  return log;
}

export const test = base.extend<{ pnoaMode: PnoaMode; pnoa: PnoaRequest[] }>({
  pnoaMode: ['mock', { option: true }],
  pnoa: [
    async ({ page, pnoaMode }, use) => {
      await use(await routePnoa(page, pnoaMode));
    },
    { auto: true },
  ],
});
export { expect };
