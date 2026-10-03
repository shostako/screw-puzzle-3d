import { describe, it, expect } from 'vitest';
import { flattenTree, partTree, depthOf, defaultU } from '../src/parts.js';
import { THEMES } from '../src/themes.js';
import { generateLevel, KINDS, ALL_KINDS } from '../src/generator.js';
import { validateBoard, blockerFor, plateFrame, plateVertices, outlineOf, circleOutline, CONTACT } from '../src/board.js';
import { safeBlocker } from '../src/safe.js';
import { hiddenAtStart } from '../src/stages.js';
import { newGame, removeScrew, status, BOX_SIZE } from '../src/rules.js';
import { intersects, pointsSupport, dot, cross, length, sub } from '../src/geom.js';

const close = (a, b) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 9));

describe('部品の木（parts.js）', () => {
  it('子の位置と向きは、親の局所の軸で書いたものが盤面の座標に直る', () => {
    // 根は法線が +y（u = +x、局所の y = n × u = -z）。子はその上（局所 z）に載り、法線は根の -y（= 盤面の +z）
    const parts = flattenTree({
      id: 'root', size: [4, 4], thickness: 1, at: [1, 2, 3], n: [0, 1, 0], u: [1, 0, 0],
      children: [{ id: 'kid', size: [2, 2], thickness: 0.5, at: [0.5, 0, 0.75], n: [0, -1, 0], u: [1, 0, 0],
        children: [{ id: 'grand', size: [1, 1], thickness: 0.2, at: [0, 0, 0.35] }] }],
    });
    expect(parts.map((p) => p.plate.id)).toEqual(['root', 'kid', 'grand']);
    expect(parts.map((p) => p.plate.parent)).toEqual([null, 'root', 'kid']);
    expect(parts.map((p) => p.depth)).toEqual([0, 1, 2]);
    const [root, kid, grand] = parts.map((p) => plateFrame(p.plate));
    close(root.n, [0, 1, 0]);
    close(root.v, [0, 0, -1]);
    close(kid.center, [1.5, 2.75, 3]);
    close(kid.n, [0, 0, 1]);
    close(kid.u, [1, 0, 0]);
    close(kid.v, [0, 1, 0]);
    close(grand.center, [1.5, 2.75, 3.35]);
    close(grand.n, [0, 0, 1]);
  });

  it('軸はどれも単位の長さで直交し、右手系', () => {
    for (const n of [[0, 0, 1], [1, 0, 0], [0, -1, 0], [0.6, 0.8, 0]]) {
      const u = defaultU(n);
      expect(length(u)).toBeCloseTo(1, 12);
      expect(dot(u, n)).toBeCloseTo(0, 12);
    }
    const [p] = flattenTree({ id: 'a', size: [2, 2], thickness: 0.3, n: [0.6, 0.8, 0], u: [-0.8, 0.6, 0] });
    const { u, v, n } = plateFrame(p.plate);
    close(cross(u, v), n);
  });

  it('id が重なる木や、u が n と平行な部品は受け付けない', () => {
    expect(() => flattenTree({ id: 'a', size: [1, 1], thickness: 1, children: [{ id: 'a', size: [1, 1], thickness: 1 }] })).toThrow();
    expect(() => flattenTree({ id: 'a', size: [1, 1], thickness: 1, n: [1, 0, 0], u: [1, 0, 0] })).toThrow();
  });

  it('盤面の parent から木をたどれる（parent の無い家具の板はそれぞれ根）', () => {
    const level = generateLevel(1, { kind: 'car' });
    const { roots, children } = partTree(level);
    expect(roots).toEqual(['chassis']);
    expect(children.get('chassis')).toEqual(expect.arrayContaining(['wheel1', 'wheel2', 'wheel3', 'wheel4', 'cabin']));
    expect(children.get('cabin')).toEqual(expect.arrayContaining(['window1', 'window2']));
    expect(depthOf(level, 'window1')).toBe(2);
    const box = generateLevel(1, { kind: 'box' });
    expect(partTree(box).roots).toHaveLength(box.plates.length);
  });

  it('円柱の当たりの形は、半径の円に外接する多角形', () => {
    const ol = circleOutline(1.15);
    for (const [x, y] of ol) expect(Math.hypot(x, y)).toBeGreaterThan(1.15);
    // 辺の中点（多角形の一番内側）がちょうど円に接する
    const [a, b] = ol;
    expect(Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)).toBeCloseTo(1.15, 9);
    expect(outlineOf({ shape: 'cylinder', radius: 1.15 })).toEqual(ol);
  });
});

