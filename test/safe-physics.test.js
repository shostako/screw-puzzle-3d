// 安全側の見積もり（safe.js）が、実際の物理（physics.js）より甘くないことを確かめる。
// 生成した盤面の手順を物理つきで再生し、どの場面でも
//   ・物理で（今の姿勢で）ねじを隠している板は、見積もりでもそのねじを隠している
//   ・最後のねじを外した板は、立体を傾けると盤面から落ちきる（見積もりは「抜け出せる」とみなしている）
// ことを調べる。傾ける向きは軸の6方向に加え、斜めの向きにも倒して、ぶら下がった板を別の姿勢にしてから比べる。
// 手元では 1〜1000 のシードで確かめた（ROADMAP の M6）。CI では数を絞って回す。
import { describe, it, expect, beforeAll } from 'vitest';
import { generateLevel } from '../src/generator.js';
import { createSafeModel } from '../src/safe.js';
import { sweepHits } from '../src/board.js';
import { newGame, removeScrew, isCleared } from '../src/rules.js';
import { initPhysics, createPhysics, syncPlates } from '../src/physics.js';
import { BOX_LEVEL } from '../src/levels/box.js';
import { solve } from '../src/solve.js';

beforeAll(() => initPhysics());

const DOWNS = [[0, -1, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, 1, 0]];

function settle(ph, n = 900) {
  for (let i = 0; i < n; i++) {
    ph.step();
    if (i > 10 && !ph.moving()) break;
  }
}

// 物理で隠れているのに、見積もりでは隠れていないねじ（ぶら下がりと固定の板だけを数える。落ちた板は払い落とす前提）
function optimistic(level, ph, st, model) {
  const solid = level.plates.filter((p) => ph.mode(p.id) === 'fixed' || ph.mode(p.id) === 'hanging');
  const poses = ph.poses();
  return level.screws
    .filter((s) => st.where[s.id] === 'board')
    .filter((s) => sweepHits(level, s.id, { plates: solid, poses }).length && !model.covered(s.id, st))
    .map((s) => s.id);
}

// 手順を物理つきで再生し、見積もりが甘かった場面を集める
function crossCheck(level, path, tilt) {
  const model = createSafeModel(level);
  const ph = createPhysics(level);
  const errs = [];
  const look = (where, st) => {
    const bad = optimistic(level, ph, st, model);
    if (bad.length) errs.push(`${where}: ${bad.join(',')}`);
  };
  let st = newGame(level);
  syncPlates(ph, st);
  settle(ph);
  look('始め', st);
  path.forEach((id, n) => {
    const r = removeScrew(st, id, model.blocker);
    if (!r.ok) { errs.push(`${id}: ${r.reason}`); return; }
    st = r.state;
    syncPlates(ph, st);
    settle(ph);
    look(`${id} の後`, st);
    // 落ちた板が残っていれば、傾けて払い落とす
    const loose = () => level.plates.filter((p) => ph.mode(p.id) === 'loose').map((p) => p.id);
    for (let k = 0; k < 12 && loose().length; k++) {
      ph.setDown(DOWNS[k % DOWNS.length]);
      settle(ph);
      look(`${id} の後に傾けて`, st);
    }
    if (loose().length) errs.push(`${id} の後、払い落とせない板: ${loose()}`);
    // 斜めに倒して、ぶら下がった板を別の向きに振る
    ph.setDown(tilt(n));
    settle(ph);
    look(`${id} の後に斜めに倒して`, st);
    ph.setDown([0, -1, 0]);
    settle(ph);
    look(`${id} の後に戻して`, st);
  });
  ph.free();
  if (!isCleared(st)) errs.push('クリアにならない');
  return errs;
}

const tiltFor = (seed) => (n) => [Math.sin(seed * 7 + n * 3), -0.5 + Math.cos(seed * 5 + n * 11), Math.sin(seed * 13 + n)];

describe('安全側の見積もりは物理より甘くない', () => {
  it('固定の箱の盤面', () => {
    const path = solve(BOX_LEVEL, createSafeModel(BOX_LEVEL).blocker, { budget: 20000 });
    expect(crossCheck(BOX_LEVEL, path, tiltFor(0))).toEqual([]);
  });

  for (const kind of ['box', 'shelf', 'table']) {
    it(`生成した盤面（${kind}）`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const level = generateLevel(seed, { kind });
        expect(crossCheck(level, level.meta.solution, tiltFor(seed)), `シード ${seed}`).toEqual([]);
      }
    }, 30000);
  }

  it('甘い見積もり（どの板も隠さない）に差し替えると、この検査で見つかる', () => {
    // 検査そのものが働いていることの確かめ
    const level = generateLevel(1, { kind: 'box' });
    const model = createSafeModel(level);
    const loose = { ...model, covered: () => false };
    const ph = createPhysics(level);
    const st = newGame(level);
    syncPlates(ph, st);
    expect(optimistic(level, ph, st, loose).length).toBeGreaterThan(0);
    expect(optimistic(level, ph, st, model)).toEqual([]);
    ph.free();
  });
});
