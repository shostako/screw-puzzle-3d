// 解ける保証の探索に使う、物理を安全側に見積もった隠れ判定（M6）。描画にも物理にも依存しない。
//
// ルール（rules.js）に渡す isBlocked(screwId, state) の形で、次のようにみなす。
//   ・固定の板（ねじ2本以上）は動かないので、初めの姿勢の形で隠す（board.js の coverMap と同じ）。
//   ・ぶら下がった板（ねじ1本）は、残ったねじを軸に自分の面の中で回る。固定の板に当たるまでの届く範囲（弧）の
//     どこにいてもよいとみなし、その範囲全部で隠す。ぶら下がった板どうし・落ちた板とは当たらないとみなす（範囲が広がる側）。
//   ・最後のねじを外す手は、その板が抜け出せるときだけ許す。抜け出せる = 弧のどの姿勢にいても、
//     軸の6方向のどれかへまっすぐ動かして、残っている板（固定の形と、ぶら下がった板の届く範囲）に当たらない。
//     立体を回してその向きを下にすれば、板は盤面の外へ落ちていく。抜け出した板はもう何も隠さない。
//     抜け出せない板（箱の中に閉じ込められる板）を作る手は、物理しだいでどこに残るか分からないので選ばない。
// この見積もりで外せる手順は、「板を外したら立体を傾けて落とし切る」遊び方で実際の物理でも外せる。
// それが物理より甘くないことは test/safe-physics.test.js で、生成した盤面を物理で再生して確かめている。

import { add, sub, scale, dot, cross, length, normalize, intersects, pointsSupport, cylinderSupport } from './geom.js';
import { plateFrame, plateVertices, coverMap, CONTACT, SCREW_RADIUS } from './board.js';

export const ANGLES = 24;     // ぶら下がった板の回転を調べる刻み（1周を何分割するか）
const FEAS = 0.02;            // 回る板が固定の板に当たるかを調べるときの縮め幅。物理の当たりの形（0.03 縮めて角を 0.02 丸める）より緩く、弧が実物より広くなる側
const ESC = 0.05;             // 抜け出す道に残った板がかかるかを調べるときの、残った板の縮め幅。回る板が当たるかの判定（両方 FEAS 縮め）で許した食い込みより大きくする
const BISECT = 10;            // 当たる角度を二分法で詰める回数（15 度 / 2^10 ≈ 0.015 度）
const FAR = 200;              // 掃く長さ（盤面の外まで）
const TAU = Math.PI * 2;

const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// 支持関数の外接箱（6方向の支持点）
function aabbOf(support) {
  const lo = [0, 0, 0], hi = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const d = [0, 0, 0];
    d[a] = 1; hi[a] = support(d)[a];
    d[a] = -1; lo[a] = support(d)[a];
  }
  return { lo, hi };
}
const boxesMeet = (a, b) => a.lo[0] < b.hi[0] && b.lo[0] < a.hi[0] && a.lo[1] < b.hi[1] && b.lo[1] < a.hi[1] && a.lo[2] < b.hi[2] && b.lo[2] < a.hi[2];

// 支持関数と外接箱の組。交わりはまず外接箱で弾いてから GJK で調べる。id は交わりの結果を覚えておくための番号
let shapeIds = 0;
const shape = (support) => ({ support, box: aabbOf(support), id: shapeIds++ });
const meet = (a, b) => boxesMeet(a.box, b.box) && intersects(a.support, b.support);

