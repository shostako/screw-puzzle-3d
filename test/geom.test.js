import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { eulerMatrix, quaternionMatrix, applyMatrix, intersects, pointsSupport, cylinderSupport } from '../src/geom.js';

// 決まった並びの乱数（テストを毎回同じにする）
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

describe('回転', () => {
  it('Euler から作る行列が three.js（順番 XYZ）と同じ', () => {
    const r = rng(1);
    for (let i = 0; i < 50; i++) {
      const e = [r() * 7 - 3.5, r() * 7 - 3.5, r() * 7 - 3.5], v = [r() - 0.5, r() - 0.5, r() - 0.5];
      const want = new THREE.Vector3(...v).applyEuler(new THREE.Euler(...e, 'XYZ'));
      const got = applyMatrix(eulerMatrix(e), v);
      expect(got[0]).toBeCloseTo(want.x, 10);
      expect(got[1]).toBeCloseTo(want.y, 10);
      expect(got[2]).toBeCloseTo(want.z, 10);
    }
  });

  it('四元数から作る行列が three.js と同じ', () => {
    const r = rng(2);
    for (let i = 0; i < 50; i++) {
      const q = new THREE.Quaternion(r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5).normalize();
      const v = [r() - 0.5, r() - 0.5, r() - 0.5];
      const want = new THREE.Vector3(...v).applyQuaternion(q);
      const got = applyMatrix(quaternionMatrix([q.x, q.y, q.z, q.w]), v);
      expect(got[0]).toBeCloseTo(want.x, 10);
      expect(got[1]).toBeCloseTo(want.y, 10);
      expect(got[2]).toBeCloseTo(want.z, 10);
    }
  });
});

// 軸に平行な直方体（[lo, hi]）
const boxPoints = (lo, hi) => {
  const pts = [];
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) pts.push([x, y, z]);
  return pts;
};

// z 軸に平行な円柱と、軸に平行な直方体の交わりの正解: z の区間が重なり、xy で円が長方形に届く
function exact(c, z0, z1, r, lo, hi) {
  if (Math.min(z1, hi[2]) <= Math.max(z0, lo[2])) return false;
  const dx = Math.max(lo[0] - c[0], 0, c[0] - hi[0]), dy = Math.max(lo[1] - c[1], 0, c[1] - hi[1]);
  return Math.hypot(dx, dy) < r;
}

describe('凸な形どうしの交わり（GJK）', () => {
  it('円柱と直方体: 乱数の配置で、正解の式と一致する', () => {
    const r = rng(3);
    let hits = 0, n = 0;
    for (let i = 0; i < 4000; i++) {
      const c = [r() * 2 - 1, r() * 2 - 1], z0 = r() * 3 - 2, z1 = z0 + 0.1 + r() * 3, rad = 0.05 + r() * 0.8;
      const lo = [r() * 3 - 2, r() * 3 - 2, r() * 3 - 2];
      const hi = [lo[0] + 0.05 + r() * 2, lo[1] + 0.05 + r() * 2, lo[2] + 0.05 + r() * 2];
      const want = exact(c, z0, z1, rad, lo, hi);
      // 境目すれすれ（1e-6 以内）は、どちらの答えでもよいので数えない
      const near = [exact(c, z0 - 1e-6, z1 + 1e-6, rad + 1e-6, lo, hi), exact(c, z0 + 1e-6, z1 - 1e-6, rad - 1e-6, lo, hi)];
      if (near[0] !== near[1]) continue;
      const got = intersects(cylinderSupport([...c, z0], [...c, z1], rad), pointsSupport(boxPoints(lo, hi)));
      expect(got, JSON.stringify({ c, z0, z1, rad, lo, hi })).toBe(want);
      n++; if (want) hits++;
    }
    // 交わる場合と交わらない場合の両方を十分に調べている
    expect(hits).toBeGreaterThan(n * 0.2);
    expect(hits).toBeLessThan(n * 0.8);
  });

  it('全体を同じ回転で回しても答えは変わらない', () => {
    const r = rng(4);
    for (let i = 0; i < 1000; i++) {
      const m = eulerMatrix([r() * 7, r() * 7, r() * 7]);
      const c = [r() * 2 - 1, r() * 2 - 1], z0 = r() * 3 - 2, z1 = z0 + 0.1 + r() * 3, rad = 0.05 + r() * 0.8;
      const lo = [r() * 3 - 2, r() * 3 - 2, r() * 3 - 2];
      const hi = [lo[0] + 0.05 + r() * 2, lo[1] + 0.05 + r() * 2, lo[2] + 0.05 + r() * 2];
      const near = [exact(c, z0 - 1e-6, z1 + 1e-6, rad + 1e-6, lo, hi), exact(c, z0 + 1e-6, z1 - 1e-6, rad - 1e-6, lo, hi)];
      if (near[0] !== near[1]) continue;
      const rot = p => applyMatrix(m, p);
      const got = intersects(
        cylinderSupport(rot([...c, z0]), rot([...c, z1]), rad),
        pointsSupport(boxPoints(lo, hi).map(rot)),
      );
      expect(got).toBe(near[0]);
    }
  });
});

describe('境目の近く', () => {
  it('円が長方形の角に 1e-3 だけ届けば交わり、1e-3 足りなければ交わらない', () => {
    const box = pointsSupport(boxPoints([0, 0, 0], [1, 1, 1]));
    for (const a of [0, 0.3, 0.7, 1.2]) {
      // 角 (0,0) から斜め外の向き a に、距離 0.5 ± 1e-3 の所を中心にする
      const dir = [-Math.cos(a / 1.2 * Math.PI / 2), -Math.sin(a / 1.2 * Math.PI / 2)];
      const at = d => [dir[0] * d, dir[1] * d];
      const hit = intersects(cylinderSupport([...at(0.499), -1], [...at(0.499), 2], 0.5), box);
      const miss = intersects(cylinderSupport([...at(0.501), -1], [...at(0.501), 2], 0.5), box);
      expect(hit).toBe(true);
      expect(miss).toBe(false);
    }
  });
});
