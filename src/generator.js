// 盤面の生成器（M6）。番号（シード）から、箱や家具のような立体を板とねじで組み、色と箱の順番を決める。
// 同じシードと同じ設定なら同じ盤面になる（乱数は mulberry32、Math.random は使わない）。
//
// 作り方:
//   1. 形を組む: 箱（閉じた箱、前が開いた棚、仕切りや中の棚板つき）・本棚・机のどれか。板はどれも軸に沿った向き。
//      外側の面には小さな札を載せ、その下のねじを隠す。中の棚板や仕切りのねじは、外側の板を外すまで見えない。
//   2. ねじを置く: 板ごとに外から触れる面へ 2〜4 本。合計は 3 の倍数にそろえる。
//   3. 色を決めずに外せる順番を探す（safe.js の安全側の見積もりで、どの板も最後のねじで抜け出せる順）。
//      見つからない形は作り直す。
//   4. その順番を下敷きに、箱の順番を混ぜて色を割り当て、色つきで手順を探す（solve.js）。見つかればそれを採る。
//      何度試しても見つからなければ、順番どおりに箱が埋まる割り当て（必ずその順番で解ける）にする。
// 返り値の盤面は rules.js の newGame と board.js の validateBoard をそのまま通る形で、
// meta に { seed, kind, solution（見つけた手順）, tries（色の割り当てを試した回数）, fallback, attempt（形を作り直した回数）} を持つ。

import { safeBlocker } from './safe.js';
import { coverMap } from './board.js';
import { solve } from './solve.js';
import { newGame, removeScrew, isCleared } from './rules.js';

export const COLORS = ['red', 'blue', 'yellow', 'green', 'purple', 'cyan', 'orange', 'pink'];
export const KINDS = ['box', 'shelf', 'table'];

