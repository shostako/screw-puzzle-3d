import * as THREE from 'three';
import { outlineOf, insetOutline, plateFrame, SCREW_RADIUS } from './board.js';
import { THEME } from './theme.js';

// 盤面（board.js の形）から three.js の立体を作る。
// 返り値 { root, plates: Map(板の id → Object3D), screws: Map(ねじの id → Object3D) }
// ねじの Object3D は userData.screwId を持ち、レイキャストで当たった Mesh から親をたどって id が分かる。
// 色・材質の値は theme.js の表から取る。

export const SCREW_COLORS = Object.fromEntries(
  Object.entries(THEME.screwColors).map(([name, c]) => [name, new THREE.Color(c).getHex()]),
);

// opts.knurl: ねじの頭にローレットを刻むか（設定の画質「軽い」では刻まず、頭の三角形を減らす）
export function buildBoard(level, { knurl = true } = {}) {
  const root = new THREE.Group();
  const plates = new Map(), screws = new Map();

  level.plates.forEach((p, i) => {
    const color = THEME.partColors[p.color] ?? (p.id.startsWith('label') ? THEME.labelColor : THEME.plateColors[i % THEME.plateColors.length]);
    const obj = plateObject(p, color);
    obj.userData.plateId = p.id;
    plates.set(p.id, obj);
    root.add(obj);
  });

  for (const s of level.screws) {
    const r = s.radius ?? level.screwRadius ?? SCREW_RADIUS;
    const obj = screwObject(s, r, knurl);
    obj.userData.screwId = s.id;
    obj.userData.radius = r;   // 頭の半径（外した印の大きさを合わせる）
    screws.set(s.id, obj);
    root.add(obj);
  }
  return { root, plates, screws };
}

// ---- 板 ----

// 凸多角形の角を半径 r で丸めた輪郭（角ごとに2次曲線。辺の半分より大きくは丸めない）
export function roundedShape(outline, r) {
  const shape = new THREE.Shape();
  const n = outline.length;
  const at = (i) => outline[(i + n) % n];
  const toward = (a, b, d) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.min(d, l / 2) / l;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  for (let i = 0; i < n; i++) {
    const p = at(i), a = toward(p, at(i - 1), r), b = toward(p, at(i + 1), r);
    if (i === 0) shape.moveTo(a[0], a[1]);
    else shape.lineTo(a[0], a[1]);
    shape.quadraticCurveTo(p[0], p[1], b[0], b[1]);
  }
  shape.closePath();
  return shape;
}

// 角を丸め、縁を面取りした板。外形（面取りの外側）は当たりの形と同じ大きさ。
// 輪郭を面取りの幅だけ内側へ縮めて押し出し、面取りで元の大きさまで戻す
// 丸めた箱（block）は同じ作りで丸みを大きくし、円柱は円の輪郭を押し出す（円柱の当たりの形は外接する多角形なので、見た目は収まる）
function plateGeometry(p) {
  if (p.shape === 'cylinder') return cylinderGeometry(p);
  const { corner, bevel } = p.shape === 'block' ? THEME.block : THEME.plate;
  const b = Math.min(bevel, p.thickness * 0.3);
  const shape = roundedShape(insetOutline(outlineOf(p), b), Math.max(0, corner - b));
  const depth = p.thickness - 2 * b;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 4,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

function cylinderGeometry(p) {
  const { bevel, segments } = THEME.cylinder;
  const b = Math.min(bevel, p.thickness * 0.3, p.radius * 0.3);
  const shape = new THREE.Shape();
  shape.absarc(0, 0, p.radius - b, 0, Math.PI * 2, false);
  const depth = p.thickness - 2 * b;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: segments,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

function plateObject(p, color) {
  // 材質は板ごとに作る（消えるときに main.js がその板だけ透明にするため）。シェーダーは three.js が共有する
  // 不透明で描く（透明の扱いは描く順の並べ替えが要って重い）
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: THEME.plate.roughness, envMapIntensity: THEME.plate.envMapIntensity,
  });
  const mesh = new THREE.Mesh(plateGeometry(p), mat);
  const { center, u, v, n } = plateFrame(p);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...u), new THREE.Vector3(...v), new THREE.Vector3(...n));
  mesh.quaternion.setFromRotationMatrix(m);
  mesh.position.set(...center);
  return mesh;
}

