import { describe, it, expect } from 'vitest';
import { rate, parSeconds, PAR_PER_SCREW, better, clock, createPlayClock, createBests, BEST_KEY } from '../src/rating.js';
import { STORAGE_KEY } from '../src/progress.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

describe('クリアの星', () => {
  it('目安の時間はねじの本数 × 1本の秒数', () => {
    expect(parSeconds(12)).toBe(12 * PAR_PER_SCREW);
  });

  it('ヒントも戻るも使わず目安の時間内なら ★3、目安ちょうどもまだ ★3', () => {
    expect(rate({ screws: 12, seconds: 30 }).stars).toBe(3);
    expect(rate({ screws: 12, seconds: parSeconds(12) })).toMatchObject({ stars: 3, late: false });
  });

  it('目安を超えると1つ減る', () => {
    expect(rate({ screws: 12, seconds: parSeconds(12) + 0.1 })).toMatchObject({ stars: 2, late: true });
  });

  it('ヒント1回・戻る1回ごとに1つ減り、★1 より下にはならない', () => {
    expect(rate({ screws: 12, seconds: 10, hints: 1 }).stars).toBe(2);
    expect(rate({ screws: 12, seconds: 10, rewinds: 1 }).stars).toBe(2);
    expect(rate({ screws: 12, seconds: 10, hints: 1, rewinds: 1 }).stars).toBe(1);
    expect(rate({ screws: 12, seconds: 999, hints: 5, rewinds: 5 }).stars).toBe(1);
  });

  it('良し悪しは星が多い方、同じ星なら速い方', () => {
    expect(better({ stars: 2, seconds: 99 }, { stars: 1, seconds: 10 })).toBe(true);
    expect(better({ stars: 2, seconds: 10 }, { stars: 2, seconds: 20 })).toBe(true);
    expect(better({ stars: 2, seconds: 20 }, { stars: 2, seconds: 20 })).toBe(false);
    expect(better({ stars: 1, seconds: 1 }, { stars: 3, seconds: 90 })).toBe(false);
    expect(better({ stars: 1, seconds: 1 }, null)).toBe(true);
  });

  it('時間の表示は 分:秒', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65.9)).toBe('1:05');
    expect(clock(600)).toBe('10:00');
  });
});

describe('遊んだ時間の時計', () => {
  it('止めている間は数えない', () => {
    let t = 0;
    const c = createPlayClock(() => t);
    expect(c.seconds).toBe(0);
    c.resume();
    t = 5000;
    expect(c.seconds).toBe(5);
    c.pause();
    t = 60000;           // 裏に回っていた・終わりの画面
    expect(c.seconds).toBe(5);
    c.resume();
    c.resume();          // 二重に動かしても数え直さない
    t = 62000;
    expect(c.seconds).toBe(7);
    c.pause();
    c.pause();
    expect(c.seconds).toBe(7);
  });

  it('やり直すと 0 から', () => {
    let t = 1000;
    const c = createPlayClock(() => t);
    c.resume();
    t = 4000;
    c.reset();
    expect(c.seconds).toBe(0);
    expect(c.running).toBe(false);
  });
});

describe('自己ベスト', () => {
  it('初めての記録は更新、良い記録だけ残し、端末に保存する', () => {
    const s = memoryStorage();
    const b = createBests(s);
    expect(b.get(1)).toBeNull();
    expect(b.record(1, { stars: 2, seconds: 50 })).toMatchObject({ improved: true, old: null, best: { stars: 2, seconds: 50 } });
    expect(b.record(1, { stars: 1, seconds: 20 })).toMatchObject({ improved: false, best: { stars: 2, seconds: 50 } });
    expect(b.record(1, { stars: 2, seconds: 40 })).toMatchObject({ improved: true, old: { stars: 2, seconds: 50 } });
    expect(b.record(3, { stars: 3, seconds: 33.333 }).best).toEqual({ stars: 3, seconds: 33.3 });
    expect(createBests(s).get(1)).toEqual({ stars: 2, seconds: 40 });
    expect(createBests(s).get(3)).toEqual({ stars: 3, seconds: 33.3 });
    expect(JSON.parse(s.map.get(BEST_KEY))).toEqual({ 1: { stars: 2, seconds: 40 }, 3: { stars: 3, seconds: 33.3 } });
  });

  it('ステージの到達とは別のキーに置く（到達の保存を壊さない）', () => {
    expect(BEST_KEY).not.toBe(STORAGE_KEY);
  });

  it('壊れた値や読み書きの失敗でも遊べる', () => {
    const broken = memoryStorage();
    broken.setItem(BEST_KEY, '{oops');
    expect(createBests(broken).get(1)).toBeNull();
    const odd = memoryStorage();
    odd.setItem(BEST_KEY, JSON.stringify({ 1: { stars: 9, seconds: 1 }, 2: 'x' }));
    expect(createBests(odd).get(1)).toBeNull();
    expect(createBests(odd).get(2)).toBeNull();
    const failing = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
    const b = createBests(failing);
    expect(b.record(1, { stars: 3, seconds: 10 })).toMatchObject({ improved: true });
    expect(createBests(null).record(1, { stars: 1, seconds: 5 }).improved).toBe(true);
  });
});
