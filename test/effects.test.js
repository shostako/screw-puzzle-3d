import { describe, it, expect } from 'vitest';
import { FX, unscrewPose, burstPose, dropPose, flyFrames, boxCloseTimeline, batchDuration, groundOf, pitchOf, THREAD_TURNS, pressDepth, releaseDepth, blockerFlash, chainStep, lidMark, sparkOf, rainDrops } from '../src/effects.js';
import { BOLT, buildBoard } from '../src/scene.js';
import { SCREW_RADIUS } from '../src/board.js';
import { stageLevel } from '../src/stages.js';
import { createGame } from '../src/game.js';

// ステージ 1〜30 を見る（M8 で物理の落ち着きを確かめたのと同じ範囲）
const STAGES = 30;
const r = SCREW_RADIUS;
const L = BOLT.length * r;

describe('ねじが抜ける（unscrewPose）', () => {
  it('右ねじ: 頭から見て反時計回り（正の角）に回り、ねじ山がかかっている間は1回転でピッチ1つ分だけ抜ける', () => {
    let prev = unscrewPose(0, r);
    expect(prev.lift).toBe(0);
    expect(prev.angle).toBe(0);
    for (let k = 0.02; k <= FX.unscrew.engaged; k += 0.02) {
      const p = unscrewPose(k, r);
      expect(p.angle).toBeGreaterThan(prev.angle);
      expect(p.lift).toBeGreaterThan(prev.lift);
      expect(p.lift / (p.angle / (2 * Math.PI))).toBeCloseTo(pitchOf(r), 9);
      prev = p;
    }
  });

  it('ねじ部が板から抜けきるまでに、ねじ山の数（3回転）だけ回る', () => {
    const at = unscrewPose(FX.unscrew.engaged, r);
    expect(at.lift).toBeCloseTo(L, 9);
    expect(at.angle / (2 * Math.PI)).toBeCloseTo(L / pitchOf(r), 9);
    expect(L / pitchOf(r)).toBeCloseTo(THREAD_TURNS / 0.95, 9);
  });

  it('抜けきった後は、止まらずに回り続けて飛び出し、終わりにはねじ部が板から離れている', () => {
    let prev = unscrewPose(FX.unscrew.engaged, r);
    for (let k = FX.unscrew.engaged + 0.02; k <= 1; k += 0.02) {
      const p = unscrewPose(k, r);
      expect(p.angle).toBeGreaterThan(prev.angle);
      expect(p.lift).toBeGreaterThanOrEqual(prev.lift);
      prev = p;
    }
    const end = unscrewPose(1, r);
    expect(end.lift).toBeGreaterThan(L + 0.3 * r);
    expect(end.scale).toBeCloseTo(1 + FX.unscrew.swell, 9);
    // 抜けきる瞬間に急に跳ばない（位置と角度がつながっている）
    const a = unscrewPose(FX.unscrew.engaged - 1e-6, r), b = unscrewPose(FX.unscrew.engaged + 1e-6, r);
    expect(Math.abs(a.lift - b.lift)).toBeLessThan(1e-3);
    expect(Math.abs(a.angle - b.angle)).toBeLessThan(1e-3);
  });
});