describe('題材（themes.js）', () => {
  const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
  const levels = new Map();
  const level = (kind, seed) => {
    const key = `${kind}:${seed}`;
    if (!levels.has(key)) levels.set(key, generateLevel(seed, { kind }));
    return levels.get(key);
  };

  it('kind を省いたときは今までの家具だけから選ぶ（M6 からのシードの盤面を変えない）', () => {
    expect(KINDS).toEqual(['box', 'shelf', 'table']);
    expect(ALL_KINDS).toEqual([...KINDS, ...THEMES]);
    for (let seed = 1; seed <= 30; seed++) expect(KINDS).toContain(generateLevel(seed).meta.kind);
  });

  for (const kind of THEMES) {
    it(`${kind}: 盤面がルールにも形にも正しく、見つけた手順でクリアになる`, () => {
      for (const seed of SEEDS) {
        const l = level(kind, seed);
        expect(l.meta.kind).toBe(kind);
        expect(() => newGame(l)).not.toThrow();
        expect(() => validateBoard(l)).not.toThrow();
        expect(l.screws.length % BOX_SIZE).toBe(0);
        for (const p of l.plates) expect(l.screws.filter((s) => s.plate === p.id).length, `${seed} ${p.id}`).toBeGreaterThanOrEqual(2);
        for (const isBlocked of [safeBlocker(l), blockerFor(l)]) {
          let st = newGame(l);
          for (const id of l.meta.solution) {
            const r = removeScrew(st, id, isBlocked);
            expect(r.ok, `${kind} シード ${seed} の ${id}: ${r.reason}`).toBe(true);
            st = r.state;
          }
          expect(status(st, isBlocked)).toBe('cleared');
        }
      }
    });

    it(`${kind}: 部品は1本の木で、どの部品も親に触れ、ほかの部品と重ならない`, () => {
      for (const seed of SEEDS) {
        const l = level(kind, seed);
        expect(partTree(l).roots).toHaveLength(1);
        const byId = new Map(l.plates.map((p) => [p.id, p]));
        const shape = (p, shrink) => pointsSupport(plateVertices(p, p, shrink));
        for (const p of l.plates) {
          if (p.parent) expect(intersects(shape(p, -0.01), shape(byId.get(p.parent), -0.01)), `${seed} ${p.id} が親から離れている`).toBe(true);
        }
        for (let i = 0; i < l.plates.length; i++) {
          for (let j = i + 1; j < l.plates.length; j++) {
            const a = l.plates[i], b = l.plates[j];
            expect(intersects(shape(a, 0.01), shape(b, 0.01)), `${kind} シード ${seed}: ${a.id} と ${b.id} が重なる`).toBe(false);
          }
        }
      }
    });

    it(`${kind}: 飾りの部品がねじを隠し、回したり外したりして探す盤面になる`, () => {
      const hidden = SEEDS.filter((seed) => hiddenAtStart(level(kind, seed)) > 0).length;
      expect(hidden).toBe(SEEDS.length);
      // 下や裏を向いたねじがある（最初の向きのままでは全部は見えない）
      const l = level(kind, 1);
      expect(new Set(l.screws.map((s) => s.dir.map((x) => Math.sign(Math.round(x * 100))).join(','))).size).toBeGreaterThanOrEqual(3);
    });
  }

  it('家の屋根板のねじは斜めを向く（軸に沿わない部品もそのまま扱える）', () => {
    const l = level('house', 1);
    const roofScrews = l.screws.filter((s) => s.plate === 'roofR' || s.plate === 'roofL');
    expect(roofScrews.length).toBeGreaterThanOrEqual(4);
    for (const s of roofScrews) expect(Math.max(...s.dir.map(Math.abs))).toBeLessThan(0.95);
  });

  it('同じシードなら同じ題材の盤面', () => {
    for (const kind of THEMES) expect(JSON.stringify(generateLevel(5, { kind }))).toBe(JSON.stringify(level(kind, 5)));
  });

  it('題材の盤面もスマホで待てる時間で作れる', () => {
    for (const kind of THEMES) {
      const times = SEEDS.map((seed) => {
        const t = performance.now();
        generateLevel(seed + 500, { kind });
        return performance.now() - t;
      });
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      // 部品が多いぶん家具（平均 100ms・最悪 1 秒）より遅い。手元の数倍遅いスマホでも 1〜2 秒に収まる目安
      expect(avg, kind).toBeLessThan(250);
      expect(Math.max(...times), kind).toBeLessThan(1500);
    }
  });

  it('触れて付く部品は、隙間なく触れている（CONTACT の幅で広げると重なる）', () => {
    // 車輪は車体の横に、屋根板は屋根の斜面に、ちょうど触れている（離れていると、外したときに落ち方が変わる）
    const l = level('house', 2);
    const byId = new Map(l.plates.map((p) => [p.id, p]));
    const gap = (a, b, d) => intersects(pointsSupport(plateVertices(a, a, -d)), pointsSupport(plateVertices(b, b, -d)));
    expect(gap(byId.get('roofR'), byId.get('roof'), CONTACT)).toBe(true);
    const car = level('car', 2);
    const cb = new Map(car.plates.map((p) => [p.id, p]));
    expect(gap(cb.get('wheel1'), cb.get('chassis'), CONTACT)).toBe(true);
    expect(length(sub(cb.get('wheel1').position, cb.get('chassis').position))).toBeGreaterThan(1);
  });
});
