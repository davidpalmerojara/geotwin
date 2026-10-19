import { describe, expect, it } from 'vitest';
import {
  assetReadout,
  formatLatLon,
  formatSigned,
  formatUtm,
  geoidAt,
  grouped,
  NBSP,
  niceScale,
  NO_CURSOR,
  NO_GROUND,
  NO_RELIEF,
  nextHover,
  OUTSIDE,
  profileReadout,
  readout,
} from './readout';

const plain = (s: string) => s.replaceAll(NBSP, ' ');
// A roof at Torrelago: 790,8 m ellipsoidal over a 753,2 m ground, N = 53,1 m.
const roof = { lng: -4.72497, lat: 41.58972, h: 790.8 };

describe('cursor readout', () => {
  it('writes latitude and longitude with N/O and a decimal comma', () => {
    expect(plain(formatLatLon(41.58972, -4.72497))).toBe('41,58972° N  4,72497° O');
    expect(plain(formatLatLon(-33.5, 151.25, 2))).toBe('33,50° S  151,25° E');
  });
  it('writes UTM 30N in groups of three with a decimal comma', () => {
    expect(plain(grouped(4605661.63))).toBe('4 605 661,6');
    expect(plain(grouped(356225.5))).toBe('356 225,5');
    expect(plain(formatUtm(-4.7252, 41.589))).toBe('356 204,7  4 605 582,2');
  });
  it('signs the height above the ground', () => {
    expect(plain(formatSigned(37.6))).toBe('+37,6 m');
    expect(plain(formatSigned(-0.44))).toBe('−0,4 m');
    expect(plain(formatSigned(0.02))).toBe('0,0 m');
  });
  it('shows orthometric heights over the LiDAR sheets', () => {
    const r = readout({ point: roof, ground: 753.2, geoid: 53.1, relief: true });
    expect(plain(r.position.text)).toBe('41,58972° N  4,72497° O');
    expect(plain(r.utm.text)).toMatch(/^356 \d{3},\d {2}4 605 \d{3},\d$/);
    expect(plain(r.cota.text)).toBe('737,7 m');
    expect(plain(r.suelo.text)).toBe('700,1 m');
    expect(plain(r.sobre.text)).toBe('+37,6 m');
  });
  it('gives «—» with the reason when a height would not be true', () => {
    const outside = readout({ point: roof, ground: null, geoid: null, relief: true });
    expect(outside.cota).toEqual({ text: '—', reason: OUTSIDE });
    expect(outside.sobre).toEqual({ text: '—', reason: OUTSIDE });
    expect(outside.utm.text).not.toBe('—');
    const flat = readout({ point: roof, ground: 753.2, geoid: 53.1, relief: false });
    expect(flat.suelo).toEqual({ text: '—', reason: NO_RELIEF });
    const nothing = readout({ point: null, ground: null, geoid: null, relief: true });
    expect(nothing.position).toEqual({ text: '—', reason: NO_CURSOR });
    const sky = readout({
      point: null,
      ground: null,
      geoid: null,
      relief: true,
      missing: NO_GROUND,
    });
    expect(sky.cota).toEqual({ text: '—', reason: NO_GROUND });
  });
});

describe('readout over an asset', () => {
  // A gateway 41,9 m up on a tower roof, over a 752,3 m ground (N = 53,1 m).
  const gateway = { location: { lng: -4.72565, lat: 41.58786 }, mount_height_m: 41.9 };
  it('gives its Cota (the DTM plus the mount) and its height above the ground', () => {
    const r = assetReadout(gateway, 752.3, 53.1, true);
    expect(plain(r.position.text)).toBe('41,58786° N  4,72565° O');
    expect(plain(r.suelo.text)).toBe('699,2 m');
    expect(plain(r.cota.text)).toBe('741,1 m');
    expect(plain(r.sobre.text)).toBe('+41,9 m');
  });
  it('gives «—» with the reason outside the sheets or without the relief', () => {
    expect(assetReadout(gateway, null, null, true).cota).toEqual({ text: '—', reason: OUTSIDE });
    expect(assetReadout(gateway, 752.3, 53.1, false).sobre).toEqual({
      text: '—',
      reason: NO_RELIEF,
    });
  });
});

