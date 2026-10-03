import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { THEME, cssVariables } from '../src/theme.js';
import { COLORS } from '../src/generator.js';
import { buildBoard, BOLT } from '../src/scene.js';
import { BOX_LEVEL } from '../src/levels/box.js';
import { stageLevel } from '../src/stages.js';
import { SCREW_RADIUS } from '../src/board.js';

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
