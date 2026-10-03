import { describe, it, expect } from 'vitest';
import {
  newGame, removeScrew, checkRemove, legalMoves, status, openBoxFor, plateState, plateStateOf, validateLevel,
  SLOT_COUNT,
} from '../src/rules.js';

// 小さな盤面を短く書く: screws は [id, 板, 色] の並び
function level(plates, screws, queue) {
  return {
    plates: plates.map(id => ({ id })),
    screws: screws.map(([id, plate, color]) => ({ id, plate, color })),
    queue,
  };
}

// 順に外す。どれか外せなければ例外
function play(st, ids, isBlocked) {
  for (const id of ids) {
    const r = removeScrew(st, id, isBlocked);
    if (!r.ok) throw new Error(`${id} を外せない: ${r.reason}`);
    st = r.state;
  }
  return st;
}

// テスト用の隠れ判定: covers[ねじ] に挙げた板に1本でもねじが残っていれば隠れている
// （M3 の 3D の隠れ判定は、この形の関数を作って渡す）
const coverBlocker = covers => (id, st) => (covers[id] || []).some(p => plateState(st, p) !== 'fallen');

// 3色・各3本。箱は 赤 → 緑 → 青 の順
const RGB = level(['A', 'B', 'C'], [
  ['r1', 'A', 'red'], ['r2', 'B', 'red'], ['r3', 'C', 'red'],
  ['g1', 'A', 'green'], ['g2', 'B', 'green'], ['g3', 'C', 'green'],
  ['b1', 'A', 'blue'], ['b2', 'B', 'blue'], ['b3', 'C', 'blue'],
], ['red', 'green', 'blue']);

describe('板の状態', () => {
  it('ねじ2本以上で固定、1本でぶら下がり、0本で落下', () => {
    expect(plateStateOf(3)).toBe('fixed');
    expect(plateStateOf(2)).toBe('fixed');
    expect(plateStateOf(1)).toBe('hanging');
    expect(plateStateOf(0)).toBe('fallen');
  });

  it('ねじを外すたびに 固定 → ぶら下がり → 落下 と移り、その出来事を返す', () => {
    let st = newGame(RGB);
    expect(plateState(st, 'A')).toBe('fixed');
    let r = removeScrew(st, 'r1');
    expect(plateState(r.state, 'A')).toBe('fixed');          // 3本 → 2本はまだ固定
    expect(r.events.some(e => e.type === 'plate')).toBe(false);
    r = removeScrew(r.state, 'g1');
    expect(plateState(r.state, 'A')).toBe('hanging');
    expect(r.events).toContainEqual({ type: 'plate', plate: 'A', from: 'fixed', to: 'hanging' });
    r = removeScrew(r.state, 'b1');
    expect(plateState(r.state, 'A')).toBe('fallen');
    expect(r.events).toContainEqual({ type: 'plate', plate: 'A', from: 'hanging', to: 'fallen' });
  });
});

describe('盤面の検査', () => {
  it('色ごとのねじの本数が 箱の数 × 3 でなければ受け付けない', () => {
    expect(() => validateLevel(level(['A'], [['x', 'A', 'red'], ['y', 'A', 'red']], ['red']))).toThrow();
    expect(() => validateLevel(level(['A'], [['x', 'A', 'red'], ['y', 'A', 'red'], ['z', 'A', 'red']], ['red', 'blue']))).toThrow();
  });

  it('ねじの板が無い、id が重複しているものは受け付けない', () => {
    expect(() => validateLevel(level(['A'], [['x', 'Z', 'red'], ['y', 'A', 'red'], ['z', 'A', 'red']], ['red']))).toThrow();
    expect(() => validateLevel(level(['A'], [['x', 'A', 'red'], ['x', 'A', 'red'], ['z', 'A', 'red']], ['red']))).toThrow();
  });

  it('正しい盤面は通る', () => {
    expect(() => validateLevel(RGB)).not.toThrow();
  });
});

