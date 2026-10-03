import { describe, it, expect } from 'vitest';
import { sweepHits, blockerFor, coverMap, validateBoard, SCREW_RADIUS } from '../src/board.js';
import { newGame, removeScrew, checkRemove } from '../src/rules.js';

const UP = [-Math.PI / 2, 0, 0];   // 法線が +y の水平な板
const R = SCREW_RADIUS;            // 0.3

// 床の板 A（y = 0 が上面）の真ん中に上向きのねじ x。その上に板を1枚置いて、隠れるかを調べる
function scene(over, extra = {}) {
  return {
    plates: [
      { id: 'A', size: [6, 6], thickness: 0.2, position: [0, -0.1, 0], rotation: UP },
      { id: 'C', thickness: 0.2, ...over },
    ],
    screws: [{ id: 'x', plate: 'A', color: 'red', position: [0, 0, 0], dir: [0, 1, 0], ...extra }],
    queue: [],
  };
}
const hidden = over => sweepHits(scene(over), 'x').includes('C');

describe('隠れ判定', () => {
  it('真上が塞がれていれば隠れている（高さによらない）', () => {
    expect(hidden({ size: [2, 2], position: [0, 1, 0], rotation: UP })).toBe(true);
    expect(hidden({ size: [2, 2], position: [0, 40, 0], rotation: UP })).toBe(true);
  });

  it('真上でも、ねじより下（抜ける向きの反対）にある板は数えない', () => {
    expect(hidden({ size: [2, 2], position: [0, -3, 0], rotation: UP })).toBe(false);
  });

  it('横にずれて重ならなければ見えている', () => {
    expect(hidden({ size: [2, 2], position: [1.5, 1, 0], rotation: UP })).toBe(false);   // 端が x = 0.5
  });

  it('ねじ頭の縁に少しだけ（0.02）かかれば隠れている', () => {
    expect(hidden({ size: [2, 2], position: [1 + R - 0.02, 1, 0], rotation: UP })).toBe(true);
    expect(hidden({ size: [2, 2], position: [1 + R + 0.02, 1, 0], rotation: UP })).toBe(false);
  });

  it('縁に触れているだけ（重なりの幅 0）は隠れていない', () => {
    expect(hidden({ size: [2, 2], position: [1 + R, 1, 0], rotation: UP })).toBe(false);
  });

  it('斜めの向きの角が、丸い頭に少しだけかかれば隠れている（四角で見積もると間違える位置）', () => {
    // 板の角 (a, a) が頭の中心から a√2。a = 0.2 なら 0.283 < 0.3 で重なり、a = 0.22 なら 0.311 で重ならない
    // （頭を 0.6 角の四角とみなすと、どちらも重なると誤る）
    expect(hidden({ size: [2, 2], position: [1.2, 1, 1.2], rotation: UP })).toBe(true);
    expect(hidden({ size: [2, 2], position: [1.22, 1, 1.22], rotation: UP })).toBe(false);
  });

  it('傾いた板が斜めに少しだけ重なれば隠れている', () => {
    // x 軸のまわりに 45° 傾けた 2 角・厚み 0.2 の板。真上から見た z の幅は ±(1 + 0.1)·cos45° ≒ ±0.778
    const tilt = z => ({ size: [2, 2], position: [0, 2, z], rotation: [-Math.PI / 4, 0, 0] });
    expect(hidden(tilt(1.05))).toBe(true);    // 0.778 + 0.3 = 1.078 より近い
    expect(hidden(tilt(1.11))).toBe(false);
  });

  it('向きが斜めのねじも、その向きに掃いて調べる', () => {
    const d = [Math.SQRT1_2, Math.SQRT1_2, 0];   // 右上 45°
    const lv = {
      plates: [
        { id: 'A', size: [2, 2], thickness: 0.2, position: [0, 0, 0], rotation: [0, 0, 0] },
        { id: 'C', size: [1, 1], thickness: 0.2, position: [3, 3, 0], rotation: UP },   // 右上の先
        { id: 'D', size: [1, 1], thickness: 0.2, position: [0, 3, 0], rotation: UP },   // 真上（向きから外れる）
      ],
      screws: [{ id: 'x', plate: 'A', color: 'red', position: [0, 0, 0.1], dir: d }],
      queue: [],
    };
    expect(sweepHits(lv, 'x')).toEqual(['C']);
  });

  it('自分の留めている板は数えない（頭が板に少し沈んでいても）', () => {
    const lv = scene({ size: [2, 2], position: [5, 5, 5], rotation: UP }, { position: [0, -0.05, 0] });
    expect(sweepHits(lv, 'x')).toEqual([]);
    // 同じ所にある別の板なら数える
    lv.plates.push({ id: 'A2', size: [6, 6], thickness: 0.2, position: [0, -0.1, 0], rotation: UP });
    expect(sweepHits(lv, 'x')).toEqual(['A2']);
  });

  it('頭の半径はねじごとに変えられる', () => {
    const over = { size: [2, 2], position: [1.4, 1, 0], rotation: UP };   // 端が x = 0.4
    expect(sweepHits(scene(over), 'x')).toEqual([]);
    expect(sweepHits(scene(over, { radius: 0.5 }), 'x')).toEqual(['C']);
  });

  it('凸多角形の板も調べられる', () => {
    // 真上から見て、斜辺が x + z = c の三角形（頭の中心から斜辺まで c/√2）。局所 y は世界の -z
    const tri = c => ({ outline: [[c, 0], [0, -c], [c + 3, -(c + 3)]], position: [0, 1, 0], rotation: UP });
    expect(hidden(tri(0.40))).toBe(true);    // 0.283 < 0.3
    expect(hidden(tri(0.45))).toBe(false);   // 0.318
  });

  it('板が動いた姿勢を渡すと、その姿勢で調べる（ねじも自分の板と一緒に動く）', () => {
    const lv = scene({ size: [2, 2], position: [3, 1, 0], rotation: UP });
    expect(sweepHits(lv, 'x')).toEqual([]);
    // C が真上へ動けば隠れる
    expect(sweepHits(lv, 'x', { poses: { C: { position: [0, 1, 0], rotation: UP } } })).toEqual(['C']);
    // 床 A が x へ 3 動けば、ねじも一緒に C の真下へ来る
    expect(sweepHits(lv, 'x', { poses: { A: { position: [3, -0.1, 0], rotation: UP } } })).toEqual(['C']);
    // 床 A を z 軸のまわりに 90° 回すと、ねじは -x を向き（四元数で渡す）、C から外れる
    // 床 A を z 軸のまわりに 90° 回すと、ねじは -x を向く（姿勢は四元数で渡す）。C が -x の先にあれば隠れる
    const q = [-0.5, -0.5, 0.5, 0.5];   // Rz(90°)·Rx(-90°)
    const turned = { position: [-0.1, 0, 0], quaternion: q };
    expect(sweepHits(lv, 'x', { poses: { A: turned } })).toEqual([]);
    expect(sweepHits(lv, 'x', { poses: { A: turned, C: { position: [-3, 0, 0], rotation: [0, Math.PI / 2, 0] } } })).toEqual(['C']);
  });
});

