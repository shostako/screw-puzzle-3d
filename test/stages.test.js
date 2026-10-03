import { describe, it, expect } from 'vitest';
import { stageConfig, stageLevel, hiddenAtStart, START_VIEW } from '../src/stages.js';
import { createProgress, STORAGE_KEY } from '../src/progress.js';
import { createGame } from '../src/game.js';
import { validateBoard, blockerFor } from '../src/board.js';
import { safeBlocker } from '../src/safe.js';
import { newGame, removeScrew, status } from '../src/rules.js';
import { eulerMatrix, applyMatrix } from '../src/geom.js';

const STAGES = Array.from({ length: 30 }, (_, i) => i + 1);
const levels = new Map();
const level = (n) => {
  if (!levels.has(n)) levels.set(n, stageLevel(n));
  return levels.get(n);
};
const plates = (l, prefix) => l.plates.filter((p) => p.id.startsWith(prefix)).length;

// localStorage の代わり
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

describe('ステージの盤面', () => {
  it('同じステージ番号なら同じ盤面', () => {
    expect(JSON.stringify(stageLevel(3))).toBe(JSON.stringify(level(3)));
    expect(JSON.stringify(level(3))).not.toBe(JSON.stringify(level(4)));
  });

  it('どのステージも盤面が正しく、条件を満たし、見つけた手順でクリアになる', () => {
    for (const n of STAGES) {
      const l = level(n);
      expect(l.meta.stage).toBe(n);
      expect(() => validateBoard(l)).not.toThrow();
      expect(stageConfig(n).want(l), `ステージ ${n} が条件を満たさない`).toBe(true);
      for (const isBlocked of [safeBlocker(l), blockerFor(l)]) {
        let st = newGame(l);
        for (const id of l.meta.solution) {
          const r = removeScrew(st, id, isBlocked);
          expect(r.ok, `ステージ ${n} の ${id}: ${r.reason}`).toBe(true);
          st = r.state;
        }
        expect(status(st, isBlocked)).toBe('cleared');
      }
    }
  });

  it('ステージ 1 は閉じた小さな箱。全部見えているが、裏や底のねじは回さないと見えない', () => {
    const l = level(1);
    expect(l.meta.kind).toBe('box');
    expect(l.plates.map((p) => p.id).sort()).toEqual(['back', 'bottom', 'front', 'left', 'right', 'top']);
    expect(l.screws).toHaveLength(12);
    expect(new Set(l.queue).size).toBe(2);
    expect(hiddenAtStart(l)).toBe(0);
    // 最初の向きでカメラ（+z）から見て向こうを向いているねじがある
    const m = eulerMatrix(START_VIEW);
    const away = l.screws.filter((s) => applyMatrix(m, s.dir)[2] < 0).length;
    const toward = l.screws.length - away;
    expect(away).toBeGreaterThanOrEqual(3);
    expect(toward).toBeGreaterThanOrEqual(3);
  });

  it('ステージ 1 はどの順に外しても詰まない（ランダムに外す 300 局）', () => {
    const l = level(1);
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let g = 0; g < 300; g++) {
      const game = createGame(l, blockerFor(l));
      while (game.status === 'playing') {
        const moves = game.legal();
        game.tap(moves[Math.floor(rnd() * moves.length)]);
      }
      expect(game.status).toBe('cleared');
    }
  });

  it('ステージ 2〜3 は札で隠れたねじがあり、ステージ 4 は中に板がある', () => {
    for (const n of [2, 3]) {
      expect(plates(level(n), 'label')).toBe(n - 1);
      expect(hiddenAtStart(level(n))).toBeGreaterThanOrEqual(n - 1);
    }
    expect(plates(level(4), 'shelf') + plates(level(4), 'wall')).toBeGreaterThanOrEqual(1);
    expect(level(5).meta.kind).toBe('shelf');
    expect(level(6).meta.kind).toBe('table');
  });

  it('進むほど難しくなる（色・札・混ぜ方は減らず、ねじの数は増えていく）', () => {
    for (let n = 2; n <= 60; n++) {
      const a = stageConfig(n - 1), b = stageConfig(n);
      expect(b.colors, `ステージ ${n} の色`).toBeGreaterThanOrEqual(a.colors);
      // 札はステージ 3 で 2 枚まで増やし、中の板を覚える 4 では 1 枚に戻す。そこから先は減らさない
      if (n !== 4) expect(b.labels, `ステージ ${n} の札`).toBeGreaterThanOrEqual(a.labels);
      expect(b.win, `ステージ ${n} の混ぜ方`).toBeGreaterThanOrEqual(a.win);
      expect(b.noise, `ステージ ${n} の混ぜ方`).toBeGreaterThanOrEqual(a.noise);
    }
    const avg = (ns) => ns.reduce((m, n) => m + level(n).screws.length, 0) / ns.length;
    const first = avg([1, 2, 3]), intro = avg([4, 5, 6]), mid = avg([7, 8, 9, 10, 11, 12]), late = avg([25, 26, 27, 28, 29, 30]);
    expect(first).toBeLessThan(intro);
    expect(intro).toBeLessThanOrEqual(mid);
    expect(mid).toBeLessThan(late);
    expect(new Set(level(30).queue).size).toBeGreaterThan(new Set(level(1).queue).size);
  });

  it('ステージの盤面はスマホで待てる時間で作れる', () => {
    const times = Array.from({ length: 30 }, (_, i) => {
      const t = performance.now();
      stageLevel(i + 31);
      return performance.now() - t;
    });
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    // 条件に合うまでシードを変えるぶん M6 の1盤面より長い。手元の数倍遅いスマホでも 1〜2 秒に収まる目安
    expect(avg).toBeLessThan(300);
    expect(Math.max(...times)).toBeLessThan(1500);
  });

  it('おかしなステージ番号は受け付けない', () => {
    expect(() => stageConfig(0)).toThrow();
    expect(() => stageConfig(1.5)).toThrow();
  });
});