describe('箱', () => {
  it('始めは queue の先頭から2つの箱が出ていて、待機スロットは空', () => {
    const st = newGame(RGB);
    expect(st.boxes.map(b => b.color)).toEqual(['red', 'green']);
    expect(st.slots).toEqual(new Array(SLOT_COUNT).fill(null));
  });

  it('ねじは同じ色の箱へ入る', () => {
    const r = removeScrew(newGame(RGB), 'g1');
    expect(r.events[0]).toEqual({ type: 'toBox', screw: 'g1', box: 1 });
    expect(r.state.boxes[1].n).toBe(1);
    expect(r.state.where.g1).toBe('box');
  });

  it('同じ色の箱が2つ出ていたら、多く入っている方へ入る', () => {
    const L = level(['A'], [
      ['a1', 'A', 'red'], ['a2', 'A', 'red'], ['a3', 'A', 'red'],
      ['a4', 'A', 'red'], ['a5', 'A', 'red'], ['a6', 'A', 'red'],
    ], ['red', 'red']);
    let st = newGame(L);
    expect(openBoxFor(st, 'red')).toBe(0);     // どちらも0本なら先の方
    st = play(st, ['a1']);
    expect(st.boxes.map(b => b.n)).toEqual([1, 0]);
    st = play(st, ['a2']);
    expect(st.boxes.map(b => b.n)).toEqual([2, 0]);   // 空の方へ分けずに、多い方へ重ねる
  });

  it('3本で満杯になると消え、同じ位置に次の箱が出る', () => {
    const r = removeScrew(play(newGame(RGB), ['r1', 'r2']), 'r3');
    expect(r.events).toEqual([
      { type: 'toBox', screw: 'r3', box: 0 },
      { type: 'boxFull', box: 0, color: 'red' },
      { type: 'boxSpawn', box: 0, color: 'blue' },
    ]);
    expect(r.state.boxes[0]).toEqual({ color: 'blue', n: 0, order: 2 });
    expect(r.state.filled).toBe(1);
  });

  it('出す箱が無くなった位置は空になる', () => {
    const st = play(newGame(RGB), ['r1', 'r2', 'r3', 'g1', 'g2', 'g3']);
    expect(st.boxes[0].color).toBe('blue');
    expect(st.boxes[1]).toBeNull();
  });
});

describe('待機スロット', () => {
  it('合う箱が無いねじは、空いている一番若いスロットへ入る', () => {
    const r = removeScrew(newGame(RGB), 'b1');
    expect(r.events[0]).toEqual({ type: 'toSlot', screw: 'b1', slot: 0 });
    expect(r.state.where.b1).toBe('slot');
    const r2 = removeScrew(r.state, 'b2');
    expect(r2.state.slots.slice(0, 2)).toEqual(['b1', 'b2']);
  });

  it('新しい箱が出ると、スロットの同じ色のねじが自動で移る', () => {
    let st = play(newGame(RGB), ['b1', 'b2', 'r1', 'r2']);
    const r = removeScrew(st, 'r3');
    expect(r.events).toContainEqual({ type: 'slotToBox', screw: 'b1', slot: 0, box: 0 });
    expect(r.events).toContainEqual({ type: 'slotToBox', screw: 'b2', slot: 1, box: 0 });
    expect(r.state.boxes[0]).toEqual({ color: 'blue', n: 2, order: 2 });
    expect(r.state.slots).toEqual(new Array(SLOT_COUNT).fill(null));
    expect(r.state.where.b1).toBe('box');
  });

  it('移しただけで満杯になった箱はそのまま消え、次の箱が出る', () => {
    const L = level(['A'], [
      ['r1', 'A', 'red'], ['r2', 'A', 'red'], ['r3', 'A', 'red'],
      ['g1', 'A', 'green'], ['g2', 'A', 'green'], ['g3', 'A', 'green'],
      ['b1', 'A', 'blue'], ['b2', 'A', 'blue'], ['b3', 'A', 'blue'],
      ['y1', 'A', 'yellow'], ['y2', 'A', 'yellow'], ['y3', 'A', 'yellow'],
    ], ['red', 'green', 'blue', 'yellow']);
    const st = play(newGame(L), ['b1', 'b2', 'b3', 'y1', 'r1', 'r2']);
    const r = removeScrew(st, 'r3');
    expect(r.events.map(e => e.type)).toEqual([
      'toBox', 'boxFull', 'boxSpawn', 'slotToBox', 'slotToBox', 'slotToBox', 'boxFull', 'boxSpawn', 'slotToBox',
    ]);
    expect(r.state.boxes[0]).toEqual({ color: 'yellow', n: 1, order: 3 });
    expect(r.state.slots).toEqual(new Array(SLOT_COUNT).fill(null));
    expect(r.state.filled).toBe(2);
  });

  it('スロットが満杯で合う箱も無いねじは外せず、状態は変わらない', () => {
    const L = level(['A'], [
      ['r1', 'A', 'red'], ['r2', 'A', 'red'], ['r3', 'A', 'red'],
      ['g1', 'A', 'green'], ['g2', 'A', 'green'], ['g3', 'A', 'green'],
      ['b1', 'A', 'blue'], ['b2', 'A', 'blue'], ['b3', 'A', 'blue'],
      ['y1', 'A', 'yellow'], ['y2', 'A', 'yellow'], ['y3', 'A', 'yellow'],
    ], ['red', 'green', 'blue', 'yellow']);
    const st = play(newGame(L), ['b1', 'b2', 'b3', 'y1', 'y2']);
    const r = removeScrew(st, 'y3');
    expect(r).toEqual({ ok: false, reason: 'full', state: st, events: [] });
    expect(checkRemove(st, 'r1')).toBe('ok');   // 合う箱があるねじは、スロットが満杯でも外せる
  });
});

