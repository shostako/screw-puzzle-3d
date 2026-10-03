import { describe, it, expect } from 'vitest';
import { createSafeModel, safeBlocker } from '../src/safe.js';
import { blockerFor, insetOutline } from '../src/board.js';
import { newGame, removeScrew, legalMoves, checkRemove } from '../src/rules.js';
import { solve } from '../src/solve.js';
import { BOX_LEVEL } from '../src/levels/box.js';

const T = 0.3;
const UP = [-Math.PI / 2, 0, 0];
const SIDE = [0, Math.PI / 2, 0];

// ルールで1本ずつ外す（外せなければ失敗）
function play(level, ids, isBlocked) {
  let st = newGame(level);
  for (const id of ids) {
    const r = removeScrew(st, id, isBlocked);
    expect(r.ok, `${id}: ${r.reason}`).toBe(true);
    st = r.state;
  }
  return st;
}

// 縦の板 W（法線 +z、横 4 × 縦 2）をねじ a（左）・b（右）・c で留める。その右下の奥に、W と平行な板 G。
// G のねじ g は手前（+z）向きで、抜く道は W の面を通る。W が a でぶら下がると、右端が回って g の前を通る
const swing = () => ({
  plates: [
    { id: 'W', size: [4, 2], thickness: T, position: [0, 0, 0], rotation: [0, 0, 0] },
    { id: 'G', size: [3, 2], thickness: T, position: [1.5, -2.5, -1], rotation: [0, 0, 0] },
  ],
  screws: [
    { id: 'a', plate: 'W', color: 'red', position: [-1.5, 0, T / 2], dir: [0, 0, 1] },
    { id: 'b', plate: 'W', color: 'red', position: [1.5, 0, T / 2], dir: [0, 0, 1] },
    { id: 'c', plate: 'W', color: 'red', position: [0, 0.5, T / 2], dir: [0, 0, 1] },
    { id: 'g', plate: 'G', color: 'blue', position: [1, -2.5, -1 + T / 2], dir: [0, 0, 1] },
    { id: 'h', plate: 'G', color: 'blue', position: [2.4, -2, -1 + T / 2], dir: [0, 0, 1] },
    { id: 'i', plate: 'G', color: 'blue', position: [2.4, -3, -1 + T / 2], dir: [0, 0, 1] },
  ],
  queue: ['red', 'blue'],
});

describe('安全側の見積もり: ぶら下がった板', () => {
  it('固定の間は置いた形だけ、ぶら下がると回って届く範囲全部で隠す', () => {
    const level = swing();
    const safe = safeBlocker(level);
    let st = play(level, ['b'], safe);
    expect(checkRemove(st, 'g', safe)).toBe('ok');   // W はまだ固定（2本）で、g の前には無い
    st = play(level, ['b', 'c'], safe);
    // W が a でぶら下がると、回った W が g の前に来うる。軸から遠い h には届かない
    expect(checkRemove(st, 'g', safe)).toBe('blocked');
    expect(checkRemove(st, 'h', safe)).toBe('ok');
    // 物理なしの判定（M3: ぶら下がった板は置いた形のまま）では隠れていない。見積もりの方が厳しい
    expect(checkRemove(st, 'g', blockerFor(level))).toBe('ok');
  });

  it('回る途中で固定の板に当たるなら、そこで止まる（弧が1周にならない）', () => {
    // W の右下に固定の小さな板 S（W と同じ面の中）。W は時計回りに少し回ると S に当たり、反時計回りでも回り込んで当たる
    const level = swing();
    level.plates.push({ id: 'S', size: [1, 1], thickness: T, position: [1.5, -1.6, 0], rotation: [0, 0, 0] });
    level.screws.push(
      { id: 's1', plate: 'S', color: 'green', position: [1.25, -1.6, T / 2], dir: [0, 0, 1] },
      { id: 's2', plate: 'S', color: 'green', position: [1.75, -1.85, T / 2], dir: [0, 0, 1] },
      { id: 's3', plate: 'S', color: 'green', position: [1.75, -1.35, T / 2], dir: [0, 0, 1] },
    );
    level.queue.push('green');
    const m = createSafeModel(level);
    // 板の番号: W 0、G 1、S 2。ねじ a は 0 番
    const stopped = m.arc(0, 0, 0b110);   // G と S が固定（G は W の面の外なので当たらない）
    expect(stopped.cov.length).toBeGreaterThan(1);
    expect(stopped.cov.length).toBeLessThan(24);
    // 当たる手前までは抜け出す道を調べる区間、当たる角度の先までは隠す区間
    expect(stopped.esc.length).toBeLessThanOrEqual(stopped.cov.length);
    // S が固定でなければ1周回れる
    expect(m.arc(0, 0, 0b010).cov.length).toBe(24);
  });
});

