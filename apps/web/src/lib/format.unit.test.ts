import { describe, expect, it } from 'vitest';
import { coordinates, count, initials } from './format';
describe('Spanish formatting', () => {
  it('uses the singular for exactly one', () => {
    expect(count(1, 'sensor activo', 'sensores activos')).toBe('1 sensor activo');
    expect(count(0, 'sensor activo', 'sensores activos')).toBe('0 sensores activos');
    expect(count(36, 'sensor activo', 'sensores activos')).toBe('36 sensores activos');
  });
  it('writes the hemisphere of each coordinate instead of assuming N and W', () => {
    expect(coordinates(41.6523, -4.7245, 4)).toBe('41.6523° N, 4.7245° O');
    expect(coordinates(-33.8688, 151.2093, 2)).toBe('33.87° S, 151.21° E');
    expect(coordinates(0, 0, 1)).toBe('0.0° N, 0.0° E');
  });
  it('builds initials from the organization name', () => {
    expect(initials('Valladolid Infrastructure Lab')).toBe('VI');
    expect(initials('Laguna')).toBe('L');
    expect(initials('')).toBe('—');
  });
});