describe('到達したステージの保存', () => {
  it('保存が無ければステージ 1 から', () => {
    expect(createProgress(memoryStorage()).stage).toBe(1);
    expect(createProgress(null).stage).toBe(1);
  });

  it('クリアで次のステージが保存され、読み直すと続きから', () => {
    const storage = memoryStorage();
    const p = createProgress(storage);
    expect(p.cleared(1)).toBe(2);
    expect(storage.map.get(STORAGE_KEY)).toBe('2');
    expect(createProgress(storage).stage).toBe(2);
  });

  it('前のステージを遊び直してクリアしても、到達は戻らない', () => {
    const storage = memoryStorage();
    const p = createProgress(storage);
    p.cleared(1); p.cleared(2); p.cleared(3);
    expect(p.cleared(1)).toBe(4);
    expect(createProgress(storage).stage).toBe(4);
  });

  it('壊れた値や、読み書きできない保存先でも遊べる', () => {
    const bad = memoryStorage();
    bad.setItem(STORAGE_KEY, 'abc');
    expect(createProgress(bad).stage).toBe(1);
    bad.setItem(STORAGE_KEY, '-3');
    expect(createProgress(bad).stage).toBe(1);
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const p = createProgress(broken);
    expect(p.stage).toBe(1);
    expect(p.cleared(1)).toBe(2);
    expect(p.stage).toBe(2);
  });

  it('ステージ 1 から順にクリアして進み、読み直すと続きのステージから', () => {
    const storage = memoryStorage();
    for (let n = 1; n <= 8; n++) {
      const p = createProgress(storage);   // 毎回読み直す（再読み込みと同じ）
      expect(p.stage).toBe(n);
      const l = level(p.stage);
      const game = createGame(l, safeBlocker(l));
      for (const id of l.meta.solution) expect(game.tap(id).reason).toBe('ok');
      expect(game.status).toBe('cleared');
      expect(p.cleared(n)).toBe(n + 1);
    }
    expect(createProgress(storage).stage).toBe(9);
  });
});
