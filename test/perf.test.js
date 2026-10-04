// 速さの計器（E11）: フレーム時間のまとめと、画質「自動」で解像度を下げる判断
import { describe, it, expect } from 'vitest';
import { summarize, slowFrames, createPerf, WATCH_FRAMES, STALL_MS } from '../src/perf.js';

const feed = (intervals) => {
  const times = [];
  return intervals.map((t) => slowFrames(times, t));
};

describe('解像度を下げる判断（slowFrames）', () => {
  it('60fps で描けていれば下げない', () => {
    expect(feed(Array(200).fill(16.7)).some(Boolean)).toBe(false);
  });

  it('続けて 30fps なら 40 フレームで下げる', () => {
    const v = feed(Array(WATCH_FRAMES).fill(33));
    expect(v.at(-1)).toBe(true);
    expect(v.slice(0, -1).some(Boolean)).toBe(false);
  });

  it('とても遅い端末（6fps）でも 40 フレームを待たず、1.5 秒分で下げる', () => {
    const v = feed(Array(20).fill(160));
    expect(v.indexOf(true)).toBe(9);
  });

  it('遅い端末の引っかかり（100〜250ms）が混じっても、ためた分を捨てずに下げる', () => {
    const slow = Array.from({ length: 80 }, (_, i) => (i % 7 === 3 ? 180 : 40));
    expect(feed(slow).some(Boolean)).toBe(true);
  });

  it('指を一瞬止めた長い間隔が数個あっても、ふだん 60fps なら下げない（中央値で見る）', () => {
    const v = Array.from({ length: 120 }, (_, i) => (i % 15 === 0 ? 200 : 16.7));
    expect(feed(v).some(Boolean)).toBe(false);
  });

  it('止まっていた後の間隔（250ms 超）と最初のフレームは数えない', () => {
    const times = [];
    expect(slowFrames(times, null)).toBe(false);
    expect(slowFrames(times, STALL_MS + 1)).toBe(false);
    expect(times).toHaveLength(0);
  });
});

describe('フレーム時間のまとめ', () => {
  it('平均・p95・最大・40fps を切った割合', () => {
    const s = summarize([10, 20, 30, 40]);
    expect(s.avg).toBe(25);
    expect(s.max).toBe(40);
    expect(s.p95).toBe(40);
    expect(s.slow).toBe(0.5);
    expect(summarize([]).frames).toBe(0);
  });

  it('止まっていた後の1フレームは間隔に入れず、描いた回数には入れる', () => {
    let t = 0;
    const perf = createPerf({ now: () => t });
    for (const at of [0, 16, 32, 500, 516]) perf.frame(at, 1);
    const s = perf.stats();
    expect(s.drawn).toBe(5);
    expect(s.frames).toBe(3);
    expect(s.avg).toBeCloseTo(16);
  });
});
