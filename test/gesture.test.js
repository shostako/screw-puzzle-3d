import { describe, it, expect } from 'vitest';
import { createGesture, TAP_MAX_MOVE, TAP_MAX_MS, AIM_MAX_MOVE } from '../src/gesture.js';

const types = (events) => events.map((e) => e.type);

describe('タップとドラッグの区別', () => {
  it('動かさずにすぐ離せばタップ', () => {
    const g = createGesture();
    g.down(1, 100, 100, 0);
    expect(g.up(1, 100, 100, 120)).toEqual([{ type: 'tap', x: 100, y: 100 }]);
  });

  it('しきい値以内の小さなぶれはタップのまま、回さない', () => {
    const g = createGesture();
    g.down(1, 100, 100, 0);
    expect(g.move(1, 100 + TAP_MAX_MOVE, 100, 50)).toEqual([]);
    expect(types(g.up(1, 100 + TAP_MAX_MOVE, 100, 100))).toEqual(['tap']);
  });

  it('しきい値を超えて動けばドラッグになり、離してもタップにならない', () => {
    const g = createGesture();
    g.down(1, 100, 100, 0);
    expect(g.move(1, 100 + TAP_MAX_MOVE + 1, 100, 50)).toEqual([
      { type: 'rotate', dx: TAP_MAX_MOVE + 1, dy: 0 },
    ]);
    expect(g.up(1, 100 + TAP_MAX_MOVE + 1, 100, 100)).toEqual([]);
  });

  it('しきい値は斜めの距離で測る', () => {
    const g = createGesture();
    g.down(1, 0, 0, 0);
    expect(g.move(1, 8, 8, 30)).toHaveLength(1); // 約 11.3px
  });

  it('ドラッグ後に元の位置へ戻して離してもタップにならない', () => {
    const g = createGesture();
    g.down(1, 100, 100, 0);
    g.move(1, 150, 100, 50);
    g.move(1, 100, 100, 100);
    expect(g.up(1, 100, 100, 150)).toEqual([]);
  });

  it('ドラッグ中は前回からの移動量を回す量として返す', () => {
    const g = createGesture();
    g.down(1, 0, 0, 0);
    g.move(1, 20, 0, 10);
    expect(g.move(1, 25, -3, 20)).toEqual([{ type: 'rotate', dx: 5, dy: -3 }]);
  });

  it('長く押してから離すとタップにならない', () => {
    const g = createGesture();
    g.down(1, 100, 100, 0);
    expect(g.up(1, 100, 100, TAP_MAX_MS + 1)).toEqual([]);
  });

  it('時間はしきい値ちょうどまでタップ', () => {
    const g = createGesture();
    g.down(1, 100, 100, 0);
    expect(types(g.up(1, 100, 100, TAP_MAX_MS))).toEqual(['tap']);
  });

  it('しきい値は引数で変えられる', () => {
    const g = createGesture({ tapMaxMove: 2, tapMaxMs: 50 });
    g.down(1, 0, 0, 0);
    expect(g.move(1, 3, 0, 10)).toHaveLength(1);
    const h = createGesture({ tapMaxMove: 2, tapMaxMs: 50 });
    h.down(1, 0, 0, 0);
    expect(h.up(1, 0, 0, 60)).toEqual([]);
  });

  it('取り消された指はタップにならない', () => {
    const g = createGesture();
    g.down(1, 100, 100, 0);
    g.cancel(1);
    expect(g.up(1, 100, 100, 50)).toEqual([]);
    expect(g.activePointers).toBe(0);
  });

  it('操作が終われば次の操作は新しく判定する', () => {
    const g = createGesture();
    g.down(1, 0, 0, 0);
    g.move(1, 50, 0, 10);
    g.up(1, 50, 0, 20);
    g.down(2, 10, 10, 1000);
    expect(types(g.up(2, 10, 10, 1100))).toEqual(['tap']);
  });
});

describe('2本指', () => {
  it('2本指の間隔の変化を拡大率として返す', () => {
    const g = createGesture();
    g.down(1, 100, 100, 0);
    g.down(2, 200, 100, 10);
    expect(g.move(2, 300, 100, 20)).toEqual([{ type: 'zoom', scale: 2 }]);
    expect(g.move(1, 200, 100, 30)).toEqual([{ type: 'zoom', scale: 0.5 }]);
  });

  it('ピンチ中は回さない', () => {
    const g = createGesture();
    g.down(1, 100, 100, 0);
    g.down(2, 200, 100, 10);
    const events = g.move(1, 150, 150, 20);
    expect(types(events)).not.toContain('rotate');
  });

  it('2本指で触れてすぐ離してもタップにならない', () => {
    const g = createGesture();
    g.down(1, 100, 100, 0);
    g.down(2, 110, 100, 10);
    expect(g.up(2, 110, 100, 50)).toEqual([]);
    expect(g.up(1, 100, 100, 60)).toEqual([]);
  });

  it('ピンチの後に残った1本で回せるが、離してもタップにならない', () => {
    const g = createGesture();
    g.down(1, 100, 100, 0);
    g.down(2, 200, 100, 10);
    g.up(2, 200, 100, 50);
    expect(g.move(1, 103, 100, 60)).toEqual([{ type: 'rotate', dx: 3, dy: 0 }]);
    expect(g.up(1, 103, 100, 70)).toEqual([]);
  });
});

describe('ねじの上に置いた指（F1）', () => {
  it('ねじの上で長く押してから離してもタップ（沈んだねじが外れずに戻らない）', () => {
    const g = createGesture();
    g.down(1, 100, 100, 0);
    g.aim();
    expect(types(g.up(1, 100, 100, 1500))).toEqual(['tap']);
  });

  it('ねじの上では指の腹のぶれを広めに許し、回さない', () => {
    const g = createGesture();
    g.down(1, 100, 100, 0);
    g.aim();
    expect(AIM_MAX_MOVE).toBeGreaterThan(TAP_MAX_MOVE);
    expect(g.move(1, 100 + AIM_MAX_MOVE, 100, 200)).toEqual([]);
    expect(types(g.up(1, 100 + AIM_MAX_MOVE, 100, 600))).toEqual(['tap']);
  });

  it('ねじの上からでも、はっきり動かせば回す。離してもタップにならない', () => {
    const g = createGesture();
    g.down(1, 100, 100, 0);
    g.aim();
    expect(g.move(1, 100 + AIM_MAX_MOVE + 1, 100, 50)).toEqual([{ type: 'rotate', dx: AIM_MAX_MOVE + 1, dy: 0 }]);
    expect(g.up(1, 100, 100, 100)).toEqual([]);
  });

  it('2本目の指が来たらタップにならない', () => {
    const g = createGesture();
    g.down(1, 100, 100, 0);
    g.aim();
    g.down(2, 200, 100, 20);
    g.up(2, 200, 100, 40);
    expect(g.up(1, 100, 100, 60)).toEqual([]);
  });

  it('次の操作には持ち越さない（何も無い所の長押しはタップにならない）', () => {
    const g = createGesture();
    g.down(1, 100, 100, 0);
    g.aim();
    g.up(1, 100, 100, 100);
    g.down(1, 100, 100, 1000);
    expect(g.up(1, 100, 100, 1000 + TAP_MAX_MS + 1)).toEqual([]);
  });

  it('動かし始めた後の aim() は効かない', () => {
    const g = createGesture();
    g.down(1, 100, 100, 0);
    g.move(1, 130, 100, 30);
    g.aim();
    g.move(1, 100, 100, 60);
    expect(g.up(1, 100, 100, 90)).toEqual([]);
  });
});
