import { describe, expect, it } from 'vitest';
import { Cartesian3, Cesium3DTileStyle } from 'cesium';
import {
  ALL_CLASS_GROUPS,
  buildPointCloudStyle,
  classFilter,
  ellipsoidalRange,
  globeShift,
  heightExpression,
  HEIGHT_RAMP,
  pointSpacing,
  rampBounds,
  shadingFor,
} from './point-style';
import { mebibytes, validateFile } from './upload';

const centre = { lat: 41.58295, lng: -4.7191 };
// What Cesium substitutes for a point cloud's built-in and batch-table variables.
const variables = {
  POSITION: 'attributes.positionMC',
  POSITION_ABSOLUTE: 'v_positionWC',
  COLOR: 'attributes.color_0',
  classification: 'metadata.classification',
};
// Internal Cesium API (not in its typings): the GLSL a point cloud gets for this style.
interface ShaderStyle {
  getColorShaderFunction(name: string, map: object, state: object): string;
  getShowShaderFunction(name: string, map: object, state: object): string;
}
function shader(json: ReturnType<typeof buildPointCloudStyle>) {
  const style = new Cesium3DTileStyle(json) as unknown as ShaderStyle;
  return {
    color: style.getColorShaderFunction('getColorFromStyle', variables, { translucent: false }),
    show: style.getShowShaderFunction('getShowFromStyle', variables, {}),
  };
}