describe('板と箱', () => {
  it('はじけた板は、終わりで元の大きさと色に戻る', () => {
    expect(burstPose(0).scale).toBe(1);
    expect(burstPose(1)).toEqual({ scale: 1, glow: 0 });
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => burstPose(i / 50).scale));
    expect(peak).toBeCloseTo(1 + FX.burst.swell, 2);
    expect(burstPose(0).glow).toBe(FX.burst.glow);
  });

  it('盤面の外へ落ちた板は、画面の下まで落ち、横へ流れて回り、消える', () => {
    const end = dropPose(1, -1);
    expect(end.down).toBe(FX.drop.fall);
    expect(end.side).toBeLessThan(0);
    expect(end.angle).toBeLessThan(0);
    expect(end.opacity).toBeLessThanOrEqual(0);
    expect(dropPose(0, 1)).toEqual({ down: 0, side: 0, angle: 0, opacity: 1 });
  });

  it('箱はふたが閉まりきる瞬間に音と振動を鳴らし、その後で上へ抜ける', () => {
    for (const fast of [1, 0.5]) {
      const t = boxCloseTimeline(fast);
      expect(t.lid).toBeLessThan(t.cue);
      expect(t.cue - t.lid).toBe(FX.box.lid * fast);
      expect(t.cue).toBeLessThan(t.leave);
      expect(t.leave).toBeLessThan(t.end);
    }
  });

  it('飛ぶ印は、飛び始めの大きさで出て、回りながら穴の上で元の大きさになる', () => {
    const f = flyFrames([10, 500], [100, 60], 1.4);
    expect(f[0].transform).toBe('translate(10px, 500px) rotate(0deg) scale(1.4)');
    expect(f.at(-1).transform).toBe(`translate(100px, 60px) rotate(${FX.fly.turns * 360}deg) scale(1)`);
  });
});

describe('手触り（E5）', () => {
  it('押し込み: 触れると沈み、離すと少し行き過ぎてから元の位置に戻る', () => {
    expect(pressDepth(0)).toBe(0);
    expect(pressDepth(1)).toBeCloseTo(FX.press.depth, 9);
    for (let k = 0.1; k <= 1; k += 0.1) expect(pressDepth(k)).toBeGreaterThan(pressDepth(k - 0.1));
    expect(releaseDepth(0)).toBeCloseTo(FX.press.depth, 9);
    expect(releaseDepth(1)).toBeCloseTo(0, 9);
    const ks = Array.from({ length: 41 }, (_, i) => i / 40);
    expect(Math.min(...ks.map((k) => releaseDepth(k)))).toBeLessThan(0);   // 戻るときに少し浮く（ばね）
    // 沈む深さは頭の高さのごく一部（ねじ頭が板に埋まって見えない）
    expect(FX.press.depth).toBeLessThan(0.3);
    // 沈みきる前に離したら、そこから戻る
    expect(releaseDepth(0, pressDepth(0.3))).toBeCloseTo(pressDepth(0.3), 9);
  });

  it('塞いでいる板の光は1回だけ強まって消え、タップの手応えより長く残らない', () => {
    expect(blockerFlash(0)).toBe(0);
    expect(blockerFlash(0.5)).toBeCloseTo(1, 9);
    expect(blockerFlash(1)).toBeCloseTo(0, 9);
    expect(FX.blocker.ms).toBeLessThanOrEqual(600);
  });

  it('箱の連鎖: 前の箱から間もなく閉まると数が増え、間が空くと 1 に戻る。上限で止まる', () => {
    let n = chainStep(0, null, 1000);
    expect(n).toBe(1);
    n = chainStep(n, 1000, 1000 + FX.chain.window - 1);
    expect(n).toBe(2);
    for (let i = 0; i < 10; i++) n = chainStep(n, 0, 10);
    expect(n).toBe(FX.chain.max);
    expect(chainStep(n, 0, FX.chain.window + 1)).toBe(1);
  });

  it('連鎖のふたは 2 から星が増え、散る星も多く遠くなる', () => {
    expect(lidMark(1)).toBe('✓');
    expect(lidMark(2)).toBe('★★');
    expect(lidMark(9)).toBe('★'.repeat(FX.chain.max));
    expect(sparkOf(1)).toEqual({ count: 6, reach: 1 });
    expect(sparkOf(3).count).toBeGreaterThan(sparkOf(2).count);
    expect(sparkOf(3).reach).toBeGreaterThan(sparkOf(2).reach);
  });

  it('クリアのねじの雨: 星が多いほど粒が多く、どの粒も降りきる時間のうちに画面を抜ける', () => {
    const [a, b, c] = [1, 2, 3].map((s) => rainDrops(s, 4));
    expect(a.length).toBeLessThan(b.length);
    expect(b.length).toBeLessThan(c.length);
    for (const d of c) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThanOrEqual(1);
      expect(d.delay).toBeGreaterThanOrEqual(0);
      expect(d.delay + d.ms).toBeLessThanOrEqual(FX.clear.rain + 1e-9);
      expect(d.color).toBeLessThan(4);
    }
    // 毎回同じ降り方（スクリーンショットで比べられる）
    expect(rainDrops(3, 4)).toEqual(c);
    // カードを出すまでの間は 0.5 秒ほど
    expect(FX.clear.pause).toBeGreaterThanOrEqual(400);
    expect(FX.clear.pause).toBeLessThanOrEqual(700);
  });
});

