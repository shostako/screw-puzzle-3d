import { describe, it, expect } from 'vitest';
import {
  randomLevel, randomConfig, dailyLevel, DIFFICULTIES, DIFFICULTY_IDS, DAILY_DIFFICULTY, RANDOM_KINDS,
  dateKey, dayIndex, isDateKey, isRandomNo, dateLabel, dailyBestKey, MAX_RANDOM,
} from '../src/random.js';
import { curveConfig } from '../src/stages.js';
import { validateBoard, blockerFor } from '../src/board.js';
import { safeBlocker } from '../src/safe.js';
import { newGame, removeScrew, status, heldBy } from '../src/rules.js';
import { solve } from '../src/solve.js';
import { createBests } from '../src/rating.js';

// 番号ごとの盤面（作るのに少しかかるので覚えておく）
const cache = new Map();
const level = (no, d) => {
  const k = `${no}/${d}`;
  if (!cache.has(k)) cache.set(k, randomLevel(no, d));
  return cache.get(k);
};
const NOS = Array.from({ length: 8 }, (_, i) => i + 1);

// 盤面の手順を、安全側の見積もりと本当の隠れ判定の両方で打ってクリアになるか
function playsThrough(l) {
  for (const isBlocked of [safeBlocker(l), blockerFor(l)]) {
    let st = newGame(l);
    for (const id of l.meta.solution) {
      const r = removeScrew(st, id, isBlocked);
      if (!r.ok) return `${id}: ${r.reason}`;
      st = r.state;
    }
    if (status(st, isBlocked) !== 'cleared') return '最後にクリアにならない';
  }
  return 'ok';
}