describe('安全側の見積もり: 最後のねじと抜け出す道', () => {
  // 床 G の上に小さな板 U。U の奥半分に固定の屋根 C、周りに固定の壁 X1・X2・Z1・Z2。
  // U のねじは上向きで、屋根のかかっていない手前にある（見えている）が、U は上下にも横にも抜け出せない
  const cage = () => {
    const h = (id, size, position, rotation) => ({ id, size, thickness: T, position, rotation });
    const plates = [
      h('G', [5, 5], [0, -T, 0], UP),
      h('U', [3, 3], [0, 0, 0], UP),
      h('C', [3, 1.4], [0, 0.6, -0.8], UP),
      h('X1', [3, 1.2], [-1.65, 0.3, 0], SIDE),
      h('X2', [3, 1.2], [1.65, 0.3, 0], SIDE),
      h('Z1', [3.6, 1.2], [0, 0.3, -1.65], [0, 0, 0]),
      h('Z2', [3.6, 1.2], [0, 0.3, 1.65], [0, 0, 0]),
    ];
    const sc = (id, plate, position, dir) => ({ id, plate, color: 'red', position, dir });
    const screws = [
      sc('u1', 'U', [-0.8, T / 2, 0.8], [0, 1, 0]),
      sc('u2', 'U', [0.8, T / 2, 0.8], [0, 1, 0]),
      sc('u3', 'U', [0, T / 2, 0.3], [0, 1, 0]),
      sc('c1', 'C', [-1, 0.75, -0.8], [0, 1, 0]),
      sc('c2', 'C', [1, 0.75, -0.8], [0, 1, 0]),
      sc('c3', 'C', [0, 0.75, -0.8], [0, 1, 0]),
      sc('x1', 'X1', [-1.8, 0.3, -1], [-1, 0, 0]),
      sc('x2', 'X1', [-1.8, 0.3, 1], [-1, 0, 0]),
      sc('x3', 'X2', [1.8, 0.3, -1], [1, 0, 0]),
      sc('x4', 'X2', [1.8, 0.3, 1], [1, 0, 0]),
      sc('z1', 'Z1', [-1, 0.3, -1.8], [0, 0, -1]),
      sc('z2', 'Z1', [1, 0.3, -1.8], [0, 0, -1]),
      sc('z3', 'Z2', [-1, 0.3, 1.8], [0, 0, 1]),
      sc('z4', 'Z2', [1, 0.3, 1.8], [0, 0, 1]),
      sc('g1', 'G', [-2, -1.5 * T, -2], [0, -1, 0]),
      sc('g2', 'G', [2, -1.5 * T, 2], [0, -1, 0]),
      sc('g3', 'G', [2, -1.5 * T, -2], [0, -1, 0]),
      sc('g4', 'G', [-2, -1.5 * T, 2], [0, -1, 0]),
    ];
    return { plates, screws, queue: new Array(6).fill('red') };
  };

  it('閉じ込められる板の最後のねじは外せない。屋根を外すと外せる', () => {
    const level = cage();
    const safe = safeBlocker(level);
    let st = play(level, ['u1', 'u2'], safe);
    // u3 が最後の1本。隠れてはいないが、外すと U は屋根・壁・床に囲まれて出られない
    expect(blockerFor(level)('u3', st)).toBe(false);
    expect(checkRemove(st, 'u3', safe)).toBe('blocked');
    // 屋根 C を外して落とせば、U は上へ抜け出せる
    st = play(level, ['u1', 'u2', 'c1', 'c2', 'c3'], safe);
    expect(checkRemove(st, 'u3', safe)).toBe('ok');
  });
});

describe('探索', () => {
  it('固定の箱の盤面は、安全側の見積もりでも解ける', () => {
    const safe = safeBlocker(BOX_LEVEL);
    const path = solve(BOX_LEVEL, safe, { budget: 20000 });
    expect(path).toBeTruthy();
    const st = play(BOX_LEVEL, path, safe);
    expect(st.filled).toBe(BOX_LEVEL.queue.length);
  });

  it('手順が無ければ false、打ち切れば null', () => {
    // 2枚の板が互いのねじを隠し合う（どちらも先に外せない）
    const level = {
      plates: [
        { id: 'A', size: [2, 2], thickness: T, position: [0, 0, 0], rotation: UP },
        { id: 'B', size: [2, 2], thickness: T, position: [0, 1, 0], rotation: UP },
      ],
      screws: [
        { id: 'a1', plate: 'A', color: 'red', position: [-0.5, T / 2, 0], dir: [0, 1, 0] },
        { id: 'a2', plate: 'A', color: 'red', position: [0.5, T / 2, 0], dir: [0, 1, 0] },
        { id: 'b1', plate: 'B', color: 'red', position: [0, 1 - T / 2, 0], dir: [0, -1, 0] },
      ],
      queue: ['red'],
    };
    const safe = safeBlocker(level);
    expect(legalMoves(newGame(level), safe)).toEqual([]);
    expect(solve(level, safe)).toBe(false);
    expect(solve(BOX_LEVEL, safeBlocker(BOX_LEVEL), { budget: 1 })).toBe(null);
  });
});

describe('板の輪郭を内側へ縮める', () => {
  it('細長い長方形でも、どの辺も同じ幅だけ縮む', () => {
    const r = insetOutline([[-0.5, -3], [0.5, -3], [0.5, 3], [-0.5, 3]], 0.1);
    expect(r[0][0]).toBeCloseTo(-0.4);
    expect(r[0][1]).toBeCloseTo(-2.9);
    expect(r[2][0]).toBeCloseTo(0.4);
    expect(r[2][1]).toBeCloseTo(2.9);
    // 時計回りでも同じ
    const cw = insetOutline([[-0.5, 3], [0.5, 3], [0.5, -3], [-0.5, -3]], 0.1);
    expect(cw[0][0]).toBeCloseTo(-0.4);
    expect(cw[0][1]).toBeCloseTo(2.9);
  });
});
