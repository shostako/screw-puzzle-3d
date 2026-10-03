import { describe, it, expect } from 'vitest';
import { findHint } from '../src/hint.js';
import { createGame } from '../src/game.js';
import { generateLevel } from '../src/generator.js';
import { safeBlocker } from '../src/safe.js';
import { newGame, removeScrew, legalMoves, isCleared, plateState } from '../src/rules.js';
import { BOX_LEVEL } from '../src/levels/box.js';

// 再現できる乱数（線形合同法）
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

// 手順を1手ずつ再生する。どれか外せなければ失敗
function replay(st, path, isBlocked) {
  for (const id of path) {
    const r = removeScrew(st, id, isBlocked);
    expect(r.ok, `${id}: ${r.reason}`).toBe(true);
    st = r.state;
  }
  return st;
}

describe('ヒント（今の局面から解ける手順の最初の手）', () => {
  it('始めの局面で、最初の手は今外せるねじで、手順を再生するとクリアになる', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const level = generateLevel(seed);
      const safe = safeBlocker(level);
      const st = newGame(level);
      const h = findHint(level, st, safe);
      expect(h.screw, `シード ${seed}`).toBeTruthy();
      expect(h.path[0]).toBe(h.screw);
      expect(legalMoves(st, safe)).toContain(h.screw);
      expect(isCleared(replay(st, h.path, safe))).toBe(true);
    }
  });

  it('解ける手順の途中から呼ぶと、残りの手順を返す', () => {
    const level = generateLevel(11);
    const safe = safeBlocker(level);
    const sol = level.meta.solution;
    const st = replay(newGame(level), sol.slice(0, Math.floor(sol.length / 2)), safe);
    const h = findHint(level, st, safe);
    expect(h.screw).toBeTruthy();
    expect(isCleared(replay(st, h.path, safe))).toBe(true);
  });

  it('でたらめに外していった途中の局面でも、手順を返すならそれでクリアできる（探す時間も見張る）', () => {
    let found = 0, worst = 0;
    for (const seed of [21, 22, 23, 24, 25, 26]) {
      const level = generateLevel(seed);
      const safe = safeBlocker(level);
      const rnd = rng(seed);
      let st = newGame(level);
      for (let step = 0; step < 12 && !isCleared(st); step++) {
        const legal = legalMoves(st, safe);
        if (!legal.length) break;
        st = removeScrew(st, legal[Math.floor(rnd() * legal.length)], safe).state;
        const t0 = performance.now();
        const h = findHint(level, st, safe);
        worst = Math.max(worst, performance.now() - t0);
        if (isCleared(st)) expect(h.reason).toBe('over');
        else if (h.screw) {
          found++;
          expect(isCleared(replay(st, h.path, safe))).toBe(true);
        } else expect(['none', 'budget']).toContain(h.reason);
      }
    }
    expect(found).toBeGreaterThan(0);
    // スマホは数倍遅いとみて、押してから待たせすぎない
    expect(worst).toBeLessThan(2000);
  });

  it('解ける手順が無い局面では screw が null で reason が none', () => {
    // 赤は板 C に、青は板 A に隠れていて、A は赤、C は青のねじで留まっている（互いに外せない）
    const level = {
      plates: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      screws: [
        ...['r1', 'r2', 'r3'].map((id) => ({ id, plate: 'A', color: 'red' })),
        ...['g1', 'g2', 'g3'].map((id) => ({ id, plate: 'B', color: 'green' })),
        ...['b1', 'b2', 'b3'].map((id) => ({ id, plate: 'C', color: 'blue' })),
      ],
      queue: ['red', 'green', 'blue'],
    };
    const covers = { r1: ['C'], r2: ['C'], r3: ['C'], b1: ['A'], b2: ['A'], b3: ['A'] };
    const blocker = (id, st) => (covers[id] || []).some((p) => plateState(st, p) !== 'fallen');
    expect(findHint(level, newGame(level), blocker)).toEqual({ screw: null, reason: 'none' });
  });

  it('探しきれなければ reason が budget', () => {
    const level = generateLevel(3);
    expect(findHint(level, newGame(level), safeBlocker(level), { budget: 0 }).reason).toBe('budget');
  });
});

describe('1局のヒント', () => {
  it('ヒントの手を外していけばクリアでき、使った回数を数える。やり直しで回数は 0 に戻る', () => {
    const g = createGame(BOX_LEVEL);
    let n = 0;
    while (g.status === 'playing') {
      const h = g.hint();
      expect(h.screw).toBeTruthy();
      expect(g.tap(h.screw).reason).toBe('ok');
      n++;
    }
    expect(g.status).toBe('cleared');
    expect(g.hints).toBe(n);
    expect(g.hint()).toEqual({ screw: null, reason: 'over' });
    expect(g.hints).toBe(n);
    g.restart();
    expect(g.hints).toBe(0);
  });
});

describe('見えているねじを優先するヒント', () => {
  it('prefer の中に最初の手にできるねじがあれば、それを返し、その手順でクリアできる', () => {
    let switched = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const level = generateLevel(seed);
      const safe = safeBlocker(level);
      const st = newGame(level);
      const plain = findHint(level, st, safe);
      // 探索がふつう選ばない、今外せるねじだけを prefer に
      const others = legalMoves(st, safe).filter((id) => id !== plain.screw);
      const h = findHint(level, st, safe, { prefer: others });
      expect(h.screw).toBeTruthy();
      expect(isCleared(replay(st, h.path, safe))).toBe(true);
      if (others.includes(h.screw)) switched++;
    }
    expect(switched).toBeGreaterThan(0);
  });

  it('prefer のどれも最初の手にできなければ、ふつうの手を返す', () => {
    const level = generateLevel(5);
    const safe = safeBlocker(level);
    const st = newGame(level);
    const blocked = level.screws.map((s) => s.id).filter((id) => !legalMoves(st, safe).includes(id));
    expect(findHint(level, st, safe, { prefer: blocked })).toEqual(findHint(level, st, safe));
  });
});