export function createSafeModel(level) {
  const plates = level.plates, screws = level.screws;
  if (plates.length > 30) throw new Error('安全側の見積もりは板 30 枚まで（ビットの並びで持つため）');
  const pIdx = new Map(plates.map((p, i) => [p.id, i]));
  const sIdx = new Map(screws.map((s, i) => [s.id, i]));
  const plateOf = screws.map((s) => pIdx.get(s.plate));
  const screwsOf = plates.map((_, i) => screws.map((s, j) => j).filter((j) => plateOf[j] === i));

  // 固定の板の隠し方（初めの姿勢）
  const cm = coverMap(level);
  const coverMask = screws.map((s) => cm[s.id].reduce((m, id) => m | (1 << pIdx.get(id)), 0));

  // ねじを抜く向きに掃く円柱（ねじの位置は、自分の板が固定かぶら下がりの軸なら動かない）
  const sweeps = screws.map((s) => {
    const r = (s.radius ?? level.screwRadius ?? SCREW_RADIUS) - CONTACT;
    const from = add(s.position, scale(s.dir, CONTACT));
    return shape(cylinderSupport(from, add(s.position, scale(s.dir, FAR)), r));
  });

  // 固定の板の形（回る板が当たるかを調べる用と、抜け出す道にかかるかを調べる用）
  const feasShape = plates.map((p) => shape(pointsSupport(plateVertices(p, p, FEAS))));
  const escShape = plates.map((p) => shape(pointsSupport(plateVertices(p, p, ESC))));

  // ---- ぶら下がった板の回転 ----
  // 板 i がねじ j を軸に回る。軸は板の法線で、ねじの位置を板の厚みの真ん中へ移した点を通る
  const rotCache = new Map();
  function rot(i, j) {
    const key = i * 64 + j;
    let r = rotCache.get(key);
    if (r) return r;
    const p = plates[i], s = screws[j];
    const { n } = plateFrame(p);
    const pivot = sub(s.position, scale(n, dot(sub(s.position, p.position), n)));
    const base = (shrink) => plateVertices(p, p, shrink).map((v) => {
      const rel = sub(v, pivot), h = dot(rel, n);
      return { a: sub(rel, scale(n, h)), h };
    });
    const tight = base(CONTACT), loose = base(FEAS);
    const reach = Math.max(...tight.map((q) => length(q.a)));
    const at = (verts, th) => {
      const c = Math.cos(th), sn = Math.sin(th);
      return verts.map(({ a, h }) => add(pivot, add(add(scale(a, c), scale(cross(n, a), sn)), scale(n, h))));
    };
    // 角度 th の姿勢で当たる固定の板のビット（mask の板だけ調べる）
    const hitsAt = (th, mask) => {
      const sh = shape(pointsSupport(at(loose, th)));
      let m = 0;
      for (let k = 0; k < plates.length; k++) if (k !== i && (mask >> k & 1) && meet(sh, feasShape[k])) m |= 1 << k;
      return m;
    };
    const all = (1 << plates.length) - 1;
    const stop = [];
    for (let k = 0; k < ANGLES; k++) stop.push(k === 0 ? 0 : hitsAt(k * TAU / ANGLES, all));
    r = { i, j, n, pivot, reach, tight, at, hitsAt, stop, relevant: stop.reduce((m, x) => m | x, 0), seg: new Map() };
    rotCache.set(key, r);
    return r;
  }

  // 角度 a から b まで回る間に板が通る範囲を含む凸の形。両端の姿勢の凸包を、弧のふくらみ（矢高）だけ太らせる。
  // inPlane なら板の面の中だけ太らせる（厚みの向きには広げない。抜け出す道を調べるときに、面の外側の判定を正確にするため）
  function segment(r, a, b, inPlane) {
    const key = `${a}:${b}:${inPlane ? 1 : 0}`;
    let sg = r.seg.get(key);
    if (sg) return sg;
    const pts = pointsSupport([...r.at(r.tight, a), ...r.at(r.tight, b)]);
    const m = r.reach * (1 - Math.cos(Math.abs(b - a) / 2)) + 1e-6;
    const sup = inPlane
      ? (d) => add(pts(d), scale(normalize(sub(d, scale(r.n, dot(d, r.n)))), m))
      : (d) => add(pts(d), scale(normalize(d), m));
    sg = shape(sup);
    sg.cover = null;   // この範囲が隠すねじ（後で求める）
    r.seg.set(key, sg);
    return sg;
  }

  // 固定の板が fixed（ビット）のとき、板 i がねじ j でぶら下がって届く弧。
  // cov: 隠す範囲を調べる区間（当たる角度の先まで含む）、esc: 抜け出せるかを調べる区間（当たる手前まで）
  const arcCache = new Map();
  function arc(i, j, fixed) {
    const r = rot(i, j);
    const f = fixed & r.relevant;
    const key = (i * 64 + j) * 2 ** 30 + f;
    let out = arcCache.get(key);
    if (out) return out;
    const cov = [], esc = [];
    const step = TAU / ANGLES;
    for (const dir of [1, -1]) {
      let k = 0, full = false;
      for (;;) {
        const next = k + dir;
        if (Math.abs(next) > ANGLES) { full = true; break; }
        const hit = r.stop[(next + ANGLES) % ANGLES] & f;
        const a = k * step, b = next * step;
        if (hit) {
          // 当たる角度を二分法で詰める: lo は当たらない、hi は当たる
          let lo = a, hi = b;
          for (let t = 0; t < BISECT; t++) {
            const mid = (lo + hi) / 2;
            if (r.hitsAt(mid, hit)) hi = mid; else lo = mid;
          }
          cov.push(dir > 0 ? [a, hi] : [hi, a]);
          if (lo !== a) esc.push(dir > 0 ? [a, lo] : [lo, a]);
          break;
        }
        cov.push(dir > 0 ? [a, b] : [b, a]);
        esc.push(dir > 0 ? [a, b] : [b, a]);
        k = next;
      }
      if (full) break;   // 1周回れるなら、もう片方の向きを調べるまでもない
    }
    if (!esc.length) esc.push([0, 0]);
    out = {
      r,
      cov: cov.map(([a, b]) => segment(r, a, b, false)),
      esc: esc.map(([a, b]) => segment(r, a, b, true)),
      covered: null,
    };
    arcCache.set(key, out);
    return out;
  }

  // 弧が隠すねじ（ねじの番号の集合）
  function arcCover(i, j, fixed) {
    const a = arc(i, j, fixed);
    if (a.covered) return a.covered;
    const set = new Set();
    for (const sg of a.cov) {
      if (!sg.cover) {
        sg.cover = [];
        for (let s = 0; s < screws.length; s++) if (plateOf[s] !== i && meet(sg, sweeps[s])) sg.cover.push(s);
      }
      for (const s of sg.cover) set.add(s);
    }
    return (a.covered = set);
  }

  // 板 i をねじ j から外したとき、抜け出せるか。fixed: 固定の板のビット、hanging: ぶら下がった他の板 [[板, 軸のねじ], ...]
  // 区間ごと・向きごとに掃いた形と、それに残った板がかかるかは覚えておく（状態が変わっても使い回せる）
  const escCache = new Map(), sweptCache = new Map();
  function swept(r, sg) {
    let out = sweptCache.get(sg.id);
    if (out) return out;
    const dirs = AXES.slice();
    for (const d of [r.n, scale(r.n, -1)]) if (!dirs.some((x) => length(sub(x, d)) < 1e-9)) dirs.push(d);
    const t = plates[r.i].thickness;
    out = dirs.map((d) => {
      // 板の法線の向きへは、板の厚みの外側（今いない所）だけを調べる。面の中の向きへは、今の範囲ごと掃く
      const off = Math.abs(dot(d, r.n)) > 1 - 1e-9 ? scale(d, t) : [0, 0, 0];
      const far = add(off, scale(d, FAR));
      return shape((v) => add(sg.support(v), dot(v, d) > 0 ? far : off));
    });
    sweptCache.set(sg.id, out);
    return out;
  }
  // 弧の届く範囲全部（cov の区間の和）を包む外接箱。これにかからなければ、どの区間にもかからない
  function hullOf(ar) {
    if (!ar.hull) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const sg of ar.cov) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], sg.box.lo[k]); hi[k] = Math.max(hi[k], sg.box.hi[k]); }
      ar.hull = { lo, hi };
    }
    return ar.hull;
  }
  // 掃いた形ごとに、残った板の形の番号 → かかるか（番号は小さな整数なので Map の引きが速い）
  function blocks(sw, o) {
    const memo = sw.blocks || (sw.blocks = new Map());
    let b = memo.get(o.id);
    if (b === undefined) memo.set(o.id, (b = meet(sw, o)));
    return b;
  }
  function canEscape(i, j, fixed, hanging, hangKey = hanging.map((h) => h.join('.')).join(',')) {
    const key = `${i}:${j}:${fixed}:${hangKey}`;
    let ok = escCache.get(key);
    if (ok !== undefined) return ok;
    const obstacles = [], arcs = [];
    for (let k = 0; k < plates.length; k++) if (k !== i && (fixed >> k & 1)) obstacles.push(escShape[k]);
    for (const [h, hj] of hanging) if (h !== i) arcs.push(arc(h, hj, fixed));
    const a = arc(i, j, fixed);
    // ぶら下がった板の弧は、まず弧全体の外接箱で調べ、かかるときだけ区間ごとに調べる（結果は区間ごとに調べるのと同じ）
    const clear = (sw) => !obstacles.some((o) => blocks(sw, o)) && !arcs.some((ar) => boxesMeet(sw.box, hullOf(ar)) && ar.cov.some((o) => blocks(sw, o)));
    ok = a.esc.every((sg) => swept(a.r, sg).some(clear));
    escCache.set(key, ok);
    return ok;
  }

  // 状態ごとの、固定の板のビットとぶら下がった板の一覧（状態のオブジェクトごとに1回だけ求める）
  const infoCache = new WeakMap();
  function infoOf(st) {
    let info = infoCache.get(st);
    if (info) return info;
    let fixed = 0;
    const hanging = [];
    plates.forEach((p, i) => {
      const left = st.left[p.id];
      if (left >= 2) fixed |= 1 << i;
      else if (left === 1) hanging.push([i, screwsOf[i].find((j) => st.where[screws[j].id] === 'board')]);
    });
    info = { fixed, hanging, hangKey: hanging.map((h) => h.join('.')).join(',') };
    infoCache.set(st, info);
    return info;
  }

  // 隠れているか（最後のねじで、外すと板が抜け出せない場合も外せないとみなす）
  function blocker(id, st) {
    const s = sIdx.get(id), own = plateOf[s];
    const { fixed, hanging, hangKey } = infoOf(st);
    if (coverMask[s] & fixed) return true;
    for (const [i, j] of hanging) if (i !== own && arcCover(i, j, fixed).has(s)) return true;
    if (st.left[plates[own].id] === 1 && !canEscape(own, s, fixed, hanging, hangKey)) return true;
    return false;
  }

  // 板に隠れているか（抜け出せるかは問わない）。物理と比べるテスト用
  function covered(id, st) {
    const s = sIdx.get(id), own = plateOf[s];
    const { fixed, hanging } = infoOf(st);
    if (coverMask[s] & fixed) return true;
    return hanging.some(([i, j]) => i !== own && arcCover(i, j, fixed).has(s));
  }

  return { blocker, covered, arc, canEscape, infoOf };
}

// ルールに渡す隠れ判定（盤面ごとに見積もりを作る）
const modelCache = new WeakMap();
export function safeBlocker(level) {
  let m = modelCache.get(level);
  if (!m) { m = createSafeModel(level); modelCache.set(level, m); }
  return m.blocker;
}
