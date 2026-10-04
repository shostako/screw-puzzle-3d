import { describe, it, expect } from 'vitest';
import { chapterView, chapterList, totalStars, finishesChapter, newKinds, KIND_NAMES } from '../src/chapters.js';
import { createProgress, STORAGE_KEY as STAGE_KEY } from '../src/progress.js';
import { createBests, BEST_KEY } from '../src/rating.js';
import { createSettings, SETTINGS_KEY } from '../src/settings.js';
import { RESUME_KEY } from '../src/resume.js';
import { CHAPTERS } from '../src/stages.js';

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { map: m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

describe('章ごとのステージ一覧（E9）', () => {
  it('到達より前はクリア済み（自己ベストの星）、到達は次、先は鍵', () => {
    const st = memoryStorage({ [BEST_KEY]: JSON.stringify({ 11: { stars: 3, seconds: 40 }, 12: { stars: 1, seconds: 99 } }) });
    const v = chapterView(2, 14, createBests(st));
    expect(v.title).toBe(CHAPTERS[1].title);
    expect([v.first, v.last]).toEqual([11, 20]);
    expect(v.stages.map((s) => s.state)).toEqual(['cleared', 'cleared', 'cleared', 'next', ...Array(6).fill('locked')]);
    // 13 はクリア済みだが自己ベストが無い（?stage= で飛ばした等）ので星 0
    expect(v.stages.slice(0, 4).map((s) => s.stars)).toEqual([3, 1, 0, 0]);
    expect([v.stars, v.max, v.open, v.done, v.perfect]).toEqual([4, 30, true, false, false]);
  });

  it('章を全部 ★3 で終えると perfect（王冠）', () => {
    const all = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, { stars: 3, seconds: 10 }]));
    const v = chapterView(1, 11, createBests(memoryStorage({ [BEST_KEY]: JSON.stringify(all) })));
    expect([v.done, v.perfect, v.stars]).toEqual([true, true, 30]);
    expect(chapterView(1, 10, createBests(memoryStorage({ [BEST_KEY]: JSON.stringify(all) }))).perfect).toBe(false);
  });

  it('一覧は到達した章までと、次の章を1つ（鍵）', () => {
    const b = createBests(memoryStorage());
    expect(chapterList(1, b).map((c) => [c.no, c.open])).toEqual([[1, true], [2, false]]);
    expect(chapterList(10, b).map((c) => c.no)).toEqual([1, 2]);
    expect(chapterList(11, b).map((c) => [c.no, c.open])).toEqual([[1, true], [2, true], [3, false]]);
    // 7 章から先（組を回す）でも番号は続く
    expect(chapterList(75, b).at(-1).no).toBe(9);
  });

  it('星の合計はクリア済みのステージの自己ベストだけ数える', () => {
    const b = createBests(memoryStorage({ [BEST_KEY]: JSON.stringify({ 1: { stars: 3, seconds: 5 }, 2: { stars: 2, seconds: 5 }, 'daily-20261003': { stars: 3, seconds: 5 } }) }));
    expect(totalStars(3, b)).toBe(5);
    expect(totalStars(2, b)).toBe(3);
  });

  it('章の終わりの演出は、章の 10 番目を初めてクリアしたときだけ', () => {
    expect(finishesChapter(10, 10)).toBe(true);
    expect(finishesChapter(20, 20)).toBe(true);
    expect(finishesChapter(10, 11)).toBe(false);   // 遊び直し
    expect(finishesChapter(10, 35)).toBe(false);
    expect(finishesChapter(9, 9)).toBe(false);
  });

  it('章ごとの新しい題材（お披露目）と名前', () => {
    expect(newKinds(1).sort()).toEqual(['box', 'car', 'house', 'shelf', 'table'].sort());
    expect(newKinds(2)).toEqual(['robot', 'animal']);
    expect(newKinds(3)).toEqual(['plane', 'ship']);
    expect(newKinds(4)).toEqual(['rocket', 'train']);
    expect(newKinds(5)).toEqual(['camera']);
    expect(newKinds(6)).toEqual([]);
    expect(newKinds(8)).toEqual([]);
    for (const c of CHAPTERS) for (const k of c.kinds) expect(KIND_NAMES[k]).toBeTruthy();
  });
});

describe('遊び直しと既存の記録（E9）', () => {
  it('クリア済みのステージを遊び直してクリアしても、到達は戻らない（再読み込みの後も）', () => {
    const st = memoryStorage({ [STAGE_KEY]: '23' });
    const p = createProgress(st);
    expect(p.cleared(5)).toBe(23);
    expect(p.cleared(20)).toBe(23);
    expect(createProgress(st).stage).toBe(23);
    // 到達のステージをクリアすれば進む
    expect(p.cleared(23)).toBe(24);
    expect(createProgress(st).stage).toBe(24);
  });

  it('遊び直しで悪い結果を出しても自己ベストは残り、良い結果なら章の星が増える', () => {
    const st = memoryStorage({ [STAGE_KEY]: '12', [BEST_KEY]: JSON.stringify({ 3: { stars: 3, seconds: 30 }, 4: { stars: 1, seconds: 80 } }) });
    const b = createBests(st);
    b.record(3, { stars: 1, seconds: 200 });
    b.record(4, { stars: 3, seconds: 20 });
    const again = createBests(st);
    expect(again.get(3)).toEqual({ stars: 3, seconds: 30 });
    expect(again.get(4)).toEqual({ stars: 3, seconds: 20 });
    expect(chapterView(1, 12, again).stars).toBe(6);
  });

  it('一覧を組み立てても保存は書き換えない（到達・自己ベスト・設定・途中の局面がそのまま残る）', () => {
    const init = {
      [STAGE_KEY]: '17',
      [BEST_KEY]: JSON.stringify({ 1: { stars: 3, seconds: 12.5 }, 16: { stars: 2, seconds: 61 }, 'daily-20261003': { stars: 3, seconds: 50 } }),
      [SETTINGS_KEY]: JSON.stringify({ sound: false, speed: 'fast' }),
      [RESUME_KEY]: '{"v":1,"mode":{"type":"stage"},"stage":17}',
    };
    const st = memoryStorage(init);
    const p = createProgress(st), b = createBests(st);
    chapterList(p.stage, b);
    totalStars(p.stage, b);
    expect(Object.fromEntries(st.map)).toEqual(init);
    expect(p.stage).toBe(17);
    expect(createSettings(st).get('speed')).toBe('fast');
    expect(chapterView(2, p.stage, b).stages[5]).toEqual({ n: 16, state: 'cleared', stars: 2 });
  });
});
