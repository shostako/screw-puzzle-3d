import { describe, it, expect } from 'vitest';
import { createGame, hudOf, applyEvent } from '../src/game.js';
import { nearestScrew } from '../src/pick.js';
import { BOX_LEVEL } from '../src/levels/box.js';
import { newGame, removeScrew, legalMoves } from '../src/rules.js';
import { blockerFor } from '../src/board.js';

// 再現できる乱数（線形合同法）
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

describe('1局の進行（固定の盤面）', () => {
  it('隠れたねじのタップは拒否され、状態は変わらない', () => {
    const g = createGame(BOX_LEVEL);
    const before = g.state;
    const r = g.tap('p1');
    expect(r.reason).toBe('blocked');
    expect(r.events).toEqual([]);
    expect(g.state).toBe(before);
  });

  it('見えているねじのタップで外れて箱へ入る', () => {
    const g = createGame(BOX_LEVEL);
    const r = g.tap('t1');   // 赤。最初の箱は赤と青
    expect(r.reason).toBe('ok');
    expect(r.events[0]).toEqual({ type: 'toBox', screw: 't1', box: 0 });
    expect(g.state.where.t1).toBe('box');
    expect(g.tap('t1').reason).toBe('gone');
  });

  it('合う箱が無いねじは待機スロットへ', () => {
    const g = createGame(BOX_LEVEL);
    const r = g.tap('t4');   // 緑
    expect(r.events[0]).toEqual({ type: 'toSlot', screw: 't4', slot: 0 });
    expect(hudOf(g.state).slots).toEqual(['green', null, null, null, null]);
  });

  it('待機スロットが満杯なら、合う箱の無いねじは入れられない', () => {
    const g = createGame(BOX_LEVEL);
    for (const id of ['t3', 's2', 'b3', 'k1', 'l2']) expect(g.tap(id).reason).toBe('ok');   // 黄 5本
    expect(g.tap('t4').reason).toBe('full');   // 緑
    expect(g.tap('t1').reason).toBe('ok');     // 赤は箱へ入る
  });

  it('外せるねじを順にタップすればクリアになり、その後のタップは受け付けない。やり直すと始めに戻る', () => {
    const g = createGame(BOX_LEVEL);
    const blocked = blockerFor(BOX_LEVEL);
    let taps = 0;
    while (g.status === 'playing') {
      const [id] = legalMoves(g.state, blocked);
      expect(g.tap(id).reason).toBe('ok');
      taps++;
    }
    expect(g.status).toBe('cleared');
    expect(taps).toBe(BOX_LEVEL.screws.length);
    expect(g.tap('t1').reason).toBe('over');
    g.restart();
    expect(g.status).toBe('playing');
    expect(hudOf(g.state).filled).toBe(0);
  });

  it('外せるねじが無くなれば詰みになり、その後のタップは受け付けない', () => {
    // 板が1枚、4色3本ずつ。赤と青の箱が先に出るが、赤と青のねじは隠しておく。
    // 緑と黄で待機スロット5個が埋まると、外せるねじが無くなる
    const ids = c => [1, 2, 3].map(i => ({ id: `${c[0]}${i}`, plate: 'A', color: c }));
    const level = {
      plates: [{ id: 'A' }],
      screws: [...ids('red'), ...ids('blue'), ...ids('green'), ...ids('yellow')],
      queue: ['red', 'blue', 'green', 'yellow'],
    };
    const g = createGame(level, id => /^[rb]/.test(id));
    for (const id of ['g1', 'g2', 'g3', 'y1']) {
      expect(g.tap(id).reason).toBe('ok');
      expect(g.status).toBe('playing');
    }
    const r = g.tap('y2');
    expect(r.reason).toBe('ok');
    expect(r.status).toBe('stuck');
    expect(g.tap('y3').reason).toBe('over');
  });
});

describe('箱とスロットの表示', () => {
  it('始めは箱が2つ空で、スロットも空', () => {
    expect(hudOf(newGame(BOX_LEVEL))).toEqual({
      boxes: [{ color: 'red', n: 0 }, { color: 'blue', n: 0 }],
      slots: [null, null, null, null, null],
      filled: 0,
      total: 7,
    });
  });

  it('出来事を1つずつ当てると、外した後の表示と同じになる（ランダムに 200 局）', () => {
    const blocked = blockerFor(BOX_LEVEL);
    for (let seed = 1; seed <= 200; seed++) {
      const rand = rng(seed);
      let st = newGame(BOX_LEVEL);
      for (;;) {
        const moves = legalMoves(st, blocked);
        if (!moves.length) break;
        const r = removeScrew(st, moves[Math.floor(rand() * moves.length)], blocked);
        let hud = hudOf(st);
        for (const ev of r.events) hud = applyEvent(hud, ev, BOX_LEVEL);
        expect(hud).toEqual(hudOf(r.state));
        st = r.state;
      }
    }
  });
});

describe('タップした位置からねじを選ぶ', () => {
  const cands = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 130, y: 100 }];
  it('一番近いねじ', () => {
    expect(nearestScrew(cands, 112, 100)).toBe('a');
    expect(nearestScrew(cands, 118, 104)).toBe('b');
  });
  it('遠すぎれば選ばない', () => {
    expect(nearestScrew(cands, 100, 140)).toBeNull();
    expect(nearestScrew(cands, 100, 140, 50)).toBe('a');
    expect(nearestScrew([], 0, 0)).toBeNull();
  });
});
