import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TIPS, TIP_IDS, TUTORIAL_KEY, startTips, tapTips, labelScrews, createTutorialStore, tutorialEnabled } from '../src/tutorial.js';
import { clearRecords } from '../src/settings.js';
import { stageLevel, hiddenAtStart, START_VIEW } from '../src/stages.js';
import { blockerFor } from '../src/board.js';
import { newGame, legalMoves } from '../src/rules.js';

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { map: m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const stage = { type: 'stage' };
const level = (n) => stageLevel(n);

describe('導入の表', () => {
  it('どの導入にも一言があり、手の動き・置く所・消え方が決まった値', () => {
    for (const id of TIP_IDS) {
      const t = TIPS[id];
      expect(t.text.length, id).toBeGreaterThan(5);
      expect(t.text.length, `${id} は吹き出しに収まる長さ`).toBeLessThanOrEqual(34);
      expect([null, 'tap', 'swipe', 'point']).toContain(t.hand);
      expect([null, 'screw', 'label', 'board', 'slots', 'tools']).toContain(t.at);
      expect(['tap', 'turn', 'any']).toContain(t.until);
      // 手を出すなら置く所がある
      if (t.hand) expect(t.at, id).not.toBeNull();
    }
  });
});

describe('いつ何を見せるか', () => {
  it('ステージ 1 はタップ、2 は札、4 は中の板、8（車）は部品。3・5・6・7 は盤面を開いただけでは何も出さない', () => {
    const at = (n) => startTips({ mode: stage, stage: n, level: level(n) });
    expect(at(1)).toEqual(['tap']);
    expect(at(2)).toEqual(['label']);
    expect(at(3)).toEqual([]);
    expect(at(4)).toEqual(['inner']);
    for (const n of [5, 6, 7]) expect(at(n), `ステージ ${n}`).toEqual([]);
    expect(at(8)).toEqual(['parts']);
  });

  it('ステージの番号で教えることは、ステージを遊んでいる時だけ（おまかせの題材では部品だけ）', () => {
    expect(startTips({ mode: { type: 'random' }, stage: 1, level: level(1) })).toEqual([]);
    expect(startTips({ mode: { type: 'daily' }, stage: 4, level: level(8) })).toEqual(['parts']);
  });

  it('タップの後: 外せない理由・待機スロット・詰みかけ・ステージ 1 で見える面が空になった時', () => {
    const base = { events: [], slotsFree: 5, visibleLegal: 3, stage: 5, status: 'playing' };
    expect(tapTips({ ...base, reason: 'held' })).toEqual(['held']);
    expect(tapTips({ ...base, reason: 'blocked' })).toEqual([]);
    expect(tapTips({ ...base, reason: 'full' })).toEqual(['rescue']);
    expect(tapTips({ ...base, reason: 'ok' })).toEqual([]);
    expect(tapTips({ ...base, reason: 'ok', events: [{ type: 'toBox' }] })).toEqual([]);
    expect(tapTips({ ...base, reason: 'ok', events: [{ type: 'toSlot' }] })).toEqual(['slot']);
    expect(tapTips({ ...base, reason: 'ok', events: [{ type: 'toSlot' }], slotsFree: 1 })).toEqual(['slot', 'rescue']);
    expect(tapTips({ ...base, reason: 'ok', stage: 1, visibleLegal: 0 })).toEqual(['turn']);
    expect(tapTips({ ...base, reason: 'ok', stage: 2, visibleLegal: 0 })).toEqual([]);
    expect(tapTips({ ...base, reason: 'ok', stage: 1, visibleLegal: 2 })).toEqual([]);
    // 決着のタップの後は何も出さない
    expect(tapTips({ ...base, reason: 'ok', stage: 1, visibleLegal: 0, status: 'cleared' })).toEqual([]);
  });

  it('札の手本は、札の上の外せるねじに置く', () => {
    const l = level(2);
    const legal = legalMoves(newGame(l), blockerFor(l));
    const on = labelScrews(l, legal);
    expect(on.length).toBeGreaterThan(0);
    for (const id of on) expect(l.screws.find((s) => s.id === id).plate.startsWith('label')).toBe(true);
    expect(labelScrews(level(1), legalMoves(newGame(level(1)), blockerFor(level(1))))).toEqual([]);
  });
});

describe('ステージ 1〜4 と 8 の盤面が教えたい事を含む', () => {
  const facesAway = (l) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...START_VIEW));
    const legal = legalMoves(newGame(l), blockerFor(l));
    // 最初の向きでカメラ（+z）から見て向こうを向いている、外せるねじ
    return legal.filter((id) => new THREE.Vector3(...l.screws.find((s) => s.id === id).dir).applyQuaternion(q).z < 0);
  };
  it('1: 最初の向きで見えない面にも、外せるねじがある（回して探す）', () => {
    expect(facesAway(level(1)).length).toBeGreaterThan(0);
  });
  it('2: 札の下に隠れたねじがある', () => {
    expect(hiddenAtStart(level(2))).toBeGreaterThanOrEqual(1);
  });
  it('4: 中の板のねじは、始めは外の板に隠れている', () => {
    const l = level(4);
    const inner = new Set(l.plates.filter((p) => p.id.startsWith('shelf') || p.id.startsWith('wall')).map((p) => p.id));
    const st = newGame(l), b = blockerFor(l);
    const innerScrews = l.screws.filter((s) => inner.has(s.plate));
    expect(innerScrews.length).toBeGreaterThan(0);
    expect(innerScrews.some((s) => b(s.id, st))).toBe(true);
  });
  it('8: 車は親子の部品でできている（子の部品が残る間は親の最後のねじが外せない）', () => {
    const l = level(8);
    expect(l.meta.kind).toBe('car');
    expect(l.plates.some((p) => p.parent && !p.id.startsWith('label'))).toBe(true);
  });
});