describe('readout from the profile chart', () => {
  // E4's roof in A/desktop-signature: 742,4 m over a 701,3 m ground.
  const at = { lng: -4.72591, lat: 41.58944, geoid: 53.1 };
  it('gives the point under the chart cursor: Cota, ground and height above it', () => {
    const r = profileReadout({ ...at, z: 742.4, ground: 701.3 });
    expect(plain(r.position.text)).toBe('41,58944° N  4,72591° O');
    expect(plain(r.cota.text)).toBe('742,4 m');
    expect(plain(r.suelo.text)).toBe('701,3 m');
    expect(plain(r.sobre.text)).toBe('+41,1 m');
  });
  it('reads the ground where the slab has no point, and «—» outside the DTM', () => {
    const bare = profileReadout({ ...at, z: null, ground: 701.3 });
    expect(plain(bare.cota.text)).toBe('701,3 m');
    expect(plain(bare.sobre.text)).toBe('0,0 m');
    const off = profileReadout({ ...at, z: 742.4, ground: null });
    expect(plain(off.cota.text)).toBe('—');
    expect(off.sobre).toEqual({ text: '—', reason: OUTSIDE });
    expect(off.position.text).not.toBe('—');
  });
});

describe('asset under the pointer', () => {
  const A = 'asset-a';
  it('follows a mouse onto a mark and off it', () => {
    let hover = nextHover(null, { type: 'over', pointer: 'mouse', asset: A });
    expect(hover).toBe(A);
    // Leaving the mark for its own tag keeps it until the next «over» says otherwise.
    hover = nextHover(hover, { type: 'out', pointer: 'mouse', page: false });
    expect(hover).toBe(A);
    expect(nextHover(hover, { type: 'over', pointer: 'mouse', asset: null })).toBeNull();
  });
  it('drops it when the pointer leaves the page from the mark', () => {
    expect(nextHover(A, { type: 'out', pointer: 'mouse', page: true })).toBeNull();
  });
  it('never comes from a tap', () => {
    expect(nextHover(null, { type: 'over', pointer: 'touch', asset: A })).toBeNull();
    expect(nextHover(A, { type: 'over', pointer: 'pen', asset: A })).toBeNull();
    expect(nextHover(A, { type: 'out', pointer: 'touch', page: false })).toBeNull();
  });
  it('drops it when the mark moves away from a still pointer or is taken out', () => {
    expect(nextHover(A, { type: 'recheck', asset: null })).toBeNull();
    expect(nextHover(A, { type: 'recheck', asset: 'asset-b' })).toBe('asset-b');
    expect(nextHover(A, { type: 'recheck', asset: A })).toBe(A);
    // A mark arriving under a still pointer waits for the pointer to move.
    expect(nextHover(null, { type: 'recheck', asset: A })).toBeNull();
  });
});

describe('scale bar', () => {
  it('picks the longest round length that fits', () => {
    // 50 m in 143 px, as in the mockup's overview camera.
    const bar = niceScale(50 / 143, 160)!;
    expect(bar.metres).toBe(50);
    expect(bar.px).toBeCloseTo(143, 5);
    expect(bar.labels.map(plain)).toEqual(['0', '25', '50 m']);
    expect(niceScale(0.1, 160)!.metres).toBe(10);
    expect(niceScale(0.16, 160)!.metres).toBe(20);
    expect(niceScale(0.03, 160)!.labels.map(plain)).toEqual(['0', '1', '2 m']);
  });
  it('switches to kilometres', () => {
    expect(niceScale(20, 160)!.labels.map(plain)).toEqual(['0', '1', '2 km']);
    expect(niceScale(10, 160)!.labels.map(plain)).toEqual(['0', '500 m', '1 km']);
    expect(niceScale(0, 160)).toBeNull();
    expect(niceScale(Number.NaN, 160)).toBeNull();
  });
});

describe('geoid under the cursor', () => {
  const sheet = (bbox: [number, number, number, number], n: number | null, status = 'ready') =>
    ({ status, bbox, vertical: { geoid_offset_m: n } }) as Parameters<typeof geoidAt>[0][number];
  it('takes N from the ready sheet whose box holds the point', () => {
    const layers = [
      sheet([-4.74, 41.57, -4.73, 41.58], 53.2, 'processing'),
      sheet([-4.7273, 41.5747, -4.7153, 41.5839], 53.1),
    ];
    expect(geoidAt(layers, -4.72, 41.58)).toBe(53.1);
    expect(geoidAt(layers, -4.735, 41.575)).toBeNull();
    expect(geoidAt([sheet([-4.73, 41.57, -4.71, 41.59], null)], -4.72, 41.58)).toBeNull();
  });
});
