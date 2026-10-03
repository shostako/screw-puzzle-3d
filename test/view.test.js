import { describe, it, expect } from 'vitest';
import { dragRotation, zoomDistance, radPerPx, RAD_PER_PX, MIN_DISTANCE, MAX_DISTANCE, fitRegion, fitDistance, fitPoints, spreadPx, focalPx, FIT_FILL, createInertia, INERTIA, ZOOM_RANGE } from '../src/view.js';

describe('ドラッグから回転', () => {
  it('右へのドラッグは縦軸（+Y）まわりに回す', () => {
    const r = dragRotation(100, 0);
    expect(r.axis).toEqual([0, 1, 0]);
    expect(r.angle).toBeCloseTo(100 * RAD_PER_PX);
  });

  it('下へのドラッグは横軸（+X）まわりに回す', () => {
    expect(dragRotation(0, 50).axis).toEqual([1, 0, 0]);
  });

  it('斜めのドラッグは単位ベクトルの軸と長さに比例した角度', () => {
    const r = dragRotation(30, 40, 0.02);
    expect(r.axis[0]).toBeCloseTo(0.8);
    expect(r.axis[1]).toBeCloseTo(0.6);
    expect(r.angle).toBeCloseTo(1);
  });

  it('動いていなければ回さない', () => {
    expect(dragRotation(0, 0).angle).toBe(0);
  });
});

describe('画面の大きさに合わせた回る速さ', () => {
  it('短い辺を端から端までなぞると半回転する（縦でも横でも）', () => {
    expect(dragRotation(390, 0, radPerPx(390, 844)).angle).toBeCloseTo(Math.PI);
    expect(dragRotation(0, 430, radPerPx(932, 430)).angle).toBeCloseTo(Math.PI);
  });
  it('小さい画面でも短い辺 320 より速くは回らない', () => {
    expect(radPerPx(280, 500)).toBeCloseTo(Math.PI / 320);
  });
  it('大きさが分からなければ既定の速さ', () => {
    expect(radPerPx(0, 0)).toBe(RAD_PER_PX);
    expect(radPerPx(NaN, 800)).toBe(RAD_PER_PX);
  });
});

describe('ピンチで寄り引き', () => {
  it('指が広がると近づく', () => {
    expect(zoomDistance(8, 2)).toBe(MIN_DISTANCE);
    expect(zoomDistance(8, 1.25)).toBeCloseTo(6.4);
  });
  it('指が狭まると離れる。範囲の外には出ない', () => {
    expect(zoomDistance(8, 0.8)).toBeCloseTo(10);
    expect(zoomDistance(8, 0.1)).toBe(MAX_DISTANCE);
  });
  it('おかしな比は無視する', () => {
    expect(zoomDistance(8, 0)).toBe(8);
    expect(zoomDistance(8, NaN)).toBe(8);
  });
});

describe('構図: 盤面を空きに収める距離（E1）', () => {
  // 球の見かけの半径（ピクセル）。中心が画面の真ん中にあるとき
  const apparent = (R, d, h, fov) => (h / 2 / Math.tan((fov * Math.PI) / 360)) * R / Math.sqrt(d * d - R * R);

  it('空きは HUD の下端からボタン列の上端まで、左右に余白', () => {
    const r = fitRegion(390, 844, 200, 600);
    expect(r).toEqual({ x: 195, y: 400, width: 366, height: 400 });
  });
  it('ボタン列が高い小さな画面では、横幅の 0.95 倍までは下へ延ばす', () => {
    const r = fitRegion(360, 640, 200, 396);
    expect(r.height).toBeCloseTo(0.95 * 336);
    expect(r.y + r.height / 2).toBeLessThanOrEqual(640);
  });
  it('収めた距離では、球の直径が空きの短い辺の FIT 割になる', () => {
    const region = fitRegion(390, 844, 200, 600);
    for (const R of [3, 5.2, 8]) {
      const d = fitDistance(R, region, 844, 60, 0.9);
      expect(apparent(R, d, 844, 60) * 2).toBeCloseTo(0.9 * 366, 6);
    }
  });
  it('大きな盤面ほど遠く、距離は半径に比例する', () => {
    const region = fitRegion(390, 844, 200, 600);
    const a = fitDistance(4, region, 844, 60), b = fitDistance(8, region, 844, 60);
    expect(b / a).toBeCloseTo(2, 9);
  });
  it('点の集まりは、収めた距離で空きの幅か高さの FIT 割にちょうど届く', () => {
    const region = fitRegion(390, 844, 200, 600);
    const f = focalPx(844, 50);
    // 横長の箱（幅 8・高さ 3・奥行き 4）の頂点
    const pts = [];
    for (const x of [-4, 4]) for (const y of [-1.5, 1.5]) for (const z of [-2, 2]) pts.push(x, y, z);
    const d = fitPoints(pts, region, 844, 50);
    let hx = 0, hy = 0;
    for (let i = 0; i < pts.length; i += 3) {
      hx = Math.max(hx, Math.abs((f * pts[i]) / (d - pts[i + 2])));
      hy = Math.max(hy, Math.abs((f * pts[i + 1]) / (d - pts[i + 2])));
    }
    expect(Math.max(hx / (region.width / 2), hy / (region.height / 2))).toBeCloseTo(FIT_FILL, 9);
    expect(hy / (region.height / 2)).toBeLessThan(FIT_FILL);   // 横長なので幅で決まる
    expect(spreadPx(pts, d, 844, 50)).toBeCloseTo(hx, 9);
  });
  it('寄り引きの範囲は収めた距離の前後にある', () => {
    expect(ZOOM_RANGE.min).toBeLessThan(1);
    expect(ZOOM_RANGE.max).toBeGreaterThan(1);
  });
});

