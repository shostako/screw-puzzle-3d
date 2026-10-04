import * as THREE from 'three';
import { outlineOf, insetOutline, plateFrame, plateVertices, SCREW_RADIUS } from './board.js';
import { intersects, pointsSupport, add, scale, length } from './geom.js';
import { THEME } from './theme.js';

// 盤面（board.js の形）から three.js の立体を作る。
// 返り値 { root, plates: Map(板の id → Object3D), screws: Map(ねじの id → Object3D) }
// ねじの Object3D は userData.screwId を持ち、レイキャストで当たった Mesh から親をたどって id が分かる。
// 色・材質の値は theme.js の表から取る。

export const SCREW_COLORS = Object.fromEntries(
  Object.entries(THEME.screwColors).map(([name, c]) => [name, new THREE.Color(c).getHex()]),
);

// opts.knurl: ねじの頭にローレットを刻むか（設定の画質「軽い」では刻まず、頭の三角形を減らす）
// opts.contact: 板が接する所の暗さを出すか（E2。画質「軽い」では出さない）
// opts.drives: 色ごとにねじの穴の形を変えるか（E2。設定「ねじ穴の形」。既定は全部六角穴）
export function buildBoard(level, { knurl = true, contact = true, drives = false } = {}) {
  const root = new THREE.Group();
  const plates = new Map(), screws = new Map();

  level.plates.forEach((p, i) => {
    const color = THEME.partColors[p.color] ?? (p.id.startsWith('label') ? THEME.labelColor : THEME.plateColors[i % THEME.plateColors.length]);
    const obj = plateObject(p, color);
    obj.userData.plateId = p.id;
    plates.set(p.id, obj);
    root.add(obj);
  });
  // 近くの板を覚えさせる（接する所の暗さ）。板が動いても、外れても、覚えた相手の今の姿勢で描く
  for (const [id, near] of contactNeighbors(level)) {
    plates.get(id).userData.contact = near.map((j) => ({ obj: plates.get(j), shape: contactShape(level.plates.find((q) => q.id === j)) }));
  }
  const board = { root, plates, screws };
  setContact(board, contact);

  for (const s of level.screws) {
    const r = s.radius ?? level.screwRadius ?? SCREW_RADIUS;
    const obj = screwObject(s, r, knurl, drives ? driveOf(s.color) : 'hex');
    obj.userData.screwId = s.id;
    obj.userData.radius = r;   // 頭の半径（外した印の大きさを合わせる）
    obj.userData.color = s.color;
    screws.set(s.id, obj);
    root.add(obj);
  }
  return board;
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
  return markEdges(geo);
}

// 面取りのうち上下の面に接する側の帯に edge = 1 を付ける（シェーダーがその帯を明るくして、縁に細い光の線を出す）。
// 押し出しの形は面ごとに法線が平らなので、法線の z（板の厚みの向き）で帯を見分けられる: 上下の面は 1、側面は 0、面取りはその間
export function markEdges(geo) {
  const n = geo.getAttribute('normal');
  const edge = new Float32Array(n.count);
  for (let i = 0; i < n.count; i++) {
    const z = Math.abs(n.getZ(i));
    edge[i] = z > 0.6 && z < 0.995 ? 1 : 0;
  }
  geo.setAttribute('edge', new THREE.BufferAttribute(edge, 1));
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
  return markEdges(geo);
}

function plateObject(p, color) {
  // 材質は板ごとに作る（消えるときに main.js がその板だけ透明にするため）。シェーダーは three.js が共有する
  // 不透明で描く（透明の扱いは描く順の並べ替えが要って重い）
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: THEME.plate.roughness, envMapIntensity: THEME.plate.envMapIntensity,
  });
  shadePlate(mat, p.shape === 'block' || p.shape === 'cylinder' ? THEME.plate.blockEdgeLight : THEME.plate.edgeLight);
  const mesh = new THREE.Mesh(plateGeometry(p), mat);
  mesh.onBeforeRender = updateContact;
  const { center, u, v, n } = plateFrame(p);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...u), new THREE.Vector3(...v), new THREE.Vector3(...n));
  mesh.quaternion.setFromRotationMatrix(m);
  mesh.position.set(...center);
  return mesh;
}