describe('外せるかの判定', () => {
  it('外から渡した判定で隠れているねじは外せない', () => {
    const st = newGame(RGB);
    const hideR1 = id => id === 'r1';
    expect(checkRemove(st, 'r1', hideR1)).toBe('blocked');
    expect(removeScrew(st, 'r1', hideR1)).toMatchObject({ ok: false, reason: 'blocked', state: st });
    expect(legalMoves(st, hideR1)).not.toContain('r1');
  });

  it('判定には今の状態が渡り、板が落ちれば隠れなくなる', () => {
    const blocked = coverBlocker({ r2: ['A'] });
    let st = newGame(RGB);
    expect(checkRemove(st, 'r2', blocked)).toBe('blocked');
    st = play(st, ['r1', 'g1'], blocked);
    expect(checkRemove(st, 'r2', blocked)).toBe('blocked');   // ぶら下がっている間も隠している
    st = play(st, ['b1'], blocked);
    expect(checkRemove(st, 'r2', blocked)).toBe('ok');
  });

  it('もう外したねじは外せない', () => {
    const st = play(newGame(RGB), ['r1']);
    expect(checkRemove(st, 'r1')).toBe('gone');
  });

  it('外しても元の状態は書き換わらない', () => {
    const st = newGame(RGB);
    const snap = JSON.stringify(st);
    play(st, ['r1', 'b1', 'g1']);
    expect(JSON.stringify(st)).toBe(snap);
  });
});

// 手で書いた小さな盤面: 蓋の板 L（ねじ4本）が、底の板 F と G のねじを隠している
//   L: 赤 l1, 緑 l2, 青 l3, 青 l4
//   F: 赤 f1, 赤 f2, 緑 f3   （L が落ちるまで隠れている）
//   G: 緑 g1, 青 g2           （L が落ちるまで隠れている）
// 箱の順番: 赤 → 青 → 緑
const BOX = level(['L', 'F', 'G'], [
  ['l1', 'L', 'red'], ['l2', 'L', 'green'], ['l3', 'L', 'blue'], ['l4', 'L', 'blue'],
  ['f1', 'F', 'red'], ['f2', 'F', 'red'], ['f3', 'F', 'green'],
  ['g1', 'G', 'green'], ['g2', 'G', 'blue'],
], ['red', 'blue', 'green']);
const BOX_COVERS = { f1: ['L'], f2: ['L'], f3: ['L'], g1: ['L'], g2: ['L'] };