const T = 0.3;             // 板の厚み
const R = 0.3;             // ねじ頭の半径（board.js の SCREW_RADIUS と同じ）
const INSET = R + 0.25;    // ねじの中心と板の縁との間
const GAP = 2 * R + 0.5;   // 同じ板のねじどうしの中心の間
const SHAPE_TRIES = 30;    // 形を作り直す上限
const COLOR_TRIES = 10;    // 色の割り当てを試す回数

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rnd, xs) => xs[Math.floor(rnd() * xs.length)];
const range = (rnd, lo, hi, step = 0.5) => lo + step * Math.floor(rnd() * (Math.round((hi - lo) / step) + 1));
function shuffle(xs, rnd) {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

// ---- 板 ----
// 軸に沿った板を、外寸の箱（中心 c、各軸の長さ ext）で作る。axis は法線の軸（0 = x, 1 = y, 2 = z）
const ROT = [[0, Math.PI / 2, 0], [-Math.PI / 2, 0, 0], [0, 0, 0]];
// 板の局所の x・y が、世界のどの軸のどちら向きになるか（ROT と対応）
const LOCAL = [[[2, -1], [1, 1]], [[0, 1], [2, -1]], [[0, 1], [1, 1]]];

function slab(id, axis, c, ext, faces) {
  const [[ax], [ay]] = LOCAL[axis];
  return {
    plate: { id, size: [ext[ax], ext[ay]], thickness: ext[axis], position: c.slice(), rotation: ROT[axis].slice() },
    axis, c, ext, faces,   // faces: ねじを置いてよい面（法線の向き +1 / -1）
  };
}

const lo = (b, a) => b.c[a] - b.ext[a] / 2;
const hi = (b, a) => b.c[a] + b.ext[a] / 2;
const overlap = (a, b) => [0, 1, 2].every((k) => lo(a, k) < hi(b, k) - 1e-9 && lo(b, k) < hi(a, k) - 1e-9);

// ---- 形 ----

function box(rnd) {
  const W = range(rnd, 4.5, 6.5), H = range(rnd, 4, 6), D = range(rnd, 4, 6);
  const openFront = rnd() < 0.35;
  const out = [
    slab('top', 1, [0, H / 2 - T / 2, 0], [W, T, D], [1]),
    slab('bottom', 1, [0, -H / 2 + T / 2, 0], [W, T, D], [-1]),
    slab('back', 2, [0, 0, -D / 2 + T / 2], [W, H - 2 * T, T], [-1]),
    slab('left', 0, [-W / 2 + T / 2, 0, 0], [T, H - 2 * T, D - 2 * T], [-1]),
    slab('right', 0, [W / 2 - T / 2, 0, 0], [T, H - 2 * T, D - 2 * T], [1]),
  ];
  if (!openFront) out.push(slab('front', 2, [0, 0, D / 2 - T / 2], [W, H - 2 * T, T], [1]));
  const iz0 = -D / 2 + T, iz1 = openFront ? D / 2 : D / 2 - T;   // 中の奥行き
  const inner = { x0: -W / 2 + T, x1: W / 2 - T, y0: -H / 2 + T, y1: H / 2 - T, z0: iz0, z1: iz1 };
  let px = null;
  if (rnd() < 0.5) {
    px = range(rnd, -W / 2 + 1.8, W / 2 - 1.8, 0.25);
    out.push(slab('wall', 0, [px, 0, (iz0 + iz1) / 2], [T, H - 2 * T, iz1 - iz0], [1, -1]));
  }
  if (rnd() < 0.6) {
    const y = range(rnd, inner.y0 + 1.5, inner.y1 - 1.5, 0.25);
    const spans = px === null ? [[inner.x0, inner.x1]] : [[inner.x0, px - T / 2], [px + T / 2, inner.x1]];
    spans.forEach(([a, b], k) => {
      if (b - a < 1.6) return;
      out.push(slab(`shelf${k + 1}`, 1, [(a + b) / 2, y, (iz0 + iz1) / 2], [b - a, T, iz1 - iz0], [1, -1]));
    });
  }
  return out;
}

function bookshelf(rnd) {
  const W = range(rnd, 4, 5.5), H = range(rnd, 5.5, 7), D = range(rnd, 2.5, 3.5);
  const out = [
    slab('top', 1, [0, H / 2 - T / 2, 0], [W, T, D], [1]),
    slab('bottom', 1, [0, -H / 2 + T / 2, 0], [W, T, D], [-1]),
    slab('back', 2, [0, 0, -D / 2 + T / 2], [W, H - 2 * T, T], [-1]),
    slab('left', 0, [-W / 2 + T / 2, 0, T / 2], [T, H - 2 * T, D - T], [-1]),
    slab('right', 0, [W / 2 - T / 2, 0, T / 2], [T, H - 2 * T, D - T], [1]),
  ];
  const n = rnd() < 0.5 ? 1 : 2;
  const y0 = -H / 2 + T, y1 = H / 2 - T, gap = (y1 - y0) / (n + 1);
  for (let k = 1; k <= n; k++) {
    out.push(slab(`shelf${k}`, 1, [0, y0 + gap * k, T / 2], [W - 2 * T, T, D - T], [1, -1]));
  }
  return out;
}

function table(rnd) {
  const W = range(rnd, 5, 6.5), H = range(rnd, 3.5, 5), D = range(rnd, 3.5, 5);
  const LW = 1.2;   // 脚の幅
  const out = [slab('top', 1, [0, H / 2 - T / 2, 0], [W, T, D], [1, -1])];
  const legX = W / 2 - 0.6, legZ = D / 2 - 0.3 - LW / 2;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], k) => {
    out.push(slab(`leg${k + 1}`, 0, [sx * legX, -T / 2, sz * legZ], [T, H - T, LW], [sx]));
  });
  if (rnd() < 0.7) {
    const y = -H / 2 + range(rnd, 0.8, 1.4, 0.2);
    out.push(slab('shelf1', 1, [0, y, 0], [2 * (legX - T / 2), T, D - 0.6], [1, -1]));
  }
  const AH = 1.2;   // 幕板の高さ
  for (const sz of rnd() < 0.5 ? [1, -1] : [1]) {
    out.push(slab(sz > 0 ? 'apron1' : 'apron2', 2, [0, H / 2 - T - AH / 2, sz * (D / 2 - T / 2)], [2 * legX + T, AH, T], [sz]));
  }
  return out;
}

const BUILDERS = { box, shelf: bookshelf, table };

