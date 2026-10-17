import { describe, expect, it } from 'vitest';
import {
  baseImageryLabel,
  effectiveBase,
  PNOA_UNAVAILABLE,
  sceneLabel,
  classifyPnoaError,
  expandTemplate,
  IDEE_TEMPLATE,
  ImageryFailureWatch,
  LOCAL_TEMPLATE,
  parseSources,
  pickSource,
  pnoaSources,
  probeSource,
  PROBE_TILE,
  tmsY,
  wmtsTileUrl,
  type PnoaSource,
} from './base-imagery';

// Torrelago: the same tiles at three zoom levels, checked against the XYZ and TMS formulas.
const TORRELAGO = [
  { z: 15, x: 15953, y: 12214, tms: 20553 },
  { z: 17, x: 63815, y: 48856, tms: 82215 },
  { z: 19, x: 255262, y: 195427, tms: 328860 },
];
const xyz = (lng: number, lat: number, z: number) => {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n),
  };
};
const response = (status: number, type: string) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': type }),
});

describe('PNOA sources', () => {
  it('turns XYZ rows into TMS rows for the Torrelago tiles', () => {
    for (const t of TORRELAGO) {
      expect(tmsY(t.z, t.y)).toBe(t.tms);
      expect(xyz(-4.7252, 41.589, t.z)).toEqual({ x: t.x, y: t.y });
    }
    expect(expandTemplate(IDEE_TEMPLATE, TORRELAGO[2]!)).toBe(
      'https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/19/255262/328860.jpeg',
    );
    expect(expandTemplate(LOCAL_TEMPLATE, TORRELAGO[0]!)).toBe('/ortho/15/15953/12214.jpg');
  });
  it('asks the WMTS for the same tile with the KVP parameters Cesium sends', () => {
    const url = new URL(wmtsTileUrl('https://www.ign.es/wmts/pnoa-ma', PROBE_TILE));
    expect(url.searchParams.get('request')).toBe('GetTile');
    expect(url.searchParams.get('layer')).toBe('OI.OrthoimageCoverage');
    expect(url.searchParams.get('tilematrixset')).toBe('GoogleMapsCompatible');
    expect(url.searchParams.get('tilematrix')).toBe('15');
    expect(url.searchParams.get('tilerow')).toBe('12214');
    expect(url.searchParams.get('tilecol')).toBe('15953');
  });
  it('reads the source order from the environment and drops unknown names', () => {
    expect(parseSources(undefined)).toEqual(['local', 'idee', 'ign']);
    expect(parseSources('ign, IDEE,foo,ign')).toEqual(['ign', 'idee']);
    expect(parseSources(' , ')).toEqual(['local', 'idee', 'ign']);
    const sources = pnoaSources({ sources: 'idee,ign', tileUrl: '/pnoa/{z}/{x}/{reverseY}.jpg' });
    expect(sources.map((s) => s.id)).toEqual(['idee', 'ign']);
    expect(sources[0]!.probeUrl).toBe('/pnoa/15/15953/20553.jpg');
    const local = pnoaSources({ sources: 'local' })[0]!;
    expect(local.minimumLevel).toBe(13);
    expect(local.maximumLevel).toBe(19);
    expect(local.rectangle).toEqual([-4.7418, 41.5642, -4.7012, 41.5945]);
  });
});

