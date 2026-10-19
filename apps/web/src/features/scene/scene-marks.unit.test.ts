import { describe, expect, it } from 'vitest';
import { addSceneMarks, boxesAlong, sceneMarks } from './scene-marks';

describe('What the tools draw, as obstacles for the labels', () => {
  it('gives the boxes of every registered source until it is removed', () => {
    const box = { left: 0, right: 8, top: 0, bottom: 8 };
    const remove = addSceneMarks(() => [box]);
    expect(sceneMarks()).toEqual([box]);
    remove();
    expect(sceneMarks()).toEqual([]);
  });

  it('follows a line on screen with a small box every few pixels', () => {
    const boxes = boxesAlong([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 16 },
    ]);
    // 0, 8, … 40 along the first segment, then 48 and 56 px along the path.
    expect(boxes.map((b) => [(b.left + b.right) / 2, (b.top + b.bottom) / 2])).toEqual([
      [0, 0],
      [8, 0],
      [16, 0],
      [24, 0],
      [32, 0],
      [40, 0],
      [40, 8],
      [40, 16],
    ]);
    expect(boxes[0]).toEqual({ left: -3, right: 3, top: -3, bottom: 3 });
  });

  it('leaves out segments with a point that does not project', () => {
    expect(boxesAlong([{ x: 0, y: 0 }, null, { x: 10, y: 0 }])).toEqual([]);
    expect(
      boxesAlong([
        { x: 0, y: 0 },
        { x: 1e6, y: 0 },
      ]),
    ).toEqual([]);
  });
});