// ---- ねじ: 六角穴付きボルト（キャップボルト） ----
// 寸法は頭の半径 r（当たり判定の半径と同じ）を基準に JIS B 1176 へ寄せる（M8 なら 頭の径 13・ねじ径 8・頭の高さ 8・六角穴の対辺 6）:
//   ねじ径 d ≈ 頭の径 / 1.5 = 1.33r、頭の高さ ≈ 0.9d（札の厚み 0.3 から頭が飛び出さない高さ）、六角穴の対辺 ≈ 0.9r。
//   頭の側面に縦のローレット、上の角は面取り、六角穴は暗い色。
// 頭は板に少し沈めて置く（座ぐりに入っているように見せ、飛び出しすぎない）。
// 形と材質は、大きさと色ごとに1つ作って全部のねじで使い回す。描く回数はねじ1本につき3回（頭・六角穴・ねじ部）
export const BOLT = {
  headHeight: 1.2,    // 頭の高さ × r
  socket: 0.52,       // 六角穴の外接円の半径 × r（対辺は √3 倍で 0.9r）
  socketDepth: 0.55,  // 六角穴の深さ × 頭の高さ
  knurls: 30,         // ローレットの山の数
  plainSteps: 24,     // ローレットを刻まない頭（画質「軽い」）の外周の角の数
  shaft: 1.2,         // ねじ部（谷の径）× r。山の分を足してねじ径 1.33r
  length: 0.6,        // ねじ部の長さ × r（板の厚み 0.3 の中に収まる長さ。長いと箱の内側に突き出て見える）
  sink: 0.3,          // 頭を板に沈める量 × r（板から出るのは 0.9r）
};

const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

const hexPoints = (rr) => Array.from({ length: 6 }, (_, i) => {
  const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
  return [Math.cos(a) * rr, Math.sin(a) * rr];
});

// 頭: ローレットの輪郭に六角の穴を抜いて押し出す（+Y が頭の上、y = 0 が座面）。
// knurl が false なら刻みの無い丸（BOLT.plainSteps 角形）にして三角形を減らす（設定の画質「軽い」）
function headGeometry(r, knurl = true) {
  return cached(`head:${r}:${knurl}`, () => {
    const h = BOLT.headHeight * r, N = knurl ? BOLT.knurls : 0, amp = 0.03 * r, steps = knurl ? N * 4 : BOLT.plainSteps;
    const shape = new THREE.Shape();
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const rr = r - amp * (0.5 + 0.5 * Math.cos(N * a));
      if (i === 0) shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    shape.closePath();
    const hex = new THREE.Path(hexPoints(BOLT.socket * r).map(([x, y]) => new THREE.Vector2(x, y)));
    hex.closePath();
    shape.holes.push(hex);
    const b = 0.08 * r;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: h - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b * 0.8, bevelOffset: -b * 0.8, bevelSegments: 2, curveSegments: 1,
    });
    // 押し出しは +Z 向き。+Y 向きに立て、座面を y = 0 に
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, b, 0);
    geo.computeBoundingSphere();
    return geo;
  });
}