describe('ルールにつなぐ', () => {
  // 床 A（ねじ3本）の上に、蓋 C（ねじ3本）が x だけを隠している
  const lv = {
    plates: [
      { id: 'A', size: [6, 6], thickness: 0.2, position: [0, -0.1, 0], rotation: UP },
      { id: 'C', size: [2, 2], thickness: 0.2, position: [0, 1.1, 0], rotation: UP },
    ],
    screws: [
      { id: 'x', plate: 'A', color: 'red', position: [0, 0, 0], dir: [0, 1, 0] },
      { id: 'y', plate: 'A', color: 'red', position: [2, 0, 2], dir: [0, 1, 0] },
      { id: 'z', plate: 'A', color: 'red', position: [-2, 0, 2], dir: [0, 1, 0] },
      { id: 'c1', plate: 'C', color: 'blue', position: [0.5, 1.2, 0.5], dir: [0, 1, 0] },
      { id: 'c2', plate: 'C', color: 'blue', position: [-0.5, 1.2, 0.5], dir: [0, 1, 0] },
      { id: 'c3', plate: 'C', color: 'blue', position: [0, 1.2, -0.5], dir: [0, 1, 0] },
    ],
    queue: ['red', 'blue'],
  };

  it('隠している板の一覧を盤面ごとに1回作る', () => {
    expect(coverMap(lv)).toEqual({ x: ['C'], y: [], z: [], c1: [], c2: [], c3: [] });
    expect(coverMap(lv)).toBe(coverMap(lv));
  });

  it('隠している板がぶら下がっている間は隠れたまま、落ちたら外せる', () => {
    validateBoard(lv);
    const blocked = blockerFor(lv);
    let st = newGame(lv);
    expect(checkRemove(st, 'x', blocked)).toBe('blocked');
    st = removeScrew(st, 'c1', blocked).state;
    st = removeScrew(st, 'c2', blocked).state;
    expect(checkRemove(st, 'x', blocked)).toBe('blocked');   // C は1本でぶら下がり
    st = removeScrew(st, 'c3', blocked).state;
    expect(checkRemove(st, 'x', blocked)).toBe('ok');
  });
});

describe('盤面の形の検査', () => {
  const base = () => scene({ size: [2, 2], position: [5, 5, 5], rotation: UP });
  it('正しい盤面は通る', () => {
    expect(() => validateBoard(base())).not.toThrow();
  });
  it('ねじが板の表面に無い、向きが法線でない、輪郭の外、は受け付けない', () => {
    const off = base(); off.screws[0].position = [0, 0.3, 0];
    expect(() => validateBoard(off)).toThrow(/表面/);
    const tilt = base(); tilt.screws[0].dir = [0, Math.SQRT1_2, Math.SQRT1_2];
    expect(() => validateBoard(tilt)).toThrow(/法線/);
    const inward = base(); inward.screws[0].dir = [0, -1, 0];
    expect(() => validateBoard(inward)).toThrow(/法線/);
    const out = base(); out.screws[0].position = [3.5, 0, 0];
    expect(() => validateBoard(out)).toThrow(/輪郭/);
  });
  it('凸でない輪郭、厚みの無い板は受け付けない', () => {
    const concave = base(); concave.plates[1] = { ...concave.plates[1], outline: [[0, 0], [2, 0], [1, 0.5], [2, 2], [0, 2]] };
    expect(() => validateBoard(concave)).toThrow(/凸/);
    const flat = base(); flat.plates[1].thickness = 0;
    expect(() => validateBoard(flat)).toThrow(/厚み/);
  });
});