describe('慣性（E1）', () => {
  // 16 ミリ秒ごとに (dx, dy) ずつ n 回動かして、最後の動きの after ミリ秒後に離す
  function fling(dx, dy, n = 8, after = 0) {
    const s = createInertia();
    let t = 1000;
    for (let i = 0; i < n; i++) s.push(dx, dy, (t += 16));
    return { s, started: s.release(t + after) };
  }
  // 止まるまで進めて、惰性で進んだ量と、かかった時間を返す
  function coast(s, dt = 16) {
    let x = 0, y = 0, t = 0, prev = Infinity, slowing = true;
    for (let m; (m = s.step(dt)); t += dt) {
      const v = Math.hypot(m.dx, m.dy);
      if (v > prev + 1e-12) slowing = false;
      prev = v;
      x += m.dx;
      y += m.dy;
      if (t > 10000) throw new Error('止まらない');
    }
    return { x, y, t, slowing };
  }

  it('はじいた速さで回り始め、同じ向きに、だんだん遅くなって止まる', () => {
    const { s, started } = fling(12, -4);
    expect(started).toBe(true);
    expect(s.speed).toBeCloseTo(Math.hypot(12, -4) / 16, 6);
    const c = coast(s);
    expect(c.slowing).toBe(true);
    expect(c.x).toBeGreaterThan(0);
    expect(c.y).toBeLessThan(0);
    expect(c.x / -c.y).toBeCloseTo(3, 6);
    expect(s.active).toBe(false);
    expect(s.step(16)).toBe(null);
  });
  it('惰性で進む量はおよそ 速さ × tau で、1 秒半ほどで止まる', () => {
    const { s } = fling(16, 0);
    const v = s.speed;
    const c = coast(s);
    expect(c.x).toBeGreaterThan(0.9 * v * INERTIA.tau);
    expect(c.x).toBeLessThanOrEqual(v * INERTIA.tau);
    expect(c.t).toBeLessThan(1500);
  });
  it('描くフレームの間隔が違っても、進む量はほぼ同じ', () => {
    const a = coast(fling(10, 0).s, 8).x, b = coast(fling(10, 0).s, 33).x;
    expect(Math.abs(a - b) / a).toBeLessThan(0.05);
  });
  it('強くはじいても上限の速さまで', () => {
    const { s } = fling(200, 0);
    expect(s.speed).toBeCloseTo(INERTIA.maxSpeed, 6);
  });
  it('指を止めてから離したら回さない', () => {
    expect(fling(12, 0, 8, INERTIA.stillMs + 1).started).toBe(false);
  });
  it('ゆっくり動かして離したら回さない', () => {
    expect(fling(2, 0).started).toBe(false);
  });
  it('動かさずに離した（タップ）なら回さない', () => {
    const s = createInertia();
    expect(s.release(500)).toBe(false);
    expect(s.active).toBe(false);
  });
  it('前の操作の動きは次の操作に持ち越さない', () => {
    const s = createInertia();
    for (let t = 0; t < 128; t += 16) s.push(12, 0, t);
    s.release(130);
    s.stop();
    expect(s.release(400)).toBe(false);
  });
  it('止める（指を置いた）と、その時の速さを返して止まる', () => {
    const { s } = fling(12, 0);
    s.step(16);
    const v = s.speed;
    expect(s.stop()).toBeCloseTo(v, 9);
    expect(s.active).toBe(false);
    expect(s.stop()).toBe(0);
  });
  it('描画が途切れた後でも一度に大きく飛ばない', () => {
    const { s } = fling(16, 0);
    const v = s.speed;
    expect(s.step(5000).dx).toBeLessThanOrEqual(v * INERTIA.maxStep + 1e-9);
  });
});
