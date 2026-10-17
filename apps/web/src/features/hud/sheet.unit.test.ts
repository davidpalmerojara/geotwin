import { describe, expect, it } from 'vitest';
import {
  isModal,
  nearestSnap,
  releaseSnap,
  sheetTop,
  snapForKey,
  snapOfTop,
  stepSnap,
  trapTarget,
} from './sheet';

const ASSET = [25, 45, 90] as const;
const H = 844;

describe('phone bottom sheets', () => {
  it('place the top edge from the bottom of the screen', () => {
    expect(sheetTop(45, H)).toBe(464);
    expect(sheetTop(25, H)).toBe(633);
    expect(sheetTop(90, H)).toBe(84);
    expect(snapOfTop(464, H)).toBeCloseTo(45, 0);
  });
  it('step between snaps and stay at the ends', () => {
    expect(stepSnap(ASSET, 45, 1)).toBe(90);
    expect(stepSnap(ASSET, 45, -1)).toBe(25);
    expect(stepSnap(ASSET, 90, 1)).toBe(90);
    expect(stepSnap(ASSET, 25, -1)).toBe(25);
    // A value between snaps goes to the nearest one.
    expect(stepSnap(ASSET, 60, 1)).toBe(45);
    expect(nearestSnap(ASSET, 70)).toBe(90);
  });
  it('rest a slow drag at the nearest snap', () => {
    expect(releaseSnap(ASSET, 45, sheetTop(52, H), H)).toBe(45);
    expect(releaseSnap(ASSET, 45, sheetTop(75, H), H)).toBe(90);
    expect(releaseSnap(ASSET, 45, sheetTop(30, H), H)).toBe(25);
  });
  it('move a flick one snap in its direction', () => {
    expect(releaseSnap(ASSET, 45, sheetTop(48, H), H, -0.9)).toBe(90);
    expect(releaseSnap(ASSET, 45, sheetTop(43, H), H, 0.9)).toBe(25);
    // At the top a flick up stays there.
    expect(releaseSnap(ASSET, 90, sheetTop(88, H), H, -1)).toBe(90);
  });
  it('close when pulled well below the lowest snap, unless the sheet cannot close', () => {
    expect(releaseSnap(ASSET, 25, sheetTop(12, H), H)).toBeNull();
    expect(releaseSnap(ASSET, 25, sheetTop(22, H), H, 0.8)).toBeNull();
    expect(releaseSnap(ASSET, 25, sheetTop(22, H), H)).toBe(25);
    expect(releaseSnap(ASSET, 25, sheetTop(5, H), H, 0, false)).toBe(25);
  });
  it('answer the handle keys', () => {
    expect(snapForKey(ASSET, 45, 'ArrowUp')).toBe(90);
    expect(snapForKey(ASSET, 45, 'ArrowDown')).toBe(25);
    expect(snapForKey(ASSET, 45, 'Home')).toBe(25);
    expect(snapForKey(ASSET, 25, 'End')).toBe(90);
    expect(snapForKey(ASSET, 45, 'Enter')).toBeNull();
  });
  it('are modal only at 90 %', () => {
    expect(isModal(90)).toBe(true);
    expect(isModal(45)).toBe(false);
    expect(isModal(25)).toBe(false);
  });
  it('keep Tab inside a modal sheet', () => {
    const items = ['a', 'b', 'c'];
    expect(trapTarget(items, 'c', false)).toBe('a');
    expect(trapTarget(items, 'a', true)).toBe('c');
    expect(trapTarget(items, 'b', false)).toBeNull();
    expect(trapTarget(items, 'b', true)).toBeNull();
    // Focus outside the sheet comes back in.
    expect(trapTarget(items, 'x', false)).toBe('a');
    expect(trapTarget(items, null, true)).toBe('c');
    expect(trapTarget([], 'a', false)).toBeNull();
  });
});