// 六角穴の底と、底へすぼまる壁（1つの形にまとめる）
function socketGeometry(r) {
  return cached(`socket:${r}`, () => {
    const h = BOLT.headHeight * r, hr = BOLT.socket * r;
    const floorY = h * (1 - BOLT.socketDepth);
    const bottom = new THREE.CircleGeometry(hr * 0.6, 6, Math.PI / 6).rotateX(-Math.PI / 2).translate(0, floorY, 0);
    // 六角の壁: 上（頭の上面）は穴と同じ大きさ、下（底）で少しすぼむ
    // 頭の穴の壁（頭の色）と重ならないよう、ほんの少し内側に置く
    const wall = new THREE.CylinderGeometry(hr * 0.97, hr * 0.6, h - floorY, 6, 1, true, Math.PI / 6 + Math.PI / 2)
      .translate(0, (h + floorY) / 2, 0);
    return merge([bottom, wall]);
  });
}

// ねじ部: 円柱とねじ山（らせんの管）。ふだんは板の中に隠れていて、抜けるときに見える
function shaftGeometry(r) {
  return cached(`shaft:${r}`, () => {
    const sd = BOLT.shaft * r, L = BOLT.length * r;
    const core = new THREE.CylinderGeometry(sd / 2, sd / 2, L, 12).translate(0, -L / 2, 0);
    class Helix extends THREE.Curve {
      getPoint(t, out = new THREE.Vector3()) {
        const a = t * Math.PI * 2 * 3;
        return out.set(Math.cos(a) * sd / 2, -t * L * 0.95 - 0.02 * r, Math.sin(a) * sd / 2);
      }
    }
    const thread = new THREE.TubeGeometry(new Helix(), 36, 0.05 * r, 4, false);
    return merge([core, thread]);
  });
}

// 位置と法線だけの形を1つにまとめる（描く回数を減らすため）
function merge(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal']) {
    const total = parts.reduce((n, g) => n + g.getAttribute(name).array.length, 0);
    const arr = new Float32Array(total);
    let at = 0;
    for (const g of parts) {
      arr.set(g.getAttribute(name).array, at);
      at += g.getAttribute(name).array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  out.computeBoundingSphere();
  return out;
}

const headMaterial = (color) => cached(`headMat:${color}`, () => new THREE.MeshStandardMaterial({
  color, roughness: THEME.bolt.roughness, metalness: THEME.bolt.metalness, envMapIntensity: THEME.bolt.envMapIntensity,
}));
const socketMaterial = () => cached('socketMat', () => new THREE.MeshStandardMaterial({
  color: THEME.bolt.socket, roughness: 0.8, side: THREE.DoubleSide,
}));
const shaftMaterial = () => cached('shaftMat', () => new THREE.MeshStandardMaterial({
  color: THEME.bolt.steel, roughness: 0.32, metalness: 0.9,
}));

function screwObject(s, r, knurl = true) {
  const g = new THREE.Group();
  const color = SCREW_COLORS[s.color] ?? 0x888888;
  // 頭と六角穴は板に沈めた分だけ下げる。当たり判定（タップ）は頭と六角穴で取る
  const sink = BOLT.sink * r;
  const head = new THREE.Mesh(headGeometry(r, knurl), headMaterial(color));
  head.userData.part = 'head';
  head.position.y = -sink;
  g.add(head);
  const socket = new THREE.Mesh(socketGeometry(r), socketMaterial());
  socket.position.y = -sink;
  // 六角穴も当たり判定に使う（頭の真ん中は穴が抜けているので、穴の底で当てる）
  g.add(socket);
  const shaft = new THREE.Mesh(shaftGeometry(r), shaftMaterial());
  shaft.position.y = -sink;
  shaft.raycast = () => {};   // 板の中に隠れているので当たり判定に使わない
  g.add(shaft);
  // 円柱の軸（+Y）を抜ける向きへ
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...s.dir).normalize());
  g.position.set(...s.position);
  return g;
}

// 作った盤面のねじの頭を、ローレットあり・なしに差し替える（遊んでいる途中で画質を変えたとき。盤面は作り直さない）
export function setKnurl(board, knurl) {
  for (const g of board.screws.values()) {
    const head = g.children.find((c) => c.userData.part === 'head');
    if (head) head.geometry = headGeometry(g.userData.radius, knurl);
  }
}
