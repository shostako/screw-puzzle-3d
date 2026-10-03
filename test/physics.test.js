import { describe, it, expect, beforeAll } from 'vitest';
import { initPhysics, createPhysics, syncPlates, poseApply } from '../src/physics.js';
import { blockerFor, fixedBlocker, sweepHits } from '../src/board.js';
import { newGame, removeScrew, status, legalMoves } from '../src/rules.js';
import { createGame } from '../src/game.js';
import { BOX_LEVEL } from '../src/levels/box.js';

beforeAll(() => initPhysics());

const T = 0.3;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// 動きが収まるまで進める（上限 n 刻み）。落ちきった板の id を集めて返す
function settle(ph, n = 1200) {
  const gone = [];
  for (let i = 0; i < n; i++) {
    gone.push(...ph.step());
    if (i > 10 && !ph.moving()) break;
  }
  return gone;
}

// 縦に立てた横長の板 W（法線 +z）。ねじ a（左）・b（右）・c（上）で留める
const wall = (extra = {}) => ({
  plates: [{ id: 'W', size: [4, 2], thickness: T, position: [0, 0, 0], rotation: [0, 0, 0] }, ...(extra.plates ?? [])],
  screws: [
    { id: 'a', plate: 'W', color: 'red', position: [-1.5, 0, T / 2], dir: [0, 0, 1] },
    { id: 'b', plate: 'W', color: 'red', position: [1.5, 0, T / 2], dir: [0, 0, 1] },
    { id: 'c', plate: 'W', color: 'red', position: [0, 0.6, T / 2], dir: [0, 0, 1] },
    ...(extra.screws ?? []),
  ],
  queue: ['red', ...(extra.queue ?? [])],
});

// ルールで1本外し、物理を合わせる
function take(st, id, ph, isBlocked) {
  const r = removeScrew(st, id, isBlocked);
  expect(r.ok).toBe(true);
  syncPlates(ph, r.state);
  return r.state;
}

describe('ねじ1本になった板はぶら下がる', () => {
  it('残ったねじを軸に回り、中心がねじの真下に来て止まる', () => {
    const level = wall();
    const ph = createPhysics(level);
    let st = newGame(level);
    st = take(st, 'b', ph);
    expect(ph.mode('W')).toBe('fixed');   // まだ2本
    st = take(st, 'c', ph);
    expect(ph.mode('W')).toBe('hanging');
    settle(ph);
    const pose = ph.poses().W;
    expect(ph.moving()).toBe(false);
    // 中心は軸 a（-1.5, 0）の真下、軸からの距離 1.5 は変わらない
    expect(pose.position[0]).toBeCloseTo(-1.5, 1);
    expect(pose.position[1]).toBeCloseTo(-1.5, 1);
    expect(pose.position[2]).toBeCloseTo(0, 3);
    // 軸のねじの位置は、板の局所で見ても動いていない
    expect(dist(poseApply(pose, [-1.5, 0, T / 2]), [-1.5, 0, T / 2])).toBeLessThan(0.02);
  });

  it('回す途中で別の板に当たると、そこで引っかかって止まる', () => {
    // 軸の下に固定の床 G（水平）。W の右端が回りきる前に床に当たる
    const level = wall({
      plates: [{ id: 'G', size: [8, 4], thickness: T, position: [0, -2, 0], rotation: [-Math.PI / 2, 0, 0] }],
      screws: [
        { id: 'g1', plate: 'G', color: 'blue', position: [-3, -2 + T / 2, 0], dir: [0, 1, 0] },
        { id: 'g2', plate: 'G', color: 'blue', position: [3, -2 + T / 2, 0], dir: [0, 1, 0] },
        { id: 'g3', plate: 'G', color: 'blue', position: [0, -2 + T / 2, 1.5], dir: [0, 1, 0] },
      ],
      queue: ['blue'],
    });
    const ph = createPhysics(level);
    let st = newGame(level);
    st = take(st, 'b', ph);
    st = take(st, 'c', ph);
    expect(ph.mode('W')).toBe('hanging');
    settle(ph);
    const pose = ph.poses().W;
    expect(ph.moving()).toBe(false);
    expect(ph.present()).toContain('W');
    // 真下（x = -1.5）まで回りきらず、右寄りで止まる。床にめり込まない
    expect(pose.position[0]).toBeGreaterThan(-0.5);
    const corners = [[2, 1], [2, -1], [-2, 1], [-2, -1]].map(([x, y]) => poseApply(pose, [x, y, 0]));
    const low = Math.min(...corners.map(c => c[1]));
    expect(low).toBeGreaterThan(-2 + T / 2 - 0.05);
    expect(low).toBeLessThan(-2 + T / 2 + 0.1);
  });

  it('箱の前板は、ぶら下がるとすぐ底板に引っかかる（固定の盤面）', () => {
    const ph = createPhysics(BOX_LEVEL);
    let st = newGame(BOX_LEVEL);
    st = take(st, 'f1', ph);
    expect(ph.mode('F')).toBe('hanging');
    settle(ph);
    const q = ph.poses().F.quaternion;
    // ほとんど回らない（2度未満）
    expect(2 * Math.acos(Math.min(1, Math.abs(q[3])))).toBeLessThan(2 * Math.PI / 180);
  });
});

