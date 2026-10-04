// 普段の画面の背景（F2）: 立体を回した分だけ町並みをずらす
import { describe, it, expect } from 'vitest';
import { yawDelta, townShift, LAYERS } from '../src/backdrop.js';

// 軸 (x, y, z)（単位ベクトル）まわりに a ラジアン回す四元数 [x, y, z, w]
const axis = (x, y, z, a) => [x * Math.sin(a / 2), y * Math.sin(a / 2), z * Math.sin(a / 2), Math.cos(a / 2)];
// 四元数の積 a * b
const mul = ([ax, ay, az, aw], [bx, by, bz, bw]) => [
  aw * bx + ax * bw + ay * bz - az * by,
  aw * by - ax * bz + ay * bw + az * bx,
  aw * bz + ax * by - ay * bx + az * bw,
  aw * bw - ax * bx - ay * by - az * bz,
];

describe('背景の町並み', () => {
  it('上下の軸まわりに回した角度を、元の向きによらず取り出す', () => {
    const start = mul(axis(1, 0, 0, 0.5), axis(0, 1, 0, -0.6));   // 斜め上から見た向き
    for (const a of [0.01, 0.3, -0.7, 2.5]) {
      const turned = mul(axis(0, 1, 0, a), start);   // 画面の上下の軸（世界の y）で回す
      expect(yawDelta(turned, start)).toBeCloseTo(a, 9);
    }
    expect(yawDelta(start, start)).toBeCloseTo(0, 12);
    // 四元数の符号が逆（同じ向き）でも同じ
    expect(yawDelta(mul(axis(0, 1, 0, 0.4), start).map((v) => -v), start)).toBeCloseTo(0.4, 9);
  });

  it('縦に倒すだけでは町並みは動かない', () => {
    const start = axis(0, 1, 0, 0.3);
    expect(yawDelta(mul(axis(1, 0, 0, 0.8), start), start)).toBeCloseTo(0, 1);
    expect(Math.abs(yawDelta(mul(axis(1, 0, 0, 0.2), start), start))).toBeLessThan(0.01);
  });

  it('ずれは右へ回すほど増え、繰り返しの幅で折り返す', () => {
    const { tile, rate } = LAYERS[1];
    expect(townShift(0, tile, rate)).toBe(0);
    expect(townShift(1, tile, rate)).toBeCloseTo(rate);
    expect(townShift(-1, tile, rate)).toBeCloseTo(tile - rate);
    for (const yaw of [-100, -3, 0.5, 7, 250]) {
      const x = townShift(yaw, tile, rate);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(tile);
    }
    // 遠い列ほどゆっくり
    expect(LAYERS[0].rate).toBeLessThan(LAYERS[1].rate);
  });
});
