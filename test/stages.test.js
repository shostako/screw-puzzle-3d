import { describe, it, expect } from 'vitest';
import {
  stageConfig, stageLevel, hiddenAtStart, START_VIEW, chapterOf, stageStep, isFinale, CHAPTERS, CHAPTER_SIZE, MAX_LEVEL, SCREWS, curveConfig,
  MAX_VARIANT, nextVariant,
} from '../src/stages.js';
import { ALL_KINDS } from '../src/generator.js';
import { createProgress, STORAGE_KEY } from '../src/progress.js';
import { createGame } from '../src/game.js';
import { validateBoard, blockerFor } from '../src/board.js';
import { safeBlocker } from '../src/safe.js';
import { newGame, removeScrew, status } from '../src/rules.js';
import { eulerMatrix, applyMatrix } from '../src/geom.js';

const STAGES = Array.from({ length: 30 }, (_, i) => i + 1);   // 1〜3 章
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

describe('ステージの別の問題（F）', () => {
  // 導入・章の途中・章の大物・2 周目の章から
  const PICKS = [1, 4, 12, 20, 33, 75];

  it('別の盤面は元と違い、同じ設定（形・段・条件）で作られ、見つけた手順でクリアになる', () => {
    for (const n of PICKS) {
      for (const v of [1, 2]) {
        const l = stageLevel(n, v);
        expect(l.meta.stage).toBe(n);
        expect(l.meta.variant).toBe(v);
        expect(JSON.stringify(l.screws), `ステージ ${n} の別の盤面 ${v} が元と同じ`).not.toBe(JSON.stringify(level(n).screws));
        expect(l.meta.kind).toBe(level(n).meta.kind);
        expect(JSON.stringify(l.meta.opts)).toBe(JSON.stringify(level(n).meta.opts));
        expect(() => validateBoard(l)).not.toThrow();
        expect(stageConfig(n).want(l), `ステージ ${n} の別の盤面 ${v} が条件を満たさない`).toBe(true);
        for (const isBlocked of [safeBlocker(l), blockerFor(l)]) {
          let st = newGame(l);
          for (const id of l.meta.solution) {
            const r = removeScrew(st, id, isBlocked);
            expect(r.ok, `ステージ ${n} の別の盤面 ${v} の ${id}: ${r.reason}`).toBe(true);
            st = r.state;
          }
          expect(status(st, isBlocked)).toBe('cleared');
        }
      }
    }
  });

  it('同じ番号なら同じ盤面。シードはそのステージの 1000 個の中で重ならない', () => {
    expect(JSON.stringify(stageLevel(12, 3))).toBe(JSON.stringify(stageLevel(12, 3)));
    expect(stageLevel(12, 0).meta.variant).toBeUndefined();
    const seeds = [0, 1, MAX_VARIANT].map((v) => stageLevel(12, v).meta.seed);
    for (const [v, seed] of [[0, seeds[0]], [1, seeds[1]], [MAX_VARIANT, seeds[2]]]) {
      expect(seed).toBeGreaterThanOrEqual(12 * 1000 + v * 40);
      expect(seed).toBeLessThan(12 * 1000 + (v + 1) * 40);
    }
    expect(() => stageLevel(12, MAX_VARIANT + 1)).toThrow();
    expect(() => stageLevel(12, 1.5)).toThrow();
  });

  it('次の番号は 1〜MAX_VARIANT を回り、元の盤面（0）には戻らない', () => {
    expect(nextVariant(undefined)).toBe(1);
    expect(nextVariant(0)).toBe(1);
    expect(nextVariant(1)).toBe(2);
    expect(nextVariant(MAX_VARIANT)).toBe(1);
  });
});

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

  it('導入（1〜6）は易しい方から増え、7 から先はそれより多い', () => {
    for (let n = 2; n <= 6; n++) {
      const a = stageConfig(n - 1), b = stageConfig(n);
      expect(b.colors, `ステージ ${n} の色`).toBeGreaterThanOrEqual(a.colors);
      // 札はステージ 3 で 2 枚まで増やし、中の板を覚える 4 では 1 枚に戻す
      if (n !== 4) expect(b.labels, `ステージ ${n} の札`).toBeGreaterThanOrEqual(a.labels);
      expect(b.win, `ステージ ${n} の混ぜ方`).toBeGreaterThanOrEqual(a.win);
    }
    for (let n = 7; n <= 60; n++) {
      expect(stageConfig(n).colors).toBeGreaterThanOrEqual(stageConfig(6).colors);
      expect(stageConfig(n).win).toBeGreaterThanOrEqual(stageConfig(6).win);
    }
    const avg = (ns) => ns.reduce((m, n) => m + level(n).screws.length, 0) / ns.length;
    const first = avg([1, 2, 3]), intro = avg([4, 5, 6]), mid = avg([7, 8, 9, 10, 11, 12]), late = avg([25, 26, 27, 28, 29, 30]);
    expect(first).toBeLessThan(intro);
    expect(intro).toBeLessThanOrEqual(mid);
    expect(new Set(level(30).queue).size).toBeGreaterThan(new Set(level(1).queue).size);
    expect(late).toBeGreaterThanOrEqual(first);
  });
  it('7 から先の盤面は層が 2 段以上。待機スロットの回数の条件は、満たせるシードがあれば満たす（D5）', () => {
    let met = 0, asked = 0;
    for (let n = 7; n <= 48; n++) {
      const l = level(n), cfg = stageConfig(n);
      expect(l.meta.difficulty.layers, `ステージ ${n} の層`).toBeGreaterThanOrEqual(cfg.minLayers);
      if (cfg.minSlots) { asked++; if (l.meta.difficulty.slots >= cfg.minSlots) met++; }
    }
    expect(asked).toBeGreaterThan(0);
    expect(met / asked).toBeGreaterThan(0.6);
  });

  it('ステージの盤面はスマホで待てる時間で作れる', () => {
    const times = Array.from({ length: 30 }, (_, i) => {
      const t = performance.now();
      stageLevel(i + 31);   // 4〜6 章（大物を 3 つ含む）
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

describe('章と難しさの曲線（E8）', () => {
  it('10 ステージで 1 章。章の番号・範囲・何番目か', () => {
    expect(chapterOf(1)).toMatchObject({ no: 1, first: 1, last: 10, pos: 1 });
    expect(chapterOf(10)).toMatchObject({ no: 1, pos: 10 });
    expect(chapterOf(11)).toMatchObject({ no: 2, first: 11, last: 20, pos: 1 });
    expect(chapterOf(60)).toMatchObject({ no: 6, pos: 10 });
    // 7 章から先は 2〜6 章の組を回す
    expect(chapterOf(61).no).toBe(7);
    expect(chapterOf(61).kinds).toEqual(CHAPTERS[1].kinds);
    expect(chapterOf(111).kinds).toEqual(CHAPTERS[1].kinds);
    expect(chapterOf(101).kinds).toEqual(CHAPTERS[5].kinds);
    expect(() => chapterOf(0)).toThrow();
    for (const c of CHAPTERS) {
      expect(c.kinds).toHaveLength(CHAPTER_SIZE);
      for (const k of c.kinds) expect(ALL_KINDS).toContain(k);
    }
  });

  it('ステージ 1〜10 の形は M7 からの並び（導入の箱・本棚・机、7〜10 は箱・車・本棚・家）', () => {
    expect(Array.from({ length: 10 }, (_, i) => stageConfig(i + 1).kind))
      .toEqual(['box', 'box', 'box', 'box', 'shelf', 'table', 'box', 'car', 'shelf', 'house']);
  });

  it('家具 3 種と題材 9 種が、ステージ 60 までにどれも出る。題材は章ごとに 3〜4 種（6 章は総まとめ）', () => {
    const seen = new Set(Array.from({ length: 60 }, (_, i) => stageConfig(i + 1).kind));
    expect([...seen].sort()).toEqual([...ALL_KINDS].sort());
    for (const c of CHAPTERS.slice(1, -1)) {
      const themes = new Set(c.kinds.filter((k) => !['box', 'shelf', 'table'].includes(k)));
      expect(themes.size).toBeGreaterThanOrEqual(3);
      expect(themes.size).toBeLessThanOrEqual(4);
    }
  });

  it('のこぎりの歯: 章の中で上がり、章の 10 番目（大物）がその章でいちばん高い。次の章の頭で下がるが、下がりすぎない', () => {
    for (let c = 1; c <= 12; c++) {
      const first = c === 1 ? 7 : (c - 1) * CHAPTER_SIZE + 1, last = c * CHAPTER_SIZE;
      const steps = Array.from({ length: last - first + 1 }, (_, i) => stageStep(first + i));
      expect(isFinale(last)).toBe(true);
      expect(Math.max(...steps.slice(0, -1)), `${c} 章の大物`).toBeLessThan(steps.at(-1));
      // 前半より後半が高い
      const half = Math.floor(steps.length / 2);
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      expect(mean(steps.slice(half)), `${c} 章`).toBeGreaterThan(mean(steps.slice(0, half)));
      if (c === 1) continue;
      const prevEnd = stageStep(first - 1), prevStart = stageStep(c === 2 ? 7 : first - CHAPTER_SIZE);
      expect(steps[0], `${c} 章の頭は前の章の大物より下がる`).toBeLessThan(prevEnd);
      // 1〜6 章は 3 段まで。7 章から先は同じ山を繰り返すので、大物から次の頭までの差は山の高さ（5 段）
      expect(prevEnd - steps[0], `${c} 章の頭は下がりすぎない`).toBeLessThanOrEqual(c <= 6 ? 3 : 5);
      expect(steps[0], `${c} 章の頭は前の章の頭より下がらない`).toBeGreaterThanOrEqual(prevStart);
    }
    for (let n = 7; n <= 200; n++) expect(stageStep(n)).toBeLessThanOrEqual(MAX_LEVEL);
    expect(stageStep(200)).toBe(MAX_LEVEL);
  });

  it('大物は色が章でいちばん多く、ねじの本数は章の中ほどより多い（作った盤面で）', () => {
    for (let c = 1; c <= 3; c++) {
      const ns = Array.from({ length: CHAPTER_SIZE }, (_, i) => (c - 1) * CHAPTER_SIZE + i + 1).filter((n) => n >= 7);
      const boss = level(c * CHAPTER_SIZE);
      for (const n of ns) expect(new Set(level(n).queue).size, `${c} 章のステージ ${n}`).toBeLessThanOrEqual(new Set(boss.queue).size);
      const counts = ns.map((n) => level(n).screws.length).sort((a, b) => a - b);
      expect(boss.screws.length, `${c} 章の大物のねじ`).toBeGreaterThanOrEqual(counts[Math.floor(counts.length / 2)]);
    }
  });

  it('段を上げると、色・札・混ぜ方・ねじの下限・待機スロットの回数は減らない（どの形でも）', () => {
    const lo = (cfg) => {
      // want が通るねじの本数のいちばん少ない数
      for (let k = 0; k <= 60; k++) if (cfg.want({ screws: { length: k }, meta: { difficulty: { layers: 9 } } })) return k;
      return null;
    };
    for (const kind of ALL_KINDS) {
      for (let s = 1; s <= MAX_LEVEL; s++) {
        const a = curveConfig(kind, s - 1), b = curveConfig(kind, s);
        for (const key of ['colors', 'labels', 'win', 'noise', 'minSlots']) expect(b[key], `${kind} 段 ${s} の ${key}`).toBeGreaterThanOrEqual(a[key]);
        expect(lo(b)).toBeGreaterThanOrEqual(lo(a));
        expect(lo(b)).toBeGreaterThanOrEqual(SCREWS[kind][0]);
        expect(lo(b)).toBeLessThanOrEqual(SCREWS[kind][1]);
      }
    }
  });

  it('ステージの盤面の meta に章と空の名前がある', () => {
    expect(level(12).meta).toMatchObject({ stage: 12, chapter: 2, sky: 'ch2' });
    expect(level(3).meta).toMatchObject({ chapter: 1, sky: 'ch1' });
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