// ---- 板の陰影（E2）: 縁の光と、接する所の暗さ ----
// 接する所の暗さは、近くの板を「輪郭（凸）を厚みの向きへ押し出した柱」の式のまま持ち、
// 描く点から法線の向きに数点進んだ所が近くの板にどれだけ近いかで暗くする（距離の式を使った環境光の遮り）。
// 影の地図や画面全体の後処理を使わないので、描く回数は増えない。材質は板ごとに1つ（もとから）で、シェーダーは全部の板で同じ

const CONTACT = THEME.contact;
const MAX_EDGES = 4;

// 近くの板の組（板の id → 近い順に最大 CONTACT.max 枚の id）。盤面を組んだ初めの姿勢で、凸の形どうしの距離で選ぶ。
// 触れている板を先に、次に reach 以内の板を入れる
export function contactNeighbors(level) {
  const verts = new Map(level.plates.map((p) => [p.id, plateVertices(p)]));
  const grown = (points, g) => (d) => {
    const l = length(d);
    return l > 1e-12 ? add(pointsSupport(points)(d), scale(d, g / l)) : pointsSupport(points)(d);
  };
  const near = new Map(level.plates.map((p) => [p.id, { touch: [], close: [] }]));
  const ps = level.plates;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = verts.get(ps[i].id), b = verts.get(ps[j].id);
      if (!intersects(pointsSupport(a), grown(b, CONTACT.reach))) continue;
      const kind = intersects(pointsSupport(a), grown(b, 0.03)) ? 'touch' : 'close';
      near.get(ps[i].id)[kind].push(ps[j].id);
      near.get(ps[j].id)[kind].push(ps[i].id);
    }
  }
  return new Map([...near].map(([id, { touch, close }]) => [id, [...touch, ...close].slice(0, CONTACT.max)]));
}

