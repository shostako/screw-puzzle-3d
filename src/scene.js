import * as THREE from 'three';
import { outlineOf, plateFrame, SCREW_RADIUS } from './board.js';

// 盤面（board.js の形）から three.js の立体を作る。
// 返り値 { root, plates: Map(板の id → Object3D), screws: Map(ねじの id → Object3D) }
// ねじの Object3D は userData.screwId を持ち、レイキャストで当たった Mesh から親をたどって id が分かる。

// ねじの色（ルールの色の名前 → 表示の色）。HUD の CSS とそろえる
export const SCREW_COLORS = {
  red: 0xe0473a,
  blue: 0x2f7fe0,
  yellow: 0xf3b81f,
  green: 0x3aae5a,
  purple: 0x9354d6,
  cyan: 0x22b3ad,
  orange: 0xf07a22,
  pink: 0xeb5c9c,
};

const PLATE_COLORS = [0xe8c79a, 0xdcb688, 0xf0d6ae, 0xd6ab78, 0xe4c090, 0xd0a06c, 0xc99a68, 0xeacba0];

const HEAD_H = 0.16;   // ねじ頭の高さ（板の表面から外へ）

export function buildBoard(level) {
  const root = new THREE.Group();
  const plates = new Map(), screws = new Map();

  level.plates.forEach((p, i) => {
    const obj = plateObject(p, PLATE_COLORS[i % PLATE_COLORS.length]);
    obj.userData.plateId = p.id;
    plates.set(p.id, obj);
    root.add(obj);
  });

  for (const s of level.screws) {
    const obj = screwObject(s, s.radius ?? level.screwRadius ?? SCREW_RADIUS);
    obj.userData.screwId = s.id;
    obj.userData.radius = s.radius ?? level.screwRadius ?? SCREW_RADIUS;   // 頭の半径（外した印の大きさを合わせる）
    screws.set(s.id, obj);
    root.add(obj);
  }
  return { root, plates, screws };
}

function plateObject(p, color) {
  const shape = new THREE.Shape(outlineOf(p).map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: p.thickness, bevelEnabled: false });
  geo.translate(0, 0, -p.thickness / 2);
  // 不透明で描く（透明の扱いは描く順の並べ替えが要って重い）。消えるときだけ main.js が透明にする
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const mesh = new THREE.Mesh(geo, mat);
  // 輪郭の線。回したときに板の境目が分かるように
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0x8a6a48, transparent: true, opacity: 0.55 }),
  );
  edges.raycast = () => {};   // 線は当たり判定に使わない（線の判定は太すぎる）
  mesh.add(edges);
  const { center, u, v, n } = plateFrame(p);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...u), new THREE.Vector3(...v), new THREE.Vector3(...n));
  mesh.quaternion.setFromRotationMatrix(m);
  mesh.position.set(...center);
  return mesh;
}

// ねじ: 色の付いた丸頭に、濃い十字の溝。横から見ても色が分かるよう、頭は厚めで側面も同じ色。
// 根元に短い金属の軸を見せて、ねじだと分かるようにする。
// 形と材質は、大きさと色ごとに1つ作って全部のねじで使い回す（ねじ 30 本でも作るのは数個。描く回数はねじ1本につき3回）
const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

function headGeometry(r) {
  return cached(`head:${r}`, () => {
    // 丸みのある頭: 側面の円柱と、少し低い上面のふくらみ
    const pts = [
      new THREE.Vector2(0, HEAD_H),
      new THREE.Vector2(r * 0.55, HEAD_H * 0.98),
      new THREE.Vector2(r * 0.85, HEAD_H * 0.85),
      new THREE.Vector2(r, HEAD_H * 0.55),
      new THREE.Vector2(r, 0.02),
      new THREE.Vector2(r * 0.9, 0),
      new THREE.Vector2(0, 0),
    ].reverse();
    return new THREE.LatheGeometry(pts, 24);
  });
}

// 十字の溝（2本の棒を1つの形にまとめる）
function grooveGeometry(r) {
  return cached(`groove:${r}`, () => {
    const a = new THREE.BoxGeometry(r * 1.2, 0.05, r * 0.2).toNonIndexed();
    const b = a.clone().rotateY(Math.PI / 2);
    const geo = new THREE.BufferGeometry();
    for (const name of ['position', 'normal']) {
      const x = a.getAttribute(name).array, y = b.getAttribute(name).array;
      const both = new Float32Array(x.length + y.length);
      both.set(x);
      both.set(y, x.length);
      geo.setAttribute(name, new THREE.BufferAttribute(both, 3));
    }
    geo.translate(0, HEAD_H * 0.97, 0);
    return geo;
  });
}

const shaftGeometry = (r) => cached(`shaft:${r}`, () => new THREE.CylinderGeometry(r * 0.38, r * 0.3, 0.26, 10).translate(0, -0.13, 0));
const headMaterial = (color) => cached(`headMat:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.15 }));
const grooveMaterial = () => cached('grooveMat', () => new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.6 }));
const shaftMaterial = () => cached('shaftMat', () => new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.4, metalness: 0.6 }));

function screwObject(s, r) {
  const g = new THREE.Group();
  const color = SCREW_COLORS[s.color] ?? 0x888888;
  g.add(new THREE.Mesh(headGeometry(r), headMaterial(color)));
  const groove = new THREE.Mesh(grooveGeometry(r), grooveMaterial());
  groove.raycast = () => {};   // 頭と同じ所にあるので、当たり判定は頭だけで足りる
  g.add(groove);
  // 板にめり込んだ軸（外したときに抜けて見える）
  const shaft = new THREE.Mesh(shaftGeometry(r), shaftMaterial());
  shaft.raycast = () => {};   // 板の中に隠れているので当たり判定に使わない
  g.add(shaft);
  // 円柱の軸（+Y）を抜ける向きへ
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...s.dir).normalize());
  g.position.set(...s.position);
  return g;
}
