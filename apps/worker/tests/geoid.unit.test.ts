import { describe, it, expect } from 'vitest';
import { egm96Undulation, planVertical } from '../src/geoid.js';
// Centre of the synthetic fixture, near Laguna de Duero: ETRS89 / UTM 30N (356700, 4604900).
const laguna = { lat: 41.582947, lng: -4.719097 };
// Reference values computed with PROJ 9 (pyproj 3.8) at that point:
// - EGM96 15' grid (us_nga_egm96_15.tif), bilinear: N = 53.6005 m
// - official EGM08-REDNAP (es_ign_egm08-rednap.tif, EPSG:25830+5782 → 4937): N = 53.1062 m
const EGM96_REFERENCE = 53.6005;
const EGM08_REDNAP_REFERENCE = 53.1062;
describe('Geoid undulation (orthometric → ellipsoidal heights)', () => {
  it('matches the PROJ EGM96 grid at Laguna de Duero to the centimetre', () => {
    expect(egm96Undulation(laguna.lat, laguna.lng)).toBeCloseTo(EGM96_REFERENCE, 2);
  });
  it('stays within the documented 0.6 m budget of the official EGM08-REDNAP here', () => {
    const error = egm96Undulation(laguna.lat, laguna.lng) - EGM08_REDNAP_REFERENCE;
    expect(error).toBeGreaterThan(0.4);
    expect(error).toBeLessThan(0.6);
  });
  it('is about +53 m across Valladolid and rejects impossible coordinates', () => {
    const valladolid = egm96Undulation(41.6523, -4.7245);
    expect(valladolid).toBeGreaterThan(52);
    expect(valladolid).toBeLessThan(55);
    expect(() => egm96Undulation(Number.NaN, 0)).toThrow(RangeError);
    expect(() => egm96Undulation(91, 0)).toThrow(RangeError);
  });
});
describe('Vertical plan', () => {
  const base = {
    datum: 'orthometric' as const,
    layerOverride: null,
    envOverride: undefined,
    gridOffset: null,
    center: laguna,
  };
  it('uses the official grid per point when it is installed', () => {
    expect(planVertical({ ...base, gridOffset: 53.10619 })).toEqual({
      method: 'egm08_rednap_grid',
      offset_m: 53.106,
      exact: true,
    });
  });
  it('falls back to EGM96 at the tile centre without the grid', () => {
    const plan = planVertical(base);
    expect(plan.method).toBe('egm96_centre');
    expect(plan.exact).toBe(false);
    expect(plan.offset_m).toBeCloseTo(EGM96_REFERENCE, 2);
  });
  it('lets a per-layer override win over the environment and the models', () => {
    expect(planVertical({ ...base, layerOverride: 50, envOverride: 40, gridOffset: 53 })).toEqual({
      method: 'override',
      offset_m: 50,
      exact: false,
    });
    expect(planVertical({ ...base, envOverride: 40, gridOffset: 53 })).toEqual({
      method: 'override',
      offset_m: 40,
      exact: false,
    });
  });
  it('applies nothing when the source heights are already ellipsoidal', () => {
    expect(planVertical({ ...base, datum: 'ellipsoidal', layerOverride: 50 })).toEqual({
      method: 'none',
      offset_m: 0,
      exact: false,
    });
  });
});