describe('Point-cloud style builders', () => {
  it('RGB with every class keeps the stored colours and shows everything', () => {
    const style = buildPointCloudStyle({ mode: 'rgb', classes: { ...ALL_CLASS_GROUPS } });
    expect(style).toEqual({});
    expect(classFilter({ ...ALL_CLASS_GROUPS })).toBeUndefined();
  });
  it('class filters translate to a show expression, with "otros" as everything else', () => {
    expect(classFilter({ ...ALL_CLASS_GROUPS, vegetation: false, other: false })).toBe(
      '${classification} === 2 || ${classification} === 6 || ${classification} === 9',
    );
    const others = classFilter({
      ground: false,
      vegetation: false,
      buildings: false,
      water: false,
      other: true,
    });
    expect(others).toBe(
      '(${classification} !== 2 && ${classification} !== 3 && ${classification} !== 4 && ' +
        '${classification} !== 5 && ${classification} !== 6 && ${classification} !== 9)',
    );
    expect(
      classFilter({
        ground: false,
        vegetation: false,
        buildings: false,
        water: false,
        other: false,
      }),
    ).toBe('false');
  });
  it('classification colours use the ASPRS codes and compile to a point-cloud shader', () => {
    const style = buildPointCloudStyle({
      mode: 'classification',
      classes: { ...ALL_CLASS_GROUPS, water: false },
    });
    const conditions = (style.color as { conditions: [string, string][] }).conditions;
    expect(conditions[1]).toEqual(['${classification} === 2', "color('#b08a5a')"]);
    expect(conditions.at(-1)![0]).toBe('true');
    const glsl = shader(style);
    expect(glsl.color).toContain('metadata.classification == 6.0');
    expect(glsl.show).toContain('metadata.classification == 2.0');
    expect(glsl.show).not.toContain('== 9.0');
  });
  it('the height expression gives the ellipsoidal height from ECEF', () => {
    const { expression, normal, offset } = heightExpression(centre.lat, centre.lng);
    const h = (lng: number, lat: number, height: number) =>
      Cartesian3.dot(Cartesian3.fromDegrees(lng, lat, height), new Cartesian3(...normal)) - offset;
    expect(h(centre.lng, centre.lat, 753.6)).toBeCloseTo(753.6, 3);
    // 500 m away the error is the Earth's curvature, d²/2R: about 2 cm.
    expect(Math.abs(h(centre.lng + 0.006, centre.lat, 753.6) - 753.6)).toBeLessThan(0.03);
    expect(expression).toMatch(/^dot\(\$\{POSITION_ABSOLUTE\}, vec3\(/);
    // Lowering the tileset by `shift` along the normal is compensated in the offset.
    const shifted = heightExpression(centre.lat, centre.lng, 700);
    expect(shifted.offset).toBeCloseTo(offset - 700, 6);
  });
  it('the height ramp spans the layer range and compiles', () => {
    const style = buildPointCloudStyle({
      mode: 'height',
      classes: { ...ALL_CLASS_GROUPS },
      center: centre,
      range: { min: 750, max: 768 },
      shift: 750,
    });
    expect(style.defines!.h).toContain('POSITION_ABSOLUTE');
    const conditions = (style.color as { conditions: [string, string][] }).conditions;
    expect(conditions).toHaveLength(HEIGHT_RAMP.length);
    expect(conditions[0]).toEqual(['${h} < 752.00', `color('${HEIGHT_RAMP[0]}')`]);
    expect(shader(style).color).toContain('v_positionWC');
    // Without a centre or range there is no ramp: the stored colours stay.
    expect(buildPointCloudStyle({ mode: 'height', classes: { ...ALL_CLASS_GROUPS } })).toEqual({});
  });
  it('ramp bounds, ellipsoidal ranges and the globe shift', () => {
    expect(rampBounds(0, 9, 3)).toEqual([3, 6]);
    expect(rampBounds(5, 5, 2)[0]).toBeCloseTo(5.005, 6);
    const layer = {
      height_range_m: { min: 698.5, max: 710.09 },
      vertical: {
        datum: 'orthometric' as const,
        override_m: null,
        geoid_offset_m: 53.106,
        method: 'egm08_rednap_grid' as const,
      },
    };
    expect(ellipsoidalRange(layer)).toEqual({ min: 698.5 + 53.106, max: 710.09 + 53.106 });
    expect(
      ellipsoidalRange({ ...layer, vertical: { ...layer.vertical, datum: 'ellipsoidal' } }),
    ).toEqual({ min: 698.5, max: 710.09 });
    expect(ellipsoidalRange({ ...layer, height_range_m: null })).toBeUndefined();
    expect(globeShift({ min: 751.6 }, false)).toBe(751.6);
    expect(globeShift({ min: 751.6 }, true)).toBe(0);
    expect(globeShift(undefined, false)).toBe(0);
  });
  it('shading attenuates up to the chosen point size with eye-dome lighting', () => {
    expect(shadingFor(3)).toMatchObject({
      attenuation: true,
      maximumAttenuation: 3,
      eyeDomeLighting: true,
    });
    expect(shadingFor(3, 0.45).baseResolution).toBe(0.45);
    expect(shadingFor(0).maximumAttenuation).toBe(1);
    expect(shadingFor(40).maximumAttenuation).toBe(8);
  });
});

describe('Point spacing', () => {
  it('estimates the spacing from the footprint and the count', () => {
    // A 1 x 1 km PNOA cob3 tile at Laguna de Duero with 5 pts/m².
    const tile = {
      bbox: [-4.72752, 41.57472, -4.71529, 41.5839] as [number, number, number, number],
      point_count: 5_000_000,
    };
    // The bbox of a UTM square is a little larger than the square itself (about 3 % here).
    expect(Math.abs(pointSpacing(tile)! / Math.sqrt(1 / 5) - 1)).toBeLessThan(0.03);
    // The SYNTHETIC fixture: 5,540 points over 120 x 120 m.
    expect(
      pointSpacing({ bbox: [-4.72, 41.5824, -4.71856, 41.58348], point_count: 5540 }),
    ).toBeCloseTo(1.61, 1);
    expect(pointSpacing({ bbox: null, point_count: 10 })).toBeUndefined();
    expect(pointSpacing({ bbox: [0, 0, 1, 1], point_count: null })).toBeUndefined();
  });
});

describe('Upload checks', () => {
  it('accepts LAS and LAZ within the limit with readable messages otherwise', () => {
    expect(validateFile({ name: 'PNOA_2023_CYL_356-4604_ORT-CLA-RGB.laz', size: 5e7 }, 15e7)).toBe(
      '',
    );
    expect(validateFile({ name: 'nube.LAS', size: 10 })).toBe('');
    expect(validateFile({ name: 'nube.e57', size: 10 })).toMatch(/no es un fichero .las o .laz/);
    expect(validateFile({ name: 'nube.laz', size: 0 })).toMatch(/vacío/);
    expect(validateFile({ name: 'grande.laz', size: 2e8 }, 157286400)).toBe(
      '«grande.laz» ocupa 190,7 MiB y el límite es 150 MiB.',
    );
    expect(mebibytes(56123)).toBe('0,1 MiB');
  });
});
