import { describe, it, expect } from 'vitest';
import { dragRotation, zoomDistance, radPerPx, RAD_PER_PX, MIN_DISTANCE, MAX_DISTANCE } from '../src/view.js';

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

describe('画面の大きさに合わせた回る速さ', () => {
  it('短い辺を端から端までなぞると半回転する（縦でも横でも）', () => {
    expect(dragRotation(390, 0, radPerPx(390, 844)).angle).toBeCloseTo(Math.PI);
    expect(dragRotation(0, 430, radPerPx(932, 430)).angle).toBeCloseTo(Math.PI);
  });
  it('小さい画面でも短い辺 320 より速くは回らない', () => {
    expect(radPerPx(280, 500)).toBeCloseTo(Math.PI / 320);
  });
  it('大きさが分からなければ既定の速さ', () => {
    expect(radPerPx(0, 0)).toBe(RAD_PER_PX);
    expect(radPerPx(NaN, 800)).toBe(RAD_PER_PX);
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