describe('ねじ0本になった板は落ちる', () => {
  it('下に何も無ければ盤面の外へ落ちきって消える', () => {
    const level = wall();
    const ph = createPhysics(level);
    let st = newGame(level);
    st = take(st, 'b', ph);
    st = take(st, 'c', ph);
    st = take(st, 'a', ph);
    expect(ph.mode('W')).toBe('loose');
    const gone = settle(ph);
    expect(gone).toEqual(['W']);
    expect(ph.mode('W')).toBe('gone');
    expect(ph.present()).toEqual([]);
    expect(ph.moving()).toBe(false);
  });

  it('別の板の上に落ちて止まり、その板のねじを隠し続ける。傾けると滑り落ちて見える', () => {
    // 棚 G（水平）の上に、小さな板 U が浮いている。G のねじ g1 の真上
    const level = {
      plates: [
        { id: 'G', size: [8, 4], thickness: T, position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0] },
        { id: 'U', size: [2, 2], thickness: T, position: [2, 2, 0], rotation: [-Math.PI / 2, 0, 0] },
      ],
      screws: [
        { id: 'g1', plate: 'G', color: 'red', position: [2, T / 2, 0], dir: [0, 1, 0] },
        { id: 'g2', plate: 'G', color: 'red', position: [-3, T / 2, 0], dir: [0, 1, 0] },
        { id: 'u', plate: 'U', color: 'red', position: [2, 2 + T / 2, 0], dir: [0, 1, 0] },
      ],
      queue: ['red'],
    };
    const ph = createPhysics(level);
    let st = newGame(level);
    syncPlates(ph, st);
    expect(ph.mode('U')).toBe('hanging');   // 始めから1本
    const blocked = ph.blocker();
    expect(blocked('g1', st)).toBe(true);
    st = take(st, 'u', ph, blocked);
    expect(ph.mode('U')).toBe('loose');
    settle(ph);
    // 棚の上で止まっている
    expect(ph.present()).toContain('U');
    expect(ph.poses().U.position[1]).toBeCloseTo(T, 1);
    // 物理なしの判定（落ちた板は数えない）では外せるが、今の姿勢で調べると隠れている
    expect(blockerFor(level)('g1', st)).toBe(false);
    expect(blocked('g1', st)).toBe(true);
    expect(removeScrew(st, 'g1', blocked).reason).toBe('blocked');
    expect(blocked('g2', st)).toBe(false);
    // 横向きの重力（立体を倒した）で滑り落ちて消え、g1 が外せる
    ph.setDown([1, -0.2, 0]);
    const gone = settle(ph, 2400);
    expect(gone).toEqual(['U']);
    expect(blocked('g1', st)).toBe(false);
  });
});

describe('立体を回すと重力の向きが変わる', () => {
  it('ぶら下がった板は、新しい下へ向かって振れ直す', () => {
    const ph = createPhysics(wall());
    ph.hang('W', 'a');
    settle(ph);
    expect(ph.poses().W.position[1]).toBeCloseTo(-1.5, 1);
    // 下を +x 向きに（立体を 90 度倒した）
    ph.setDown([1, 0, 0]);
    expect(ph.moving()).toBe(true);
    settle(ph, 2400);
    const p = ph.poses().W.position;
    expect(p[0]).toBeCloseTo(0, 1);
    expect(p[1]).toBeCloseTo(0, 1);
  });
});

// 外せるねじが無ければ、重力の向きを順に変えて動ける板を払い落とす。盤面を回して探すのと同じ
const DOWNS = [[0, -1, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, 1, 0]];

function playBox(seed, { shakeEvery = 0 } = {}) {
  const ph = createPhysics(BOX_LEVEL);
  const game = createGame(BOX_LEVEL, (id, st) => ph.blocker()(id, st), fixedBlocker(BOX_LEVEL));
  syncPlates(ph, game.state);
  let s = seed >>> 0;
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const log = [];
  let turn = 0, tries = 0;
  while (game.status === 'playing' && tries < 200) {
    const legal = game.legal();
    if (!legal.length) {
      ph.setDown(DOWNS[tries++ % DOWNS.length]);
      log.push({ gone: settle(ph, 600) });
      continue;
    }
    const id = legal[Math.floor(rand() * legal.length)];
    const r = game.tap(id);
    expect(r.reason).toBe('ok');
    syncPlates(ph, game.state);
    // 途中で少し進めてから次を外す（揺れている間にも外す）
    for (let i = 0; i < 20; i++) log.push({ gone: ph.step() });
    if (shakeEvery && ++turn % shakeEvery === 0) ph.setDown(DOWNS[turn % DOWNS.length]);
    log.push({ id, poses: ph.poses() });
  }
  const end = { status: game.status, present: ph.present(), poses: ph.poses() };
  ph.free();
  return { log, end };
}

describe('固定の盤面を物理つきで遊ぶ', () => {
  it('外せるねじを外し、詰まったら回して板を払い落とすと、クリアまで進む', () => {
    for (const seed of [1, 2, 3]) {
      const { end } = playBox(seed);
      expect(end.status).toBe('cleared');
    }
  });

  it('同じ操作なら、板の姿勢も落ちる順番も同じになる', () => {
    const a = playBox(7, { shakeEvery: 3 });
    const b = playBox(7, { shakeEvery: 3 });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.end.status).toBe('cleared');
  });

  it('外す判定は今の姿勢で、詰みは固定の板だけで決める', () => {
    // 右板 R をぶら下げると、仕切りのねじ p1・p2 は（まだ R に隠れていれば）外せないが、詰みには数えない
    const ph = createPhysics(BOX_LEVEL);
    const live = (id, st) => ph.blocker()(id, st);
    let st = newGame(BOX_LEVEL);
    st = take(st, 'r1', ph, live);
    settle(ph);
    expect(ph.mode('R')).toBe('hanging');
    expect(fixedBlocker(BOX_LEVEL)('p1', st)).toBe(false);
    expect(live('p1', st)).toBe(sweepHits(BOX_LEVEL, 'p1', { poses: ph.poses() }).length > 0);
    expect(status(st, fixedBlocker(BOX_LEVEL))).toBe('playing');
    expect(legalMoves(st, live)).not.toContain('r1');
  });
});
