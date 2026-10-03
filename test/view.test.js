import { describe, it, expect } from 'vitest';
import { dragRotation, zoomDistance, RAD_PER_PX, MIN_DISTANCE, MAX_DISTANCE } from '../src/view.js';

describe('ドラッグから回転', () => {
  it('右へのドラッグは縦軸（+Y）まわりに回す', () => {
    const r = dragRotation(100, 0);
    expect(r.axis).toEqual([0, 1, 0]);
    expect(r.angle).toBeCloseTo(100 * RAD_PER_PX);
  });

  it('下へのドラッグは横軸（+X）まわりに回す', () => {
    expect(dragRotation(0, 50).axis).toEqual([1, 0, 0]);
  });

  it('斜めのドラッグは単位ベクトルの軸と長さに比例した角度', () => {
    const r = dragRotation(30, 40, 0.02);
    expect(r.axis[0]).toBeCloseTo(0.8);
    expect(r.axis[1]).toBeCloseTo(0.6);
    expect(r.angle).toBeCloseTo(1);
  });

  it('動いていなければ回さない', () => {
    expect(dragRotation(0, 0).angle).toBe(0);
  });
});

describe('ピンチで寄り引き', () => {
  it('指が広がると近づく', () => {
    expect(zoomDistance(8, 2)).toBe(MIN_DISTANCE);
    expect(zoomDistance(8, 1.25)).toBeCloseTo(6.4);
  });
  it('指が狭まると離れる。範囲の外には出ない', () => {
    expect(zoomDistance(8, 0.8)).toBeCloseTo(10);
    expect(zoomDistance(8, 0.1)).toBe(MAX_DISTANCE);
  });
  it('おかしな比は無視する', () => {
    expect(zoomDistance(8, 0)).toBe(8);
    expect(zoomDistance(8, NaN)).toBe(8);
  });
});
