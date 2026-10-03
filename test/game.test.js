import { describe, it, expect } from 'vitest';
import { createGame, hudOf, applyEvent, rewindPoint } from '../src/game.js';
import { generateLevel } from '../src/generator.js';
import { safeBlocker } from '../src/safe.js';
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

describe('戻る', () => {
  it('1手ずつ戻すと、外す前の状態にそのまま戻る。始めより前へは戻れない', () => {
    const g = createGame(BOX_LEVEL);
    const seen = [g.state], ids = [];
    for (let k = 0; k < 3; k++) {
      const id = g.legal()[0];
      expect(g.tap(id).reason).toBe('ok');
      seen.push(g.state);
      ids.push(id);
    }
    expect(g.moves).toBe(3);
    expect(g.path).toEqual(ids);
    expect(g.tap('p1').reason).toBe('blocked');   // 外せなかったタップは手に数えない
    expect(g.moves).toBe(3);
    for (let k = 2; k >= 0; k--) {
      expect(g.undo()).toBe(true);
      expect(g.state).toBe(seen[k]);
      expect(g.moves).toBe(k);
    }
    expect(g.canUndo).toBe(false);
    expect(g.undo()).toBe(false);
    expect(g.state).toBe(seen[0]);
    expect(g.undos).toBe(3);
    // 戻した後に外し直せば、同じ状態になる
    g.tap(ids[0]);
    expect(g.state).toEqual(seen[1]);
    g.restart();
    expect(g.moves).toBe(0);
    expect(g.undos).toBe(0);
  });

  it('rewind(k) は k 手目を外す直前へ一気に戻し、それより後の手は忘れる', () => {
    const g = createGame(BOX_LEVEL);
    const before = [];
    for (let k = 0; k < 4; k++) {
      before.push(g.state);
      expect(g.tap(g.legal()[0]).reason).toBe('ok');
    }
    const first = g.path[0];
    expect(g.rewind(1)).toBe(true);
    expect(g.state).toBe(before[1]);
    expect(g.path).toEqual([first]);
    expect(g.rewind(5)).toBe(false);
    expect(g.undos).toBe(1);
  });

  it('クリアの後は戻せない', () => {
    const level = generateLevel(4);
    const g = createGame(level, safeBlocker(level));
    for (const id of level.meta.solution) g.tap(id);
    expect(g.status).toBe('cleared');
    expect(g.canUndo).toBe(false);
    expect(g.undo()).toBe(false);
    expect(g.status).toBe('cleared');
  });

  // 生成した盤面をでたらめに外して詰ませ、戻る先を探す。戻る先は詰みより前で、そこからの手順でクリアできる
  it('詰みから、解ける手順が残っている局面へ戻せる（生成した盤面をでたらめに詰ませる）', () => {
    let stuck = 0;
    for (let seed = 1; seed <= 40 && stuck < 8; seed++) {
      const level = generateLevel(seed);
      const safe = safeBlocker(level);
      const g = createGame(level, safe);
      const r = rng(seed);
      while (g.status === 'playing') {
        const legal = g.legal();
        g.tap(legal[Math.floor(r() * legal.length)]);
      }
      if (g.status !== 'stuck') continue;
      stuck++;
      // 1手戻せば遊べる状態に戻る（詰みの画面から「1手戻す」）
      const last = g.state;
      expect(g.undo()).toBe(true);
      expect(g.status).toBe('playing');
      g.tap(legalAgain(g, last));
      expect(g.state.where).toEqual(last.where);
      expect(g.status).toBe('stuck');

      const states = [...g.history, g.state];
      const { k, path } = rewindPoint(level, states, safe);
      expect(k).toBeLessThan(states.length - 1);
      expect(path).toBeTruthy();
      // 手順どおりに外せばクリアになる
      expect(g.rewind(k)).toBe(true);
      for (const id of path) expect(g.tap(id).reason).toBe('ok');
      expect(g.status).toBe('cleared');
    }
    expect(stuck).toBeGreaterThanOrEqual(3);
  });
});

// 戻した後、詰みの直前の手を打ち直して、同じ詰みへ戻る（戻す前と同じ状態になることも確かめる）
function legalAgain(g, last) {
  for (const id of g.legal()) {
    const r = removeScrew(g.state, id);
    if (r.ok && JSON.stringify(r.state.where) === JSON.stringify(last.where)) return id;
  }
  throw new Error('詰みへ戻る手が無い');
}

describe('部品の親子（D5）', () => {
  it('子の部品が付いた親の最後のねじのタップは held で拒否され、付いている子の板を返す', () => {
    const level = generateLevel(1, { kind: 'car' });
    const game = createGame(level, () => false);
    const chassis = level.screws.filter((s) => s.plate === 'chassis');
    for (const s of chassis.slice(1)) expect(game.tap(s.id).reason).toBe('ok');
    const r = game.tap(chassis[0].id);
    expect(r.reason).toBe('held');
    expect(r.events).toEqual([]);
    expect(r.holders).toEqual(expect.arrayContaining(['wheel1', 'wheel2', 'wheel3', 'wheel4', 'cabin']));
    expect(game.state.where[chassis[0].id]).toBe('board');
  });
});