describe('Probing and failover', () => {
  const [local, idee, ign] = pnoaSources() as [PnoaSource, PnoaSource, PnoaSource];
  it('passes only a 2xx image: an HTML 200 is the SPA fallback, not a tile', async () => {
    expect(await probeSource(local, async () => response(200, 'image/jpeg'))).toEqual({
      ok: true,
    });
    expect(await probeSource(local, async () => response(200, 'text/html'))).toEqual({
      ok: false,
      problem: 'not-image',
    });
    expect(await probeSource(idee, async () => response(503, 'text/plain'))).toEqual({
      ok: false,
      problem: 'service',
    });
    expect(
      await probeSource(idee, async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).toEqual({ ok: false, problem: 'offline' });
  });
  it('gives up on a probe that never answers', async () => {
    const never = (_url: string, init?: RequestInit) =>
      new Promise<never>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        ),
      );
    expect(await probeSource(idee, never, 10)).toEqual({ ok: false, problem: 'offline' });
  });
  it('picks the first source that answers', async () => {
    const answers: Record<
      string,
      () => Promise<{ ok: boolean; problem?: 'not-image' | 'offline' }>
    > = {
      local: async () => ({ ok: false, problem: 'not-image' }),
      idee: async () => ({ ok: true }),
      ign: async () => ({ ok: true }),
    };
    const pick = await pickSource([local, idee, ign], (s) => answers[s.id]!());
    expect(pick.source?.id).toBe('idee');
    expect(pick.index).toBe(1);
    expect(pick.failures).toEqual([{ id: 'local', problem: 'not-image' }]);
    // idee unreachable (no answer or blocked by CORS) → the WMTS.
    answers.idee = async () => ({ ok: false, problem: 'offline' });
    expect((await pickSource([local, idee, ign], (s) => answers[s.id]!())).source?.id).toBe('ign');
    // Failover starts after the source that stopped working.
    expect((await pickSource([local, idee, ign], (s) => answers[s.id]!(), 2)).source?.id).toBe(
      'ign',
    );
    answers.ign = async () => ({ ok: false, problem: 'offline' });
    const none = await pickSource([local, idee, ign], (s) => answers[s.id]!());
    expect(none.source).toBeUndefined();
    expect(none.failures.map((f) => f.id)).toEqual(['local', 'idee', 'ign']);
  });
  it('classifies tile errors', () => {
    expect(classifyPnoaError({ statusCode: 403 })).toBe('access');
    expect(classifyPnoaError({ status: 404 })).toBe('access');
    expect(classifyPnoaError({ statusCode: 504 })).toBe('service');
    expect(classifyPnoaError({ statusCode: 429 })).toBe('service');
    expect(classifyPnoaError({ statusCode: undefined })).toBe('offline');
    expect(classifyPnoaError(new TypeError('Failed to fetch'))).toBe('offline');
    expect(classifyPnoaError('odd')).toBe('unknown');
  });
  it('abandons a source on a refusal or after a run of failures, not on a few missing tiles', () => {
    const watch = new ImageryFailureWatch(3);
    expect(watch.failed({ statusCode: 504 })).toBe(false);
    expect(watch.failed({ statusCode: 504 })).toBe(false);
    watch.loaded();
    expect(watch.failed({ statusCode: 504 })).toBe(false);
    expect(watch.failed({ statusCode: 404 })).toBe(false);
    expect(watch.failed({ statusCode: undefined })).toBe(false);
    expect(watch.failed({ statusCode: 504 })).toBe(true);
    expect(new ImageryFailureWatch().failed({ statusCode: 403 })).toBe(true);
  });
  it('labels the base map in plain words, without calling the atlas «local»', () => {
    expect(baseImageryLabel('pnoa', 'on', 'idee')).toBe('Ortofoto PNOA');
    expect(baseImageryLabel('pnoa', 'on', 'local')).toBe('Ortofoto PNOA (descargada)');
    expect(baseImageryLabel('pnoa', 'probing', undefined)).toBe('Ortofoto PNOA (cargando)');
    expect(baseImageryLabel('pnoa', 'error', undefined)).toBe('Fondo neutro (PNOA no disponible)');
    expect(baseImageryLabel('neutral', 'on', 'idee')).toBe('Fondo neutro');
    expect(baseImageryLabel('natural-earth', 'on', 'idee')).toBe('Atlas Natural Earth');
    expect(sceneLabel('pnoa', 'on', 'local', 'lidar', false)).toBe(
      'Ortofoto PNOA (descargada) · relieve LiDAR',
    );
    expect(sceneLabel('pnoa', 'error', undefined, 'lidar', false)).toBe(
      'Fondo neutro (PNOA no disponible) · relieve LiDAR',
    );
    expect(sceneLabel('natural-earth', 'off', undefined, 'ellipsoid', false)).toBe(
      'Atlas Natural Earth · globo básico',
    );
    expect(sceneLabel('pnoa', 'on', 'idee', 'lidar', true)).toBe('Fotorrealista (Google)');
  });
  it('falls back to the neutral ground when the orthophoto fails, never to the atlas', () => {
    expect(effectiveBase('pnoa', 'error')).toBe('neutral');
    expect(effectiveBase('pnoa', 'on')).toBe('pnoa');
    expect(effectiveBase('pnoa', 'probing')).toBe('pnoa');
    expect(effectiveBase('natural-earth', 'error')).toBe('natural-earth');
    expect(effectiveBase('neutral', 'error')).toBe('neutral');
    expect(PNOA_UNAVAILABLE).toContain('fondo neutro');
    expect(PNOA_UNAVAILABLE).not.toContain('atlas');
  });
});
