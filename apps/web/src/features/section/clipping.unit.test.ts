import { describe, expect, it } from 'vitest';
import { Cartesian3, Cartesian4, Cartographic, Matrix4, Math as CesiumMath, Plane } from 'cesium';
import { clippingPlanesMatrix, lineFrame, ringPositions, slabPlanes } from './clipping';
import { cutPlanes, cutRings, fromLine, isClipped, makeLine } from './section-math';

const A = { lng: -4.7231281, lat: 41.5901638 },
  B = { lng: -4.726941, lat: 41.5891789 };
const line = makeLine(A, B);
/** A point of the line's frame (s along A→B, d to its left, z up) in ECEF. */
const world = (s: number, d: number, z: number) =>
  Matrix4.multiplyByPoint(lineFrame(line), new Cartesian3(s, d, z), new Cartesian3());

describe('the line frame', () => {
  it('puts x along A→B, y to its left and z up, from A on the ellipsoid', () => {
    const atB = Cartographic.fromCartesian(world(line.length, 0, 0));
    expect(CesiumMath.toDegrees(atB.longitude)).toBeCloseTo(B.lng, 6);
    expect(CesiumMath.toDegrees(atB.latitude)).toBeCloseTo(B.lat, 6);
    const left = Cartographic.fromCartesian(world(100, 20, 0));
    const expected = fromLine(line, 100, 20);
    expect(CesiumMath.toDegrees(left.longitude)).toBeCloseTo(expected.lng, 6);
    expect(CesiumMath.toDegrees(left.latitude)).toBeCloseTo(expected.lat, 6);
    expect(Cartographic.fromCartesian(world(0, 0, 50)).height).toBeCloseTo(50, 3);
  });

  it('turns rings of (s, d) into positions on the ellipsoid', () => {
    const [first] = ringPositions(line, cutRings(line.length, 1.5, 1, 300).front);
    expect(Cartesian3.distance(first!, world(0, 1.5, 0))).toBeLessThan(0.01);
  });
});

describe('the WebGL 1 fallback', () => {
  it('reads the planes in the line frame whatever the tileset’s private origin', () => {
    // The origin Cesium keeps for a tileset's clipping planes: an east-north-up frame somewhere
    // near the cloud.
    const origin = Matrix4.multiply(
      Matrix4.fromTranslation(new Cartesian3(120, -40, 15)),
      lineFrame(makeLine({ lng: -4.725, lat: 41.589 }, { lng: -4.724, lat: 41.5895 })),
      new Matrix4(),
    );
    const tileset = { clippingPlanesOriginMatrix: origin, boundingSphere: undefined } as never;
    const model = clippingPlanesMatrix(tileset, lineFrame(line));
    const effective = Matrix4.multiply(origin, model, new Matrix4());
    expect(Matrix4.equalsEpsilon(effective, lineFrame(line), 1e-6)).toBe(true);
    // A world point in front of the line, through those matrices, is clipped by the planes.
    const set = cutPlanes('front', line.length, 1.5, 1, 300);
    const local = Matrix4.multiplyByPoint(
      Matrix4.inverse(effective, new Matrix4()),
      world(150, 30, 20),
      new Cartesian3(),
    );
    expect(isClipped(set, [local.x, local.y, local.z])).toBe(true);
    const behind = Matrix4.multiplyByPoint(
      Matrix4.inverse(effective, new Matrix4()),
      world(150, -30, 20),
      new Cartesian3(),
    );
    expect(isClipped(set, [behind.x, behind.y, behind.z])).toBe(false);
  });

  it('falls back to the frame itself when the origin is not there', () => {
    const model = clippingPlanesMatrix({} as never, lineFrame(line));
    expect(Matrix4.equals(model, lineFrame(line))).toBe(true);
  });
});

describe('the dimming planes', () => {
  it('measure the distance across the slab and along the line, also in eye space', () => {
    const planes = slabPlanes(line);
    const p = world(120, 0.8, 35);
    expect(Plane.getPointDistance(planes.across, p)).toBeCloseTo(0.8, 3);
    expect(Plane.getPointDistance(planes.along, p)).toBeCloseTo(120, 3);
    // Any view matrix (a camera somewhere) keeps the distances.
    const view = Matrix4.inverse(
      Matrix4.multiply(
        lineFrame(line),
        Matrix4.fromTranslation(new Cartesian3(50, 400, 300)),
        new Matrix4(),
      ),
      new Matrix4(),
    );
    const eye = Matrix4.multiplyByPoint(view, p, new Cartesian3());
    const across = Plane.transform(planes.across, view, new Plane(Cartesian3.UNIT_Z, 0));
    const v = new Cartesian4(across.normal.x, across.normal.y, across.normal.z, across.distance);
    expect(Cartesian3.dot(across.normal, eye) + v.w).toBeCloseTo(0.8, 3);
  });
});
