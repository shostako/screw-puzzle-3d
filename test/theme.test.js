import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { THEME, cssVariables, skyFor, skyVariables } from '../src/theme.js';
import { COLORS } from '../src/generator.js';
import { buildBoard, BOLT, driveOf, driveContours, driveIcon, setDrives, contactNeighbors, contactShape } from '../src/scene.js';
import { BOX_LEVEL } from '../src/levels/box.js';
import { stageLevel } from '../src/stages.js';
import { SCREW_RADIUS, outlineOf } from '../src/board.js';
import { generateLevel } from '../src/generator.js';
import { THEMES } from '../src/themes.js';

const meshesOf = (obj) => {
  const out = [];
  obj.traverse((o) => o.isMesh && out.push(o));
  return out;
};

describe('見た目の表（テーマ）', () => {
  it('ルールの色すべてに、ねじの色と HUD の CSS 変数がある', () => {
    const vars = cssVariables();
    for (const c of COLORS) {
      expect(THEME.screwColors[c]).toMatch(/^#[0-9a-f]{6}$/);
      expect(vars[`--${c}`]).toBe(THEME.screwColors[c]);
    }
  });
});

describe('盤面の立体（scene.js）', () => {
  it('描く回数: 板は1枚1回、ねじは1本3回まで（M8 の約束）', () => {
    const level = stageLevel(7);
    const board = buildBoard(level);
    for (const p of board.plates.values()) expect(meshesOf(p)).toHaveLength(1);
    for (const s of board.screws.values()) expect(meshesOf(s).length).toBeLessThanOrEqual(3);
  });

  it('形と材質は、ねじどうしで使い回す', () => {
    const board = buildBoard(BOX_LEVEL);
    const geos = new Set(), mats = new Set();
    for (const s of board.screws.values()) for (const m of meshesOf(s)) { geos.add(m.geometry); mats.add(m.material); }
    const colors = new Set(BOX_LEVEL.screws.map((s) => s.color));
    expect(geos.size).toBe(3);
    expect(mats.size).toBe(colors.size + 2);
  });

  it('角を丸めた板の外形は、当たりの形（size と厚み）からはみ出さない', () => {
    const board = buildBoard(BOX_LEVEL);
    for (const p of BOX_LEVEL.plates) {
      const geo = board.plates.get(p.id).geometry;
      geo.computeBoundingBox();
      const { min, max } = geo.boundingBox;
      const [w, h] = p.size;
      expect(max.x - min.x).toBeCloseTo(w, 3);
      expect(max.y - min.y).toBeCloseTo(h, 3);
      expect(max.z - min.z).toBeCloseTo(p.thickness, 3);
    }
  });

  it('題材の部品（丸めた箱・円柱・三角の屋根）の外形も当たりの形からはみ出さず、色は部品の色の表から取る', () => {
    for (const kind of THEMES) {
      const level = generateLevel(1, { kind });
      const board = buildBoard(level);
      for (const p of level.plates) {
        const mesh = board.plates.get(p.id);
        expect(meshesOf(mesh)).toHaveLength(1);
        const geo = mesh.geometry;
        geo.computeBoundingBox();
        const { min, max } = geo.boundingBox;
        const ol = outlineOf(p);
        const xs = ol.map((q) => q[0]), ys = ol.map((q) => q[1]);
        // 円柱は外接する多角形の辺の中点で円に接するので、面取りの丸めの誤差（1e-4 ほど）だけ許す
        const tol = p.shape === 'cylinder' ? 1e-3 : 1e-6;
        expect(min.x).toBeGreaterThanOrEqual(Math.min(...xs) - tol);
        expect(max.x).toBeLessThanOrEqual(Math.max(...xs) + tol);
        expect(min.y).toBeGreaterThanOrEqual(Math.min(...ys) - tol);
        expect(max.y).toBeLessThanOrEqual(Math.max(...ys) + tol);
        expect(max.z - min.z).toBeCloseTo(p.thickness, 3);
        if (p.shape === 'cylinder') expect(max.x - min.x).toBeCloseTo(2 * p.radius, 3);
        expect(THEME.partColors[p.color], `${kind} ${p.id} の色 ${p.color}`).toMatch(/^#[0-9a-f]{6}$/);
        expect(mesh.material.color.getHexString()).toBe(THEME.partColors[p.color].slice(1));
      }
    }
  });

  it('キャップボルトの頭は当たりの半径に収まり、板から出る高さは札の厚み（0.3）より低い', () => {
    const board = buildBoard(BOX_LEVEL);
    const s = board.screws.values().next().value;
    const head = meshesOf(s)[0];
    head.geometry.computeBoundingBox();
    const { min, max } = head.geometry.boundingBox;
    expect(Math.max(max.x, -min.x, max.z, -min.z)).toBeLessThanOrEqual(SCREW_RADIUS + 1e-6);
    expect(min.y).toBeCloseTo(0, 6);
    const above = max.y + head.position.y;
    expect(above).toBeCloseTo((BOLT.headHeight - BOLT.sink) * SCREW_RADIUS, 6);
    expect(above).toBeLessThan(0.3);
    // ねじ部は板（厚み 0.3）の中に収まり、裏へ突き出ない
    const shaft = meshesOf(s)[2];
    shaft.geometry.computeBoundingBox();
    expect(-(shaft.geometry.boundingBox.min.y + shaft.position.y)).toBeLessThanOrEqual(0.3);
  });

  it('ねじの真ん中（六角穴）をレイキャストしても、ねじの id が分かる', () => {
    const board = buildBoard(BOX_LEVEL);
    const [id, s] = board.screws.entries().next().value;
    board.root.updateMatrixWorld(true);
    const p = s.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(s.quaternion);
    const ray = new THREE.Raycaster(p.clone().addScaledVector(dir, 3), dir.clone().negate());
    const hit = ray.intersectObject(s, true)[0];
    expect(hit).toBeTruthy();
    let o = hit.object;
    while (o && !o.userData.screwId) o = o.parent;
    expect(o.userData.screwId).toBe(id);
  });
});

describe('質感と光（E2）', () => {
  const tris = (g) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

  it('ねじ穴の形: 色ごとに違う形で、どれも頭の面の帯（面取りの内側）に収まる', () => {
    const drives = COLORS.map(driveOf);
    expect(new Set(drives).size).toBe(COLORS.length);
    expect(driveOf('red')).toBe('hex');
    for (const d of drives) {
      for (const c of driveContours(d, SCREW_RADIUS)) {
        expect(c.length).toBeGreaterThanOrEqual(3);
        for (const [x, y] of c) expect(Math.hypot(x, y)).toBeLessThan(0.86 * SCREW_RADIUS);
      }
    }
  });

  it('ねじ穴の形を色ごとにしても、描く回数はねじ1本3回、三角形はねじ1本 2000 枚と全体 8 万枚以内。戻すと六角の盤面と同じ', () => {
    for (const n of [7, 23, 30]) {
      const level = stageLevel(n);
      const board = buildBoard(level, { drives: true });
      let total = 0;
      for (const s of board.screws.values()) {
        const ms = meshesOf(s);
        expect(ms.length).toBeLessThanOrEqual(3);
        const t = ms.reduce((k, m) => k + tris(m.geometry), 0);
        expect(t).toBeLessThanOrEqual(2000);
      }
      board.root.traverse((m) => { if (m.isMesh) total += tris(m.geometry); });
      expect(total).toBeLessThanOrEqual(80000);
      setDrives(board, false);
      const plain = buildBoard(level);
      const geoOf = (b) => [...b.screws.values()].map((s) => meshesOf(s).map((m) => m.geometry));
      expect(geoOf(board)).toEqual(geoOf(plain));
    }
  });

  it('色ごとの穴の頭も、真ん中をレイキャストするとねじの id が分かる', () => {
    const board = buildBoard(BOX_LEVEL, { drives: true });
    board.root.updateMatrixWorld(true);
    for (const [id, s] of board.screws) {
      const p = s.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(s.quaternion);
      const hit = new THREE.Raycaster(p.clone().addScaledVector(dir, 3), dir.clone().negate()).intersectObject(s, true)[0];
      expect(hit, id).toBeTruthy();
    }
  });

  it('HUD の穴の形の絵は、外へ読みに行かない data: URL', () => {
    for (const c of COLORS) expect(driveIcon(c)).toMatch(/^url\("data:image\/svg\+xml,/);
  });

  it('板の面取りの帯に縁の光の印（edge）が付き、上下の面と側面には付かない', () => {
    for (const level of [BOX_LEVEL, generateLevel(1, { kind: 'car' })]) {
      const board = buildBoard(level);
      for (const p of board.plates.values()) {
        const e = p.geometry.getAttribute('edge');
        expect(e.count).toBe(p.geometry.getAttribute('position').count);
        const on = Array.from(e.array).filter((v) => v === 1).length;
        expect(on).toBeGreaterThan(0);
        expect(on).toBeLessThan(e.count / 2);
      }
    }
  });

  it('接する所の暗さ: 近くの板は最大 contact.max 枚で、触れている板（箱のふたと壁）を必ず含み、組は互いに見える', () => {
    const near = contactNeighbors(BOX_LEVEL);
    for (const [id, ids] of near) {
      expect(ids.length).toBeLessThanOrEqual(THEME.contact.max);
      expect(ids).not.toContain(id);
    }
    const top = BOX_LEVEL.plates.find((p) => p.position[1] === Math.max(...BOX_LEVEL.plates.map((q) => q.position[1])));
    expect(near.get(top.id).length).toBeGreaterThanOrEqual(1);
    for (const level of [stageLevel(12), generateLevel(3, { kind: 'house' })]) {
      const m = contactNeighbors(level);
      for (const [id, ids] of m) for (const j of ids) if (m.get(j).length < THEME.contact.max) expect(m.get(j)).toContain(id);
    }
  });

  it('接する所の暗さに渡す形: 板の中の点は輪郭の辺の内側（距離が負）、外の点は外側', () => {
    for (const level of [BOX_LEVEL, generateLevel(3, { kind: 'house' })]) {
      for (const p of level.plates) {
        const sh = contactShape(p);
        expect(sh.half).toBeCloseTo(p.thickness / 2, 9);
        const ol = outlineOf(p);
        const cx = ol.reduce((t, q) => t + q[0], 0) / ol.length, cy = ol.reduce((t, q) => t + q[1], 0) / ol.length;
        const dist = (x, y) => (sh.cylinder ? Math.hypot(x, y) - sh.radius : Math.max(...sh.edges.map(([nx, ny, c]) => nx * x + ny * y - c)));
        expect(dist(cx, cy)).toBeLessThan(0);
        for (const [x, y] of ol) expect(dist(x * 1.2 + cx * -0.2, y * 1.2 + cy * -0.2)).toBeGreaterThan(-1e-9);
        expect(sh.edges.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it('空とマット: 題材ごとの色があり、載っていない種類は既定の空', () => {
    for (const kind of THEMES) {
      const v = skyVariables(kind);
      for (const k of ['--sky-top', '--sky-mid', '--sky-bottom', '--mat']) expect(v[k]).toMatch(/^#[0-9a-f]{6}$/);
      expect(v['--sky-top']).not.toBe(THEME.sky[0]);
    }
    expect(skyVariables('box')).toEqual({ '--sky-top': THEME.sky[0], '--sky-mid': THEME.sky[1], '--sky-bottom': THEME.sky[2], '--mat': THEME.mat });
    expect(skyFor(undefined).sky).toEqual(THEME.sky);
  });

  it('白に近い板（明るさ 0.9 より上）はマットより暗い。板の色は D1 の淡い色より色味がある', () => {
    const lum = (hex) => {
      const c = new THREE.Color(hex);
      return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;   // 線形の明るさ
    };
    for (const c of [...THEME.plateColors, ...Object.values(THEME.partColors)]) expect(lum(c)).toBeLessThan(lum(THEME.mat));
    for (const kind of THEMES) for (const c of THEME.plateColors) expect(lum(c)).toBeLessThan(lum(skyFor(kind).mat));
  });
});
