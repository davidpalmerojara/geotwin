import { describe, expect, it } from 'vitest';
import { assetTypeLabel, axisTick, coordinates, count, decimal, initials, number } from './format';
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
  it('writes sensor values with a decimal comma, like the measuring tool', () => {
    expect(number(2.352, 1)).toBe('2,4');
    expect(number(42, 1)).toBe('42,0');
    expect(decimal(1.7)).toBe('1,7');
    expect(decimal(85)).toBe('85');
    expect(decimal(0.125)).toBe('0,13');
  });
  it('writes chart axis ticks with a decimal comma too', () => {
    expect(axisTick(1.05)).toBe('1,05');
    expect(axisTick(0.35)).toBe('0,35');
    expect(axisTick('0.7')).toBe('0,7');
    expect(axisTick(15)).toBe('15');
  });
  it('names the level probe as such, not as a reservoir', () => {
    expect(assetTypeLabel.level_probe).toBe('Sonda de nivel');
    expect(assetTypeLabel.reservoir).toBe('Depósito');
  });
});