// 板の形を、シェーダーに渡す数に直す（板の局所の座標。輪郭は xy、厚みは z）。
// edges: 輪郭の辺ごとの外向きの法線 (nx, ny) と、原点からの距離 c（点 q が外にあるほど nx qx + ny qy - c が大きい）。
// 辺が 4 本より多い形（円柱の当たりの形など）は、円柱なら円の式で、それ以外は外接する長方形で近似する
export function contactShape(p) {
  const half = p.thickness / 2;
  if (p.shape === 'cylinder') return { half, radius: p.radius, cylinder: true, edges: [] };
  let ol = outlineOf(p);
  if (ol.length > MAX_EDGES) {
    const xs = ol.map((q) => q[0]), ys = ol.map((q) => q[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    ol = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }
  const cx = ol.reduce((t, q) => t + q[0], 0) / ol.length, cy = ol.reduce((t, q) => t + q[1], 0) / ol.length;
  const edges = ol.map((a, i) => {
    const b = ol[(i + 1) % ol.length];
    let nx = b[1] - a[1], ny = a[0] - b[0];
    const l = Math.hypot(nx, ny);
    nx /= l;
    ny /= l;
    if (nx * (cx - a[0]) + ny * (cy - a[1]) > 0) { nx = -nx; ny = -ny; }
    return [nx, ny, nx * a[0] + ny * a[1]];
  });
  return { half, radius: 0, cylinder: false, edges };
}

const CONTACT_GLSL = /* glsl */`
uniform int contactCount;
uniform mat4 contactView[${CONTACT.max}];
uniform mat4 contactEdges[${CONTACT.max}];
uniform vec4 contactSize[${CONTACT.max}];
uniform float edgeLight;
varying float vEdge;

// 近くの板（局所の座標の点 q）までの距離。輪郭の柱: 面内は辺の平面の最大、厚みは |z| - 半分
float contactDistance(vec3 q, mat4 e, vec4 size) {
  float dz = abs(q.z) - size.x;
  float dxy = size.z > 0.5
    ? length(q.xy) - size.y
    : max(max(dot(e[0].xy, q.xy) - e[0].z, dot(e[1].xy, q.xy) - e[1].z), max(dot(e[2].xy, q.xy) - e[2].z, dot(e[3].xy, q.xy) - e[3].z));
  return length(max(vec2(dxy, dz), 0.0)) + min(max(dxy, dz), 0.0);
}

float contactOcclusion(vec3 p, vec3 n) {
  // 近くの板ごとに、点と法線を1回だけその板の局所へ移し、法線の向きの各点までの距離の最小を取る
  ${CONTACT.steps.map((_, k) => `float d${k} = 1e3;`).join(' ')}
  for (int i = 0; i < ${CONTACT.max}; i++) {
    if (i >= contactCount) break;
    vec3 q = (contactView[i] * vec4(p, 1.0)).xyz;
    vec3 m = mat3(contactView[i]) * n;
    ${CONTACT.steps.map((h, k) => `d${k} = min(d${k}, contactDistance(q + m * ${h.toFixed(3)}, contactEdges[i], contactSize[i]));`).join('\n    ')}
  }
  float occ = ${CONTACT.steps.map((h, k) => `${CONTACT.weights[k].toFixed(3)} * clamp((${h.toFixed(3)} - d${k}) / ${h.toFixed(3)}, 0.0, 1.0)`).join('\n    + ')};
  return clamp(1.0 - ${CONTACT.strength.toFixed(3)} * occ, ${CONTACT.floor.toFixed(3)}, 1.0);
}
`;

// 板の材質に、縁の光と接する所の暗さを足す（three.js の標準の材質のシェーダーに差し込む）
function shadePlate(mat, edgeLight) {
  const uniforms = {
    contactCount: { value: 0 },
    contactView: { value: Array.from({ length: CONTACT.max }, () => new THREE.Matrix4()) },
    contactEdges: { value: Array.from({ length: CONTACT.max }, () => new THREE.Matrix4()) },
    contactSize: { value: Array.from({ length: CONTACT.max }, () => new THREE.Vector4()) },
    edgeLight: { value: edgeLight },
  };
  mat.userData.shading = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.shading);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float edge;\nvarying float vEdge;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = edge;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CONTACT_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vEdge * edgeLight);')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
if (contactCount > 0) {
  float contactAO = contactOcclusion(-vViewPosition, normal);
  reflectedLight.indirectDiffuse *= contactAO;
  reflectedLight.indirectSpecular *= contactAO;
  reflectedLight.directDiffuse *= mix(1.0, contactAO, ${CONTACT.direct.toFixed(3)});
}`);
  };
}

// 板を描く直前に、近くの板の今の姿勢（カメラの座標 → その板の局所の座標）を入れる
const toLocal = new THREE.Matrix4();
function updateContact(renderer, scene, camera, geometry, material) {
  const u = material.userData.shading;
  if (!u) return;
  const near = this.userData.contactOn ? this.userData.contact ?? [] : [];
  let k = 0;
  for (const { obj, shape } of near) {
    if (!obj.parent) continue;   // 外れて消えた板
    toLocal.copy(obj.matrixWorld).invert().multiply(camera.matrixWorld);
    u.contactView.value[k].copy(toLocal);
    const e = u.contactEdges.value[k].elements;
    for (let c = 0; c < MAX_EDGES; c++) {
      const [nx, ny, d] = shape.edges[c] ?? [0, 0, 1e3];
      e[c * 4] = nx;
      e[c * 4 + 1] = ny;
      e[c * 4 + 2] = d;
      e[c * 4 + 3] = 0;
    }
    u.contactSize.value[k].set(shape.half, shape.radius, shape.cylinder ? 1 : 0, 0);
    k++;
  }
  u.contactCount.value = k;
}

// 接する所の暗さの入り切り（遊んでいる途中で画質を変えたとき）
export function setContact(board, on) {
  for (const obj of board.plates.values()) obj.userData.contactOn = on;
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
// drive は穴の形（既定の 'hex' は六角穴。色の見分けで穴の形を変えるときは THEME.bolt の drives の名前）
function headGeometry(r, knurl = true, drive = 'hex') {
  return cached(`head:${r}:${knurl}:${drive}`, () => {
    const h = BOLT.headHeight * r, N = knurl ? BOLT.knurls : 0, amp = 0.03 * r, steps = knurl ? N * 4 : BOLT.plainSteps;
    const shape = new THREE.Shape();
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const rr = r - amp * (0.5 + 0.5 * Math.cos(N * a));
      if (i === 0) shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    shape.closePath();
    for (const contour of driveContours(drive, r)) {
      const hole = new THREE.Path(contour.map(([x, y]) => new THREE.Vector2(x, y)));
      hole.closePath();
      shape.holes.push(hole);
    }
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

// ---- 穴の形（E2 の色の見分け） ----
// 頭の上から見た穴の輪郭（頭の半径 r の単位で、どれも頭の面の帯に収まる大きさ）。1つの形に輪郭が2つあるもの（二つ穴）もある
const DRIVES = ['hex', 'plus', 'slot', 'square', 'triangle', 'torx', 'spanner', 'triwing'];
export const driveOf = (color) => {
  const d = THEME.drives[color];
  return DRIVES.includes(d) ? d : 'hex';
};
const ring = (n, f) => Array.from({ length: n }, (_, i) => f((i / n) * Math.PI * 2));
const rotate = (pts, a) => pts.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
// 中心から腕を伸ばした形（十字・Y）。腕の向き angles（反時計回りに増える順）、長さ L、半幅 w。
// 腕ごとに先の2つの角と、次の腕との間の内側の角（2本の腕の縁の交わり）を反時計回りに並べる
function arms(angles, L, w) {
  const out = [];
  angles.forEach((a, i) => {
    let b = angles[(i + 1) % angles.length];
    if (b <= a) b += Math.PI * 2;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    out.push([c * L + s * w, s * L - c * w], [c * L - s * w, s * L + c * w]);
    const m = (a + b) / 2, rr = w / Math.sin((b - a) / 2);
    out.push([Math.cos(m) * rr, Math.sin(m) * rr]);
  });
  return out;
}
export function driveContours(drive, r) {
  switch (drive) {
    case 'plus': return [arms([0, Math.PI / 2, Math.PI, Math.PI * 1.5], 0.58 * r, 0.16 * r)];
    case 'slot': return [[[-0.66 * r, -0.15 * r], [0.66 * r, -0.15 * r], [0.66 * r, 0.15 * r], [-0.66 * r, 0.15 * r]]];
    case 'square': return [rotate([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => [x * 0.37 * r, y * 0.37 * r]), Math.PI / 4)];
    case 'triangle': return [ring(3, (a) => [Math.cos(a + Math.PI / 2) * 0.6 * r, Math.sin(a + Math.PI / 2) * 0.6 * r])];
    // 頭の三角形を増やしすぎないよう、トルクスは山と谷を交互に置いた 12 角の星、二つ穴は 7 角形2つで描く（ねじ1本 2000 枚まで）
    case 'torx': return [ring(12, (a) => {
      const rr = (Math.round(a / (Math.PI / 6)) % 2 ? 0.37 : 0.6) * r;
      return [Math.cos(a) * rr, Math.sin(a) * rr];
    })];
    case 'spanner': return [-1, 1].map((sx) => ring(7, (a) => [sx * 0.36 * r + Math.cos(a) * 0.18 * r, Math.sin(a) * 0.18 * r]));
    case 'triwing': return [arms([Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6], 0.6 * r, 0.16 * r)];
    default: return [hexPoints(BOLT.socket * r)];
  }
}

// HUD の印（style.css の .dot と箱の札）に使う、上から見た穴の形の絵（暗い色で塗った SVG の data: URL を CSS の url() で）
export function driveIcon(color) {
  return cached(`icon:${color}`, () => {
    const d = driveContours(driveOf(color), 1).map((c) => `M${c.map(([x, y]) => `${x.toFixed(3)} ${(-y).toFixed(3)}`).join('L')}Z`).join('');
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-0.7 -0.7 1.4 1.4'><path fill='${THEME.bolt.socket}' d='${d}'/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}")`;
  });
}