describe('1局を最後まで', () => {
  it('手で書いた盤面をクリアまで進められる', () => {
    const blocked = coverBlocker(BOX_COVERS);
    let st = newGame(BOX);
    expect(status(st, blocked)).toBe('playing');
    expect(legalMoves(st, blocked).sort()).toEqual(['l1', 'l2', 'l3', 'l4']);
    st = play(st, ['l1', 'l2', 'l3'], blocked);        // l2 は合う箱が無いのでスロットへ
    expect(st.slots[0]).toBe('l2');
    expect(plateState(st, 'L')).toBe('hanging');
    expect(legalMoves(st, blocked)).toEqual(['l4']);   // 1本でぶら下がった蓋はまだ下を隠す
    st = play(st, ['l4'], blocked);
    expect(plateState(st, 'L')).toBe('fallen');
    st = play(st, ['f1', 'f2'], blocked);              // 赤が満杯 → 緑の箱が出て l2 が移る
    expect(st.boxes[0]).toEqual({ color: 'green', n: 1, order: 2 });
    st = play(st, ['g2', 'g1', 'f3'], blocked);
    expect(status(st, blocked)).toBe('cleared');
    expect(st.boxes).toEqual([null, null]);
    expect(Object.values(st.left).every(n => n === 0)).toBe(true);
  });

  it('手で書いた別の盤面を詰みまで進められる', () => {
    // 蓋 L のねじは緑と黄だけで、その箱は赤と青の後。蓋を外していくと緑と黄が待機スロットにたまり、
    // 満杯になったところで、蓋の最後の1本は入れる所が無く、底のねじは蓋に隠れたまま
    const L2 = level(['L', 'F'], [
      ['l1', 'L', 'green'], ['l2', 'L', 'green'], ['l3', 'L', 'yellow'], ['l4', 'L', 'yellow'], ['l5', 'L', 'green'],
      ['l6', 'L', 'yellow'],
      ['f1', 'F', 'red'], ['f2', 'F', 'red'], ['f3', 'F', 'red'], ['f4', 'F', 'blue'], ['f5', 'F', 'blue'], ['f6', 'F', 'blue'],
    ], ['red', 'blue', 'yellow', 'green']);
    const b2 = coverBlocker({ f1: ['L'], f2: ['L'], f3: ['L'], f4: ['L'], f5: ['L'], f6: ['L'] });
    let st = play(newGame(L2), ['l1', 'l2', 'l3', 'l4', 'l5'], b2);
    expect(st.slots.every(x => x !== null)).toBe(true);
    expect(plateState(st, 'L')).toBe('hanging');
    expect(checkRemove(st, 'l6', b2)).toBe('full');
    expect(checkRemove(st, 'f1', b2)).toBe('blocked');
    expect(legalMoves(st, b2)).toEqual([]);
    expect(status(st, b2)).toBe('stuck');
  });

  it('スロットに空きがあっても、どのねじも隠れていれば詰み', () => {
    const blocked = () => true;
    expect(status(newGame(RGB), blocked)).toBe('stuck');
  });

  it('ねじがすべて盤面から無くなっても箱が残れば詰み（スロットのねじが入る箱が来ない）', () => {
    // 検査で弾く形なので、状態を直接作る
    const st = newGame(RGB);
    const broken = { ...st, where: Object.fromEntries(Object.keys(st.where).map(k => [k, 'box'])) };
    expect(status(broken)).toBe('stuck');
  });
});

describe('部品の親子（D5）', () => {
  // body の子が wheel、wheel の子が cap。どれも 2 本。赤 2 箱
  const tree = () => {
    const lv = level(['body', 'wheel', 'cap'], [
      ['b1', 'body', 'red'], ['b2', 'body', 'red'], ['w1', 'wheel', 'red'], ['w2', 'wheel', 'red'], ['c1', 'cap', 'red'], ['c2', 'cap', 'red'],
    ], ['red', 'red']);
    lv.plates[1].parent = 'body';
    lv.plates[2].parent = 'wheel';
    return lv;
  };

  it('子の板が残っている間は、親の最後のねじは外せない（held）。ぶら下げるまでは外せる', () => {
    let st = newGame(tree());
    st = play(st, ['b1']);
    expect(plateState(st, 'body')).toBe('hanging');
    expect(checkRemove(st, 'b2')).toBe('held');
    const r = removeScrew(st, 'b2');
    expect(r.ok).toBe(false);
    expect(r.state).toBe(st);
    expect(legalMoves(st)).not.toContain('b2');
  });

  it('子が落ちれば親を落とせる。孫が残っていれば子も落とせない', () => {
    let st = newGame(tree());
    st = play(st, ['b1', 'w1']);
    expect(checkRemove(st, 'w2')).toBe('held');   // cap が残っている
    st = play(st, ['c1', 'c2']);
    expect(checkRemove(st, 'b2')).toBe('held');   // wheel が残っている
    st = play(st, ['w2', 'b2']);
    expect(status(st)).toBe('cleared');
  });

  it('子が残っていても、親のねじが 2 本以上残るうちは外せる。隠れているかより先に held を返す', () => {
    const st = newGame(tree());
    expect(checkRemove(st, 'b1')).toBe('ok');
    const s2 = play(st, ['b1']);
    expect(checkRemove(s2, 'b2', () => true)).toBe('held');
  });

  it('親を外せないだけで外せるねじが無くなれば詰み', () => {
    const lv = tree();
    // cap のねじが全部隠れている（隠しているのは盤面に無いもの扱いの仮の判定）と、body も wheel も落とせない
    let st = play(newGame(lv), ['b1', 'w1']);
    expect(status(st, (id) => id.startsWith('c'))).toBe('stuck');
  });

  it('親の id が無い板は受け付けない', () => {
    const lv = tree();
    lv.plates[2].parent = 'nothing';
    expect(() => validateLevel(lv)).toThrow(/親/);
  });
});
