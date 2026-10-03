// 3D の盤面データと隠れ判定。描画にも物理にも依存しない。
//
// 盤面（level）は M2 のルールの盤面に、形と位置を足したもの:
//   plates: [{ id, size: [幅, 高さ], thickness, position: [x, y, z], rotation: [rx, ry, rz] }]
//     板は局所座標の xy 平面に置いた板で、厚みは局所の z 方向（中心から ±thickness/2）。
//     形は size の長方形。凸多角形にしたいときは outline: [[x, y], ...]（局所の xy、反時計回りでも時計回りでもよい）。
//     向きは rotation（three.js の Euler 'XYZ'、ラジアン）か quaternion: [x, y, z, w] のどちらか。
//   screws: [{ id, plate, color, position: [x, y, z], dir: [x, y, z] }]
//     position はねじ頭の中心で、留めている板の表面の上。dir は抜ける向き（頭の側、軸の外向き）の単位ベクトル。
//     頭の半径は radius（省略すると盤面の screwRadius、それも無ければ SCREW_RADIUS）。
//   queue: 箱の色の順番（M2 と同じ）
// 位置は盤面を組んだ初めの姿勢で書く。板が動いたとき（M5）は、板の姿勢を poses で渡す（ねじは板と一緒に動かす）。
//
// 隠れ判定: ねじ頭の大きさの円柱を、ねじの位置から抜ける向きへ盤面の外まで掃く。
// 留めている板以外の、落ちていない板と少しでも重なれば隠れている。触れているだけは重なりに数えない。

import {
  add, sub, scale, dot, length,
  eulerMatrix, quaternionMatrix, column,
  intersects, pointsSupport, cylinderSupport,
} from './geom.js';
import { plateState } from './rules.js';

export const SCREW_RADIUS = 0.3;
// 触れているだけの板を重なりに数えないための縮め幅（盤面の大きさは数〜十程度の単位を想定）
export const CONTACT = 1e-4;

// 板の輪郭（局所の xy）
export function outlineOf(plate) {
  if (plate.outline) return plate.outline;
  const [w, h] = plate.size;
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
}

// 板の姿勢から、中心と局所の軸（u, v = 板の面内、n = 板の法線）
export function plateFrame(plate, pose = plate) {
  const m = pose.quaternion ? quaternionMatrix(pose.quaternion) : eulerMatrix(pose.rotation || [0, 0, 0]);
  return { center: pose.position, u: column(m, 0), v: column(m, 1), n: column(m, 2) };
}

// 板の頂点（世界座標）。shrink だけ内側へ縮める（面内は輪郭の各辺を shrink だけ内側へ平行に動かし、厚みは両面から）。
// 辺ごとに同じ幅で縮めるので、細長い板でも短い向きが縮み足りないことがない
export function plateVertices(plate, pose = plate, shrink = 0) {
  const { center, u, v, n } = plateFrame(plate, pose);
  const ol = shrink > 0 ? insetOutline(outlineOf(plate), shrink) : outlineOf(plate);
  const half = plate.thickness / 2 - shrink;
  const out = [];
  for (const [x, y] of ol) {
    const p = add(center, add(scale(u, x), scale(v, y)));
    out.push(add(p, scale(n, half)), add(p, scale(n, -half)));
  }
  return out;
}

// 凸多角形の各辺を d だけ内側へ平行に動かした多角形（頂点は隣り合う2辺の内向きの法線の和の向きへ動く）
export function insetOutline(ol, d) {
  let area = 0;
  for (let i = 0; i < ol.length; i++) {
    const a = ol[i], b = ol[(i + 1) % ol.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sgn = area > 0 ? 1 : -1;   // 反時計回りなら辺の左が内側
  const normal = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
    return [(-dy / l) * sgn, (dx / l) * sgn];
  };
  return ol.map((p, i) => {
    const prev = ol[(i - 1 + ol.length) % ol.length], next = ol[(i + 1) % ol.length];
    const n1 = normal(prev, p), n2 = normal(p, next);
    const k = d / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k];
  });
}

const radiusOf = (level, screw) => screw.radius ?? level.screwRadius ?? SCREW_RADIUS;

// 掃く長さ: ねじの位置から一番遠い板の頂点より先まで
function sweepLength(level, from, poses) {
  let far = 0;
  for (const p of level.plates) {
    for (const v of plateVertices(p, poseOf(p, poses))) far = Math.max(far, length(sub(v, from)));
  }
  return far + 1;
}

const poseOf = (plate, poses) => (poses && poses[plate.id]) || plate;

// ねじ screwId を抜く向きに掃いた円柱と重なる板の id（留めている板は除く）。
// plates を渡すとその板だけを調べる。poses[板の id] = { position, rotation | quaternion } で今の姿勢を渡せる。
// ねじの position と dir は、そのねじの板の初めの姿勢から今の姿勢へ動かして使う。
export function sweepHits(level, screwId, { plates = level.plates, poses } = {}) {
  const screw = level.screws.find(s => s.id === screwId);
  if (!screw) throw new Error(`ねじ ${screwId} が無い`);
  const own = level.plates.find(p => p.id === screw.plate);
  const { position, dir } = movedScrew(screw, own, poseOf(own, poses));
  const r = radiusOf(level, screw) - CONTACT;
  const from = add(position, scale(dir, CONTACT));
  const to = add(position, scale(dir, sweepLength(level, from, poses)));
  const cyl = cylinderSupport(from, to, r);
  return plates
    .filter(p => p.id !== screw.plate)
    .filter(p => intersects(cyl, pointsSupport(plateVertices(p, poseOf(p, poses), CONTACT))))
    .map(p => p.id);
}