describe('演出の長さ', () => {
  // 1回のタップの演出が長すぎると、続けてタップしたときに画面が遅れて付いてくる
  it('箱を満杯にする1本（入る・閉まる・次の箱が出る）でも 1.4 秒以内。続けてタップしているときは 0.75 倍より短い', () => {
    const fill = [{ type: 'toBox' }, { type: 'boxFull' }, { type: 'boxSpawn' }];
    expect(batchDuration(fill)).toBeLessThanOrEqual(1400);
    expect(batchDuration(fill, 0.5)).toBeLessThan(batchDuration(fill) * 0.75);
  });

  it('ステージを解く手順の演出は、ねじ1本あたり平均 1 秒以内', () => {
    for (let n = 1; n <= STAGES; n += 4) {
      const level = stageLevel(n);
      const game = createGame(level);
      let total = 0, count = 0;
      for (const id of level.meta.solution) {
        const res = game.tap(id);
        if (res.reason !== 'ok') continue;
        total += batchDuration(res.events);
        count++;
      }
      expect(count).toBeGreaterThan(0);
      expect(total / count, `ステージ ${n}`).toBeLessThanOrEqual(1000);
    }
  });
});

describe('描く負荷', () => {
  const tris = (g) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  const meshes = (o) => {
    const out = [];
    o.traverse((m) => m.isMesh && out.push(m));
    return out;
  };

  // 演出（抜ける・はじける・落ちる）は、いまある立体を動かす・色を変えるだけで、立体を足さない。
  // 箱の閉まり・飛ぶ印・ポンの輪・星は DOM で描く。だから描く回数は盤面の立体の数で決まり、それを見張る
  it('全ステージで、描く回数は板1枚1回・ねじ1本3回、三角形は 8 万枚以内', () => {
    for (let n = 1; n <= STAGES; n++) {
      const level = stageLevel(n);
      const board = buildBoard(level);
      const all = meshes(board.root);
      expect(all.length).toBe(level.plates.length + 3 * level.screws.length);
      const total = all.reduce((t, m) => t + tris(m.geometry), 0);
      expect(total, `ステージ ${n}`).toBeLessThanOrEqual(80000);
    }
  });

  it('ねじ1本は 2000 枚、板1枚は 400 枚の三角形まで', () => {
    const board = buildBoard(stageLevel(7));
    for (const s of board.screws.values()) expect(meshes(s).reduce((t, m) => t + tris(m.geometry), 0)).toBeLessThanOrEqual(2000);
    for (const p of board.plates.values()) expect(tris(p.geometry)).toBeLessThanOrEqual(400);
  });
});

describe('マットと影（groundOf）', () => {
  it('立体の真下に置き、立体の見かけの大きさに比例する（寄れば大きく下へ）', () => {
    const near = groundOf(480, 300), far = groundOf(480, 150);
    expect(near.matY).toBeGreaterThan(far.matY);
    expect(near.matRx).toBeCloseTo(2 * far.matRx, 9);
    for (const g of [near, far]) {
      expect(g.shadeY).toBeGreaterThan(480);
      expect(g.shadeY).toBeLessThan(g.matY);
      expect(g.shadeRx).toBeLessThan(g.matRx);
    }
  });
});
