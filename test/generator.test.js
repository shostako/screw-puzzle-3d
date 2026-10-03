import { describe, it, expect } from 'vitest';
import { generateLevel, peelable, mulberry32, KINDS } from '../src/generator.js';
import { validateBoard, blockerFor } from '../src/board.js';
import { safeBlocker } from '../src/safe.js';
import { newGame, removeScrew, status, BOX_SIZE } from '../src/rules.js';

const SEEDS = Array.from({ length: 100 }, (_, i) => i + 1);

// 手順をルールで1手ずつ再生し、最後の状態を返す（どの手も外せることを確かめる）
function replay(level, path, isBlocked) {
  let st = newGame(level);
  for (const id of path) {
    const r = removeScrew(st, id, isBlocked);
    expect(r.ok, `シード ${level.meta.seed} の ${id}: ${r.reason}`).toBe(true);
    st = r.state;
  }
  return st;
}

describe('盤面の生成器', () => {
  it('同じシードなら同じ盤面、違うシードなら違う盤面', () => {
    expect(JSON.stringify(generateLevel(7))).toBe(JSON.stringify(generateLevel(7)));
    expect(JSON.stringify(generateLevel(7))).not.toBe(JSON.stringify(generateLevel(8)));
    expect(JSON.stringify(generateLevel(7, { kind: 'table' }))).toBe(JSON.stringify(generateLevel(7, { kind: 'table' })));
  });

  it('乱数はシードだけで決まる', () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });

  it('箱・本棚・机のどれも作れる', () => {
    for (const kind of KINDS) {
      const level = generateLevel(3, { kind });
      expect(level.meta.kind).toBe(kind);
      expect(level.plates.length).toBeGreaterThanOrEqual(5);
    }
    const kinds = new Set(SEEDS.slice(0, 30).map((s) => generateLevel(s).meta.kind));
    expect([...kinds].sort()).toEqual([...KINDS].sort());
  });

  it('多数のシードで、盤面はルールにも形にも正しく、見つけた手順をルールで再生するとクリアになる', () => {
    for (const seed of SEEDS) {
      const level = generateLevel(seed);
      expect(() => newGame(level)).not.toThrow();
      expect(() => validateBoard(level)).not.toThrow();
      // どの板も始めは固定（ねじ2本以上）
      for (const p of level.plates) expect(level.screws.filter((s) => s.plate === p.id).length).toBeGreaterThanOrEqual(2);
      expect(level.screws.length % BOX_SIZE).toBe(0);
      expect(level.meta.solution).toHaveLength(level.screws.length);
      // 安全側の見積もりで再生してクリア
      expect(status(replay(level, level.meta.solution, safeBlocker(level)), safeBlocker(level))).toBe('cleared');
      // M3 の隠れ判定（板は置いた形のまま、落ちた板は数えない）で再生してもクリア。見積もりの方が厳しいので必ず通る
      expect(status(replay(level, level.meta.solution, blockerFor(level)), blockerFor(level))).toBe('cleared');
    }
  });

  it('始めから全部のねじが見えている盤面ばかりではない（回して探す・板を外して見えるねじがある）', () => {
    let hidden = 0;
    for (const seed of SEEDS.slice(0, 30)) {
      const level = generateLevel(seed);
      const st = newGame(level), b = blockerFor(level);
      if (level.screws.some((s) => b(s.id, st))) hidden++;
    }
    expect(hidden).toBeGreaterThan(20);
  });

  it('生成はスマホで待てる時間で終わる（1盤面の平均と最悪）', () => {
    const times = SEEDS.map((seed) => {
      const t = performance.now();
      generateLevel(seed + 1000);
      return performance.now() - t;
    });
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    // スマホは手元の数倍遅い前提で、ここでは平均 100ms・最悪 1 秒に収める（記録は ROADMAP の M6）
    expect(avg).toBeLessThan(100);
    expect(Math.max(...times)).toBeLessThan(1000);
  });
});

describe('隠し合いの検査', () => {
  const T = 0.3, UP = [-Math.PI / 2, 0, 0];
  const two = (bDir) => ({
    plates: [
      { id: 'A', size: [2, 2], thickness: T, position: [0, 0, 0], rotation: UP },
      { id: 'B', size: [2, 2], thickness: T, position: [0, 1, 0], rotation: UP },
    ],
    screws: [
      { id: 'a1', plate: 'A', color: 'red', position: [-0.5, T / 2, 0], dir: [0, 1, 0] },
      { id: 'a2', plate: 'A', color: 'red', position: [0.5, T / 2, 0], dir: [0, 1, 0] },
      { id: 'b1', plate: 'B', color: 'red', position: [0, 1 + (T / 2) * bDir[1], 0], dir: bDir },
    ],
    queue: ['red'],
  });

  it('上の板のねじが外向きなら、上から順に外せる', () => {
    expect(peelable(two([0, 1, 0]))).toBe(true);
  });

  it('2枚の板が互いのねじを隠し合うと、どちらも外せない', () => {
    expect(peelable(two([0, -1, 0]))).toBe(false);
  });
});
