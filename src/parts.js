// 部品の木（D4）。題材（車・家・動物など）の立体を、親子の部品で組む。描画にも物理にも依存しない。
//
// 部品（木の節）:
//   { id, shape: 'plate' | 'block' | 'cylinder'（省略は 'plate'。形の意味は board.js の冒頭）,
//     size: [幅, 高さ] か outline（plate・block）/ radius（cylinder）, thickness,
//     at: 親の局所座標での中心 [x, y, z]（根は盤面の座標）,
//     n:  親の局所座標での、この部品の局所の z（法線。ねじの面の向き）。省略は [0, 0, 1]（親と同じ向き）
//     u:  親の局所座標での、この部品の局所の x（n と直交させる）。省略は n から決める（defaultU）
//     faces: ねじを置いてよい面（+1 = 法線の側、-1 = 裏）。省略は [1]
//     role:  層の目安 'core' | 'frame' | 'outer' | 'decor'（D5 で safeBlocker から数える層と見比べる）
//     color: theme.js の partColors の名前
//     children: [部品, ...] }
// 局所の y は n × u（右手系）。子の at・n・u は親の局所の軸（u, v, n）で書くので、
// 部分の木（車輪1つ、窓1枚など）は親の向きに付いて回る。
//
// flattenTree が木を盤面の板の並び（親が先）にする。板は board.js の形に parent（親の id、根は null）・role・color を足したもの。
// ルール・隠れ判定・物理は今までどおり板の並びだけを見る（ねじは盤面に固定。親を外しても子は残る）。

import { add, scale, dot, cross, normalize, sub, length, matrixQuaternion } from './geom.js';

// n に直交する局所の x の既定: 親の x を n に直交させたもの（n が x に近ければ親の -z を使う）
export function defaultU(n) {
  const base = Math.abs(n[0]) > 0.9 ? [0, 0, -1] : [1, 0, 0];
  return normalize(sub(base, scale(n, dot(base, n))));
}

const clean = (v) => v.map((x) => (Math.abs(x) < 1e-12 ? 0 : x));

// 木を板の並びにする。返り値 [{ plate, faces, depth }]（親が先、兄弟は書いた順）
export function flattenTree(root) {
  const out = [];
  const ids = new Set();
  const walk = (node, frame, parent, depth) => {
    if (ids.has(node.id)) throw new Error(`部品の id が重なっている: ${node.id}`);
    ids.add(node.id);
    const toWorld = (l) => add(add(scale(frame.u, l[0]), scale(frame.v, l[1])), scale(frame.n, l[2]));
    const n = normalize(toWorld(node.n ?? [0, 0, 1]));
    const lu = node.u ?? defaultU(node.n ?? [0, 0, 1]);
    let u = toWorld(lu);
    u = normalize(sub(u, scale(n, dot(u, n))));
    if (length(u) < 0.5) throw new Error(`部品 ${node.id} の u が n と平行`);
    const v = cross(n, u);
    const center = clean(add(frame.center, toWorld(node.at ?? [0, 0, 0])));
    const m = [[u[0], v[0], n[0]], [u[1], v[1], n[1]], [u[2], v[2], n[2]]];
    const plate = { id: node.id };
    if (node.shape && node.shape !== 'plate') plate.shape = node.shape;
    if (node.shape === 'cylinder') plate.radius = node.radius;
    else if (node.outline) plate.outline = node.outline.map((p) => p.slice());
    else plate.size = node.size.slice();
    plate.thickness = node.thickness;
    plate.position = center;
    plate.quaternion = clean(matrixQuaternion(m));
    plate.parent = parent;
    if (node.role) plate.role = node.role;
    if (node.color) plate.color = node.color;
    out.push({ plate, faces: node.faces ?? [1], depth });
    const next = { center, u, v, n };
    for (const c of node.children ?? []) walk(c, next, node.id, depth + 1);
  };
  walk(root, { center: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, null, 0);
  return out;
}

// 盤面の板の parent から木をたどる: { roots: [id...], children: Map(id → [id...]) }。parent の無い板は根
export function partTree(level) {
  const ids = new Set(level.plates.map((p) => p.id));
  const children = new Map(level.plates.map((p) => [p.id, []]));
  const roots = [];
  for (const p of level.plates) {
    if (p.parent && ids.has(p.parent)) children.get(p.parent).push(p.id);
    else roots.push(p.id);
  }
  return { roots, children };
}

// 板の深さ（根が 0）
export function depthOf(level, id) {
  const byId = new Map(level.plates.map((p) => [p.id, p]));
  let d = 0;
  for (let p = byId.get(id); p && p.parent && byId.has(p.parent); p = byId.get(p.parent)) d++;
  return d;
}