describe('一度見せたものは出さない', () => {
  it('見せた導入を覚え、開き直しても出さない', () => {
    const storage = memoryStorage();
    const a = createTutorialStore(storage);
    expect(a.fresh(['tap', 'turn'])).toEqual(['tap', 'turn']);
    a.mark('tap');
    expect(a.fresh(['tap', 'turn'])).toEqual(['turn']);
    const b = createTutorialStore(storage);
    expect(b.has('tap')).toBe(true);
    expect(b.fresh(['tap', 'turn', 'tap', 'nope'])).toEqual(['turn']);
    expect(JSON.parse(storage.getItem(TUTORIAL_KEY))).toEqual(['tap']);
  });

  it('ステージ 1 から順に遊ぶ流れで、各導入はちょうど1回ずつ', () => {
    const store = createTutorialStore(memoryStorage());
    const shown = [];
    const show = (ids) => {
      for (const id of store.fresh(ids)) {
        store.mark(id);
        shown.push(id);
      }
    };
    const ok = { reason: 'ok', events: [], slotsFree: 5, visibleLegal: 3, status: 'playing' };
    for (let round = 0; round < 2; round++) {   // もう一度同じ流れを遊んでも、何も出ない
      for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
        show(startTips({ mode: stage, stage: n, level: level(n) }));
        show(tapTips({ ...ok, stage: n }));
        if (n === 1) show(tapTips({ ...ok, stage: 1, visibleLegal: 0 }));
        show(tapTips({ ...ok, stage: n, events: [{ type: 'toSlot' }], slotsFree: 4 }));
        show(tapTips({ ...ok, stage: n, events: [{ type: 'toSlot' }], slotsFree: 1 }));
        show(tapTips({ ...ok, stage: n, reason: 'held' }));
        show(tapTips({ ...ok, stage: n, reason: 'full' }));
      }
    }
    expect(shown.sort()).toEqual([...TIP_IDS].sort());
  });

  it('記録を消すと、導入もまた出る（設定は残す）', () => {
    const storage = memoryStorage({ 'screw-puzzle-3d.settings': '{"sound":false}' });
    createTutorialStore(storage).mark('tap');
    clearRecords(storage);
    expect(createTutorialStore(storage).has('tap')).toBe(false);
    expect(storage.getItem('screw-puzzle-3d.settings')).not.toBeNull();
  });

  it('壊れた保存や保存できない端末でも動く', () => {
    expect(createTutorialStore(memoryStorage({ [TUTORIAL_KEY]: '{oops' })).seen).toEqual([]);
    expect(createTutorialStore(memoryStorage({ [TUTORIAL_KEY]: '["tap","zzz"]' })).seen).toEqual(['tap']);
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    const s = createTutorialStore(broken);
    s.mark('turn');
    expect(s.has('turn')).toBe(true);
    const none = createTutorialStore(null);
    none.mark('tap');
    expect(none.has('tap')).toBe(true);
  });
});

describe('導入を出すか', () => {
  const q = (s) => new URLSearchParams(s);
  it('ふだんは出す。自由な盤面と ?tutorial=off では出さない。自動の操作では ?tutorial=on の時だけ', () => {
    expect(tutorialEnabled({ query: q(''), webdriver: false, freePlay: false })).toBe(true);
    expect(tutorialEnabled({ query: q('tutorial=off'), webdriver: false, freePlay: false })).toBe(false);
    expect(tutorialEnabled({ query: q('seed=3'), webdriver: false, freePlay: true })).toBe(false);
    expect(tutorialEnabled({ query: q(''), webdriver: true, freePlay: false })).toBe(false);
    expect(tutorialEnabled({ query: q('tutorial=on'), webdriver: true, freePlay: false })).toBe(true);
  });
});