// 六角穴以外の穴の中: 輪郭をまっすぐ下へ押した壁と、平らな底（頭の上から BOLT.socketDepth の深さ）。
// 頭の穴の壁と重ならないよう、ほんの少し内側に縮める
function driveSocketGeometry(r, drive) {
  return cached(`socket:${r}:${drive}`, () => {
    const h = BOLT.headHeight * r;
    const floorY = h * (1 - BOLT.socketDepth);
    const parts = [];
    for (const contour of driveContours(drive, r)) {
      const c = contour.map(([x, y]) => [x * 0.97, y * 0.97]);
      const floor = new THREE.ShapeGeometry(new THREE.Shape(c.map(([x, y]) => new THREE.Vector2(x, y))));
      floor.rotateX(-Math.PI / 2).translate(0, floorY, 0);
      parts.push(floor);
      const pos = [];
      for (let i = 0; i < c.length; i++) {
        const [ax, ay] = c[i], [bx, by] = c[(i + 1) % c.length];
        // 頭の上から見た (x, y) は、立てた後の (x, -z)
        pos.push(ax, floorY, -ay, bx, floorY, -by, bx, h, -by, ax, floorY, -ay, bx, h, -by, ax, h, -ay);
      }
      const wall = new THREE.BufferGeometry();
      wall.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      wall.computeVertexNormals();
      parts.push(wall);
    }
    return merge(parts);
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
// length はねじ部の長さ × r（既定は盤面の短いねじ。クリアの雨は長いねじを降らせる）。ねじ山は長さに合わせて巻く数を増やす。
// coarse: 分割を粗くする（クリアの雨。画面では小さいので、1本あたりの三角形を 1/3 ほどにする）
function shaftGeometry(r, length = BOLT.length, coarse = false) {
  return cached(`shaft:${r}:${length}:${coarse}`, () => {
    const sd = BOLT.shaft * r, L = length * r;
    const turns = 3 * length / BOLT.length;
    const core = new THREE.CylinderGeometry(sd / 2, sd / 2, L, coarse ? 8 : 12).translate(0, -L / 2, 0);
    class Helix extends THREE.Curve {
      getPoint(t, out = new THREE.Vector3()) {
        const a = t * Math.PI * 2 * turns;
        return out.set(Math.cos(a) * sd / 2, -t * L * 0.95 - 0.02 * r, Math.sin(a) * sd / 2);
      }
    }
    const thread = new THREE.TubeGeometry(new Helix(), Math.round((coarse ? 6 : 12) * turns), 0.05 * r, coarse ? 3 : 4, false);
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

const socketOf = (r, drive) => (drive === 'hex' ? socketGeometry(r) : driveSocketGeometry(r, drive));

function screwObject(s, r, knurl = true, drive = 'hex') {
  const g = new THREE.Group();
  const color = SCREW_COLORS[s.color] ?? 0x888888;
  // 頭と六角穴は板に沈めた分だけ下げる。当たり判定（タップ）は頭と六角穴で取る
  const sink = BOLT.sink * r;
  const head = new THREE.Mesh(headGeometry(r, knurl, drive), headMaterial(color));
  head.userData.part = 'head';
  head.position.y = -sink;
  g.add(head);
  const socket = new THREE.Mesh(socketOf(r, drive), socketMaterial());
  socket.userData.part = 'socket';
  Object.assign(g.userData, { knurl, drive });
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

// 盤面の外で描くねじ（クリアの雨、F）の形と材質。頭の上面が y = 1.2r、ねじ部の先が y = -length·r。
// 返り値 [{ geometry, material }]（頭・穴・ねじ部）。形と材質は盤面のねじと共有する（作り直さない）。coarse はねじ部の分割を粗く
export function screwParts(color, r, { knurl = true, drive = 'hex', length = BOLT.length, coarse = false } = {}) {
  return [
    { geometry: headGeometry(r, knurl, drive), material: headMaterial(SCREW_COLORS[color] ?? 0x888888) },
    { geometry: socketOf(r, drive), material: socketMaterial() },
    { geometry: shaftGeometry(r, length, coarse), material: shaftMaterial() },
  ];
}

// 作った盤面のねじの頭と穴を差し替える（遊んでいる途中で画質や穴の形の設定を変えたとき。盤面は作り直さない）
function restyleScrews(board, change) {
  for (const g of board.screws.values()) {
    Object.assign(g.userData, change(g.userData));
    const { radius: r, knurl, drive } = g.userData;
    for (const c of g.children) {
      if (c.userData.part === 'head') c.geometry = headGeometry(r, knurl, drive);
      if (c.userData.part === 'socket') c.geometry = socketOf(r, drive);
    }
  }
}
// ローレットあり・なし（設定の画質）
export const setKnurl = (board, knurl) => restyleScrews(board, () => ({ knurl }));
// 色ごとの穴の形か、全部六角穴か（設定「ねじ穴の形」）
export const setDrives = (board, on) => restyleScrews(board, (u) => ({ drive: on ? driveOf(u.color) : 'hex' }));
