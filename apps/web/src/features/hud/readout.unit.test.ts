import { describe, expect, it } from 'vitest';
import {
  formatLatLon,
  formatSigned,
  formatUtm,
  geoidAt,
  grouped,
  NBSP,
  niceScale,
  NO_CURSOR,
  NO_RELIEF,
  OUTSIDE,
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