describe('おまかせ（D6）', () => {
  it('同じ番号と難しさなら同じ盤面。番号か難しさが違えば違う盤面', () => {
    expect(JSON.stringify(randomLevel(3, 'normal'))).toBe(JSON.stringify(level(3, 'normal')));
    expect(JSON.stringify(level(3, 'normal'))).not.toBe(JSON.stringify(level(4, 'normal')));
    expect(JSON.stringify(level(3, 'normal'))).not.toBe(JSON.stringify(level(3, 'easy')));
  });

  it('どの難しさの盤面も正しく、条件を満たし、見つけた手順でクリアになる（解ける保証）', () => {
    for (const d of DIFFICULTY_IDS) {
      for (const no of NOS) {
        const l = level(no, d);
        expect(l.meta.random).toEqual({ no, difficulty: d });
        expect(() => validateBoard(l)).not.toThrow();
        expect(randomConfig(no, d).want(l), `${d} #${no} が条件を満たさない`).toBe(true);
        expect(playsThrough(l), `${d} #${no}`).toBe('ok');
      }
    }
  });

  it('子の部品が残る間は親の最後のねじが外せない（D5 のルール）を、手順も守っている', () => {
    // 手順の途中で、親の最後のねじを外す手の前には、子の板がもう無い
    let checked = 0;
    for (const d of DIFFICULTY_IDS) {
      for (const no of NOS) {
        const l = level(no, d);
        const isBlocked = safeBlocker(l);
        let st = newGame(l);
        for (const id of l.meta.solution) {
          const s = l.screws.find((x) => x.id === id);
          if (st.left[s.plate] === 1) {
            expect(heldBy(st, s.plate), `${d} #${no} の ${id}`).toEqual([]);
            checked++;
          }
          st = removeScrew(st, id, isBlocked).state;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
    // 子が残る局面で親の最後のねじを外そうとすると 'held' になる盤面が実際にある（題材の盤面）
    const themed = DIFFICULTY_IDS.flatMap((d) => NOS.map((no) => level(no, d))).find((l) => l.plates.some((p) => p.parent));
    expect(themed).toBeTruthy();
  });

  it('始めの局面から探索しても手順が見つかる（生成器の手順に頼らない確かめ）', () => {
    for (const d of DIFFICULTY_IDS) {
      const l = level(1, d);
      expect(solve(l, safeBlocker(l), { budget: 20000 }), `${d} #1`).toBeTruthy();
    }
  });

  it('難しさはステージの曲線の段を借りる。形は 12 種のどれかを番号で選び、偏りすぎない', () => {
    expect(RANDOM_KINDS).toHaveLength(12);
    for (const d of DIFFICULTY_IDS) {
      const kinds = new Set();
      for (let no = 1; no <= 120; no++) {
        const c = randomConfig(no, d);
        expect(RANDOM_KINDS).toContain(c.kind);
        const ref = curveConfig(c.kind, DIFFICULTIES[d].step);
        expect({ ...c, want: 0, prefer: 0 }).toEqual({ ...ref, want: 0, prefer: 0 });
        kinds.add(c.kind);
      }
      expect(kinds.size).toBe(RANDOM_KINDS.length);
    }
    const count = new Map();
    for (let no = 1; no <= 2400; no++) {
      const kind = randomConfig(no, 'normal').kind;
      count.set(kind, (count.get(kind) ?? 0) + 1);
    }
    for (const n of count.values()) expect(n).toBeGreaterThan(120);   // 平均 200
  });

  it('難しくするほど、色・札が増え、手順で待機スロットを使う回数が増える', () => {
    const avg = (d, f) => NOS.reduce((a, no) => a + f(level(no, d)), 0) / NOS.length;
    const slots = (l) => l.meta.difficulty.slots;
    const colors = (d) => curveConfig('box', DIFFICULTIES[d].step).colors;
    expect(colors('easy')).toBeLessThan(colors('normal'));
    expect(colors('normal')).toBeLessThan(colors('hard'));
    expect(avg('easy', slots)).toBeLessThan(avg('hard', slots));
    expect(avg('normal', slots)).toBeLessThanOrEqual(avg('hard', slots));
    // どの難しさも層は 2 段以上（ねじが全部見えている平たい盤面は出ない）
    for (const d of DIFFICULTY_IDS) for (const no of NOS) expect(level(no, d).meta.difficulty.layers).toBeGreaterThanOrEqual(2);
  });

  it('番号と難しさの入力を確かめる', () => {
    expect(isRandomNo(1)).toBe(true);
    expect(isRandomNo(MAX_RANDOM)).toBe(true);
    expect(isRandomNo(0)).toBe(false);
    expect(isRandomNo(MAX_RANDOM + 1)).toBe(false);
    expect(isRandomNo(1.5)).toBe(false);
    expect(() => randomLevel(0, 'normal')).toThrow();
    expect(() => randomConfig(1, 'impossible')).toThrow();
  });
});

describe('今日の1問（D6）', () => {
  it('日付の数と日数', () => {
    expect(dateKey(new Date(2026, 9, 3, 23, 59))).toBe(20261003);
    expect(dateKey(new Date(2026, 0, 1, 0, 0))).toBe(20260101);
    expect(dayIndex(20000101)).toBe(0);
    expect(dayIndex(20261004) - dayIndex(20261003)).toBe(1);
    expect(dayIndex(20270101) - dayIndex(20261231)).toBe(1);
    expect(isDateKey(20261003)).toBe(true);
    expect(isDateKey(20260230)).toBe(false);
    expect(isDateKey(20261301)).toBe(false);
    expect(isDateKey(123)).toBe(false);
    expect(dateLabel(20261003)).toBe('10月3日');
    expect(dailyBestKey(20261003)).toBe('daily-20261003');
  });

  it('同じ日付なら同じ盤面、日付が違えば違う盤面。どれも解ける', () => {
    const a = dailyLevel(20261003);
    expect(JSON.stringify(dailyLevel(20261003))).toBe(JSON.stringify(a));
    expect(a.meta.daily).toBe(20261003);
    expect(a.meta.random.difficulty).toBe(DAILY_DIFFICULTY);
    const days = [20261003, 20261004, 20261005, 20270101];
    const levels = days.map(dailyLevel);
    expect(new Set(levels.map((l) => JSON.stringify(l.screws))).size).toBe(days.length);
    for (const l of levels) {
      expect(() => validateBoard(l)).not.toThrow();
      expect(playsThrough(l), `${l.meta.daily}`).toBe('ok');
    }
    expect(() => dailyLevel(20260230)).toThrow();
  });

  it('今日の1問の番号はおまかせの番号と重ならない', () => {
    expect(dailyLevel(20261003).meta.random.no).toBeGreaterThan(MAX_RANDOM);
  });

  it('自己ベストは日付ごとに覚え、ステージのベストと混ざらない', () => {
    const m = new Map();
    const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
    const bests = createBests(storage);
    bests.record(3, { stars: 2, seconds: 50 });
    bests.record(dailyBestKey(20261003), { stars: 3, seconds: 80 });
    const again = createBests(storage);
    expect(again.get(dailyBestKey(20261003))).toEqual({ stars: 3, seconds: 80 });
    expect(again.get(dailyBestKey(20261004))).toBe(null);
    expect(again.get(3)).toEqual({ stars: 2, seconds: 50 });
  });
});