// 外側の面に載せる小さな札。下の板のねじを隠す
function addLabels(rnd, parts, count) {
  const hosts = parts.filter((b) => b.faces.length === 1 && !b.plate.id.startsWith('leg'));
  for (let k = 0; k < count && hosts.length; k++) {
    const host = pick(rnd, hosts), side = host.faces[0], a = host.axis;
    const [u, v] = [0, 1, 2].filter((x) => x !== a);
    const ext = [0, 0, 0];
    ext[a] = T;
    ext[u] = Math.min(range(rnd, 2, 2.8, 0.2), host.ext[u] - 0.6);
    ext[v] = Math.min(range(rnd, 2, 2.8, 0.2), host.ext[v] - 0.6);
    if (ext[u] < 2 || ext[v] < 2) continue;
    const c = host.c.slice();
    c[a] += side * (host.ext[a] / 2 + T / 2);
    c[u] += (rnd() - 0.5) * (host.ext[u] - ext[u] - 0.4);
    c[v] += (rnd() - 0.5) * (host.ext[v] - ext[v] - 0.4);
    const lb = slab(`label${k + 1}`, a, c, ext, [side]);
    if (parts.some((b) => overlap(b, lb))) continue;
    parts.push(lb);
  }
}

// 板の面にねじを n 本置く（同じ板のねじどうしは GAP 以上離す）
function placeScrews(rnd, b, n) {
  const a = b.axis, [u, v] = [0, 1, 2].filter((x) => x !== a);
  const out = [];
  for (let t = 0; t < 60 && out.length < n; t++) {
    const side = pick(rnd, b.faces);
    const p = b.c.slice();
    p[a] += side * b.ext[a] / 2;
    const su = b.ext[u] / 2 - INSET, sv = b.ext[v] / 2 - INSET;
    if (su < 0 || sv < 0) break;
    p[u] += (rnd() * 2 - 1) * su;
    p[v] += (rnd() * 2 - 1) * sv;
    p[u] = Math.round(p[u] * 20) / 20;
    p[v] = Math.round(p[v] * 20) / 20;
    if (out.some((q) => Math.hypot(q.p[u] - p[u], q.p[v] - p[v]) < GAP)) continue;
    const dir = [0, 0, 0];
    dir[a] = side;
    out.push({ p, dir });
  }
  return out;
}

// 形とねじを作る（色はまだ）。ねじは板ごとに 2 本以上、合計は 3 の倍数。
// 板どうしが隠し合って外せないねじが残る置き方（peelable でない）なら、同じ形でねじだけ置き直す
const SCREW_TRIES = 8;
export function buildShape(rnd, kind, labels) {
  const parts = BUILDERS[kind](rnd);
  addLabels(rnd, parts, labels);
  for (let t = 0; t < SCREW_TRIES; t++) {
    const shape = placeAll(rnd, parts);
    if (shape && peelable(shape)) return shape;
  }
  return null;
}

function placeAll(rnd, parts) {
  const per = parts.map((b) => {
    const area = b.ext.reduce((m, x) => m * x, 1) / b.ext[b.axis];
    const n = b.plate.id.startsWith('label') ? 2 : Math.min(4, 2 + Math.floor(rnd() * (area > 12 ? 3 : area > 4 ? 2 : 1)));
    return placeScrews(rnd, b, n);
  });
  // 2 本置けなかった板は捨てる
  const keep = parts.map((_, i) => per[i].length >= 2);
  let total = per.reduce((m, x, i) => m + (keep[i] ? x.length : 0), 0);
  while (total % 3) {
    const i = per.map((x, k) => (keep[k] ? x.length : 0)).reduce((best, len, k, all) => (len > 2 && (best < 0 || len > all[best]) ? k : best), -1);
    if (i < 0) break;
    per[i].pop();
    total--;
  }
  if (total % 3 || total < 9) return null;
  const plates = [], screws = [];
  parts.forEach((b, i) => {
    if (!keep[i]) return;
    plates.push(b.plate);
    per[i].forEach((s, k) => screws.push({ id: `${b.plate.id}-${k + 1}`, plate: b.plate.id, color: null, position: s.p, dir: s.dir }));
  });
  return { plates, screws };
}