// 板が初めの姿勢から pose へ動いたときの、ねじの位置と向き
function movedScrew(screw, plate, pose) {
  if (pose === plate) return screw;
  const a = plateFrame(plate), b = plateFrame(plate, pose);
  const rel = sub(screw.position, a.center);
  const local = [dot(rel, a.u), dot(rel, a.v), dot(rel, a.n)];
  const ld = [dot(screw.dir, a.u), dot(screw.dir, a.v), dot(screw.dir, a.n)];
  const toWorld = l => add(add(scale(b.u, l[0]), scale(b.v, l[1])), scale(b.n, l[2]));
  return { position: add(b.center, toWorld(local)), dir: toWorld(ld) };
}

// 初めの姿勢で、ねじごとに隠している板の一覧 { ねじの id: [板の id, ...] }。盤面ごとに1回だけ計算する
const coverCache = new WeakMap();
export function coverMap(level) {
  let m = coverCache.get(level);
  if (!m) {
    m = Object.fromEntries(level.screws.map(s => [s.id, sweepHits(level, s.id)]));
    coverCache.set(level, m);
  }
  return m;
}

// ルール（rules.js の removeScrew など）に渡す隠れ判定 isBlocked(screwId, state)。
// 板は動かない前提（M3・M4）: 隠している板のどれかが落ちていなければ隠れている。ぶら下がった板もその場に残って隠し続ける。
// 板が物理で動く M5 では、画面は physics.js の blocker()（今の姿勢で sweepHits）を使う。これは物理なしのテストと探索用に残す。
export function blockerFor(level) {
  const covers = coverMap(level);
  return (id, st) => covers[id].some(p => plateState(st, p) !== 'fallen');
}

// 詰みを決めるための、楽観的な隠れ判定（M5）。固定の板（ねじ2本以上）だけが隠すとみなし、
// ぶら下がった板や落ちた板は、立体を回せばどけられるかもしれないので数えない。
// 自分の板がぶら下がっていれば、回せば向きが変わるので隠れていないとみなす。
// 固定の板は動かないので、これで外せるねじが1本も無ければ、どう回しても外せない（本当の詰み）。
export function fixedBlocker(level) {
  const covers = coverMap(level);
  const own = Object.fromEntries(level.screws.map(s => [s.id, s.plate]));
  return (id, st) => plateState(st, own[id]) === 'fixed' && covers[id].some(p => plateState(st, p) === 'fixed');
}

// 盤面の形の検査。ねじが留めている板の表面の上にあり、抜ける向きが板の法線（外向き）になっているか、など
export function validateBoard(level, tol = 1e-6) {
  const plates = new Map(level.plates.map(p => [p.id, p]));
  for (const p of level.plates) {
    if (!(p.thickness > 0)) throw new Error(`板 ${p.id} の厚みが正でない`);
    const ol = outlineOf(p);
    if (ol.length < 3) throw new Error(`板 ${p.id} の輪郭の頂点が足りない`);
    if (!isConvex(ol)) throw new Error(`板 ${p.id} の輪郭が凸でない`);
  }
  for (const s of level.screws) {
    const p = plates.get(s.plate);
    if (!p) throw new Error(`ねじ ${s.id} の板 ${s.plate} が無い`);
    if (Math.abs(length(s.dir) - 1) > tol) throw new Error(`ねじ ${s.id} の向きが単位ベクトルでない`);
    const { center, u, v, n } = plateFrame(p);
    const rel = sub(s.position, center);
    const h = dot(rel, n), side = Math.sign(h) || 1;
    if (Math.abs(Math.abs(h) - p.thickness / 2) > tol) throw new Error(`ねじ ${s.id} が板 ${p.id} の表面に無い`);
    if (length(sub(s.dir, scale(n, side))) > tol) throw new Error(`ねじ ${s.id} の向きが板 ${p.id} の外向きの法線でない`);
    if (!insidePolygon([dot(rel, u), dot(rel, v)], outlineOf(p))) throw new Error(`ねじ ${s.id} が板 ${p.id} の輪郭の外にある`);
  }
}

function isConvex(ol) {
  let sign = 0;
  for (let i = 0; i < ol.length; i++) {
    const a = ol[i], b = ol[(i + 1) % ol.length], c = ol[(i + 2) % ol.length];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-12) continue;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return sign !== 0;
}

function insidePolygon([x, y], ol) {
  let sign = 0;
  for (let i = 0; i < ol.length; i++) {
    const a = ol[i], b = ol[(i + 1) % ol.length];
    const z = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(z) < 1e-9) continue;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return true;
}
