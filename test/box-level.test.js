import { describe, it, expect } from 'vitest';
import { BOX_LEVEL } from '../src/levels/box.js';
import { validateBoard, coverMap, blockerFor } from '../src/board.js';
import { newGame, removeScrew, legalMoves, status, checkRemove, plateState } from '../src/rules.js';

const blocked = blockerFor(BOX_LEVEL);

// 外せるねじを深さ優先で試し、クリアまでの手順を1つ探す（見た局面は覚えて2度調べない）。
// 局面はどのねじがどこにあるかで決まる（スロットの並びも含める）
function solve(level, isBlocked) {
  const seen = new Set();
  const key = st => JSON.stringify([st.where, st.slots]);
  function dfs(st, path) {
    const s = status(st, isBlocked);
    if (s === 'cleared') return path;
    if (s === 'stuck' || seen.has(key(st))) return null;
    seen.add(key(st));
    for (const id of legalMoves(st, isBlocked)) {
      const found = dfs(removeScrew(st, id, isBlocked).state, [...path, id]);
      if (found) return found;
    }
    return null;
  }
  return dfs(newGame(level), []);
}

describe('固定の盤面: 6枚の板の箱', () => {
  it('ルールの盤面としても、形としても正しい', () => {
    expect(() => newGame(BOX_LEVEL)).not.toThrow();
    expect(() => validateBoard(BOX_LEVEL)).not.toThrow();
  });

  it('隠れているのは、仕切りのねじ（左右の板の内側）と、札の角がかかった天板のねじだけ', () => {
    const covered = Object.fromEntries(Object.entries(coverMap(BOX_LEVEL)).filter(([, ps]) => ps.length));
    expect(covered).toEqual({ t2: ['S'], p1: ['R'], p2: ['R'], p3: ['L'] });
  });

  it('始めに外せるのは、隠れていない 17 本', () => {
    const st = newGame(BOX_LEVEL);
    expect(legalMoves(st, blocked).sort()).toEqual(
      ['b1', 'b2', 'b3', 'b4', 'f1', 'f2', 'k1', 'k2', 'l1', 'l2', 'r1', 'r2', 's1', 's2', 't1', 't3', 't4'],
    );
    for (const id of ['t2', 'p1', 'p2', 'p3']) expect(checkRemove(st, id, blocked)).toBe('blocked');
  });

  it('右板を外すと仕切りの +x 側のねじが見える。ぶら下がっている間はまだ隠れている', () => {
    let st = newGame(BOX_LEVEL);
    st = removeScrew(st, 'r1', blocked).state;
    expect(plateState(st, 'R')).toBe('hanging');
    expect(checkRemove(st, 'p1', blocked)).toBe('blocked');
    st = removeScrew(st, 'r2', blocked).state;
    expect(plateState(st, 'R')).toBe('fallen');
    expect(checkRemove(st, 'p1', blocked)).toBe('ok');
    expect(checkRemove(st, 'p2', blocked)).toBe('ok');
    expect(checkRemove(st, 'p3', blocked)).toBe('blocked');   // こちらは左板の内側
  });

  it('ルールと隠れ判定だけで、クリアまで進められる', () => {
    const path = solve(BOX_LEVEL, blocked);
    expect(path).not.toBeNull();
    expect(path).toHaveLength(BOX_LEVEL.screws.length);
    // 見つけた手順を1手ずつ再生して、どの手も外せること、最後にクリアになることを確かめる
    let st = newGame(BOX_LEVEL);
    for (const id of path) {
      const r = removeScrew(st, id, blocked);
      expect(r.ok, `${id}: ${r.reason}`).toBe(true);
      st = r.state;
    }
    expect(status(st, blocked)).toBe('cleared');
    // 隠れたねじは、隠している板が落ちた後に外している
    const at = id => path.indexOf(id);
    expect(at('p1')).toBeGreaterThan(Math.max(at('r1'), at('r2')));
    expect(at('p3')).toBeGreaterThan(Math.max(at('l1'), at('l2')));
    expect(at('t2')).toBeGreaterThan(Math.max(at('s1'), at('s2')));
  });
});