// 箱の色の並び（1箱3本）を窓の中で混ぜ、外す順番の早いねじほど前の色を割り当てる。noise は順番をまたぐ混ざり具合
function assignColors(order, queue, win, noise, rnd) {
  const L = queue.flatMap((c) => [c, c, c]);
  for (let i = 0; i < L.length; i++) {
    const j = i + Math.floor(rnd() * Math.min(win, L.length - i));
    [L[i], L[j]] = [L[j], L[i]];
  }
  const keyed = order.map((id, i) => ({ id, key: i + rnd() * noise }));
  keyed.sort((a, b) => a.key - b.key);
  return new Map(keyed.map((x, i) => [x.id, L[i]]));
}

// opts: kind（'box' | 'shelf' | 'table'、省略で乱数）、colors（色の数）、labels（札の数）、
//       win / noise（色の混ぜ方。大きいほど待機スロットを使う難しい割り当て）、budget（手順探索の打ち切り）
export function generateLevel(seed, opts = {}) {
  const { colors = 4, labels = 2, win = 6, noise = 4, budget = 800 } = opts;
  for (let attempt = 0; attempt < SHAPE_TRIES; attempt++) {
    const rnd = mulberry32(seed * 7919 + attempt * 104729 + 1);
    const kind = opts.kind ?? pick(rnd, KINDS);
    const shape = buildShape(rnd, kind, labels);
    if (!shape || shape.plates.length > 30) continue;
    // 色を決めずに外せる順番（1色だけの盤面として解く）
    const plain = { ...shape, screws: shape.screws.map((s) => ({ ...s, color: 'x' })), queue: new Array(shape.screws.length / 3).fill('x') };
    const order = solve(plain, safeBlocker(plain), { budget: budget * 3 });
    if (!order) continue;

    const n = shape.screws.length / 3;
    const palette = shuffle(COLORS.slice(), rnd).slice(0, Math.min(colors, n));
    const queue = shuffle(Array.from({ length: n }, (_, i) => palette[i % palette.length]), rnd);
    const make = (colorOf) => ({
      plates: shape.plates,
      screws: shape.screws.map((s) => ({ ...s, color: colorOf.get(s.id) })),
      queue,
    });
    let tries = 0;
    for (; tries < COLOR_TRIES; tries++) {
      const level = make(assignColors(order, queue, win, noise, rnd));
      const path = solve(level, safeBlocker(level), { budget });
      if (path) return { ...level, meta: { seed, kind, solution: path, tries: tries + 1, fallback: false, attempt } };
    }
    // 最後の砦: 順番どおりに箱が埋まる割り当て。外す順番 order のまま、どのねじも出ている箱へ入る
    const level = make(assignColors(order, queue, 1, 0, rnd));
    if (replays(level, order)) return { ...level, meta: { seed, kind, solution: order, tries, fallback: true, attempt } };
  }
  throw new Error(`シード ${seed} で解ける盤面を作れなかった`);
}

// 手順をルールで再生してクリアになるか
function replays(level, path) {
  const isBlocked = safeBlocker(level);
  let st = newGame(level);
  for (const id of path) {
    const r = removeScrew(st, id, isBlocked);
    if (!r.ok) return false;
    st = r.state;
  }
  return isCleared(st);
}

// 板が互いのねじを隠し合って、どう外しても外せないねじが残らないか（必要条件だけを安く調べる）。
// どの板も、ねじが全部外れるまでは初めの姿勢の形で隠し続けるとみなし、外せるねじを増やしていく
export function peelable(level) {
  const cover = coverMap(level);
  const screwsOf = new Map(level.plates.map((p) => [p.id, level.screws.filter((s) => s.plate === p.id).map((s) => s.id)]));
  const done = new Set();
  for (let grew = true; grew;) {
    grew = false;
    for (const s of level.screws) {
      if (done.has(s.id)) continue;
      if (cover[s.id].every((p) => screwsOf.get(p).every((x) => done.has(x)))) { done.add(s.id); grew = true; }
    }
  }
  return done.size === level.screws.length;
}
