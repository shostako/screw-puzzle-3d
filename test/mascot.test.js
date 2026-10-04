import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CUE_ACTION, STAR_WIN, cueAction, ACTIONS, WIN_JUMP, LOOK, TWIRL, lookAt, mascotPose, createMascotState } from '../src/mascot-motion.js';
import { buildMascot, applyPose, frameCamera } from '../src/mascot.js';
import { VIBRATION, endCue, eventCue, tapCue } from '../src/feedback.js';

const visibleMeshes = (root) => {
  const out = [];
  root.traverseVisible((o) => o.isMesh && out.push(o));
  return out;
};
const samples = (action) => {
  const end = Number.isFinite(ACTIONS[action].s) ? ACTIONS[action].s + 1 : 4;
  return Array.from({ length: 60 }, (_, i) => (i / 59) * end);
};

describe('どの合図でどう動くか', () => {
  it('合図の名前は feedback.js の合図にあるものだけ', () => {
    for (const cue of Object.keys(CUE_ACTION)) expect(VIBRATION).toHaveProperty(cue);
    for (const a of Object.values(CUE_ACTION)) expect(ACTIONS).toHaveProperty(a);
  });

  it('クリアで成功、詰みで失敗、箱が満杯で小さな喜び、外せないねじで困る', () => {
    expect(cueAction(endCue('cleared'))).toBe('win');
    expect(cueAction(endCue('stuck'))).toBe('lose');
    expect(cueAction(eventCue({ type: 'boxFull' }))).toBe('joy');
    expect(cueAction(tapCue('blocked'))).toBe('flinch');
    expect(cueAction(tapCue('full'))).toBe('flinch');
    // ふだんの手（外す・箱やスロットに入る・板が落ちる）では動かない（毎回動くとうるさい）
    for (const cue of ['unscrew', 'box', 'slot', 'plate', null]) expect(cueAction(cue)).toBeNull();
  });
});

describe('クリアの星で喜び方を変える（E5）', () => {
  it('★3 は 1回転して3回跳ぶ、★2 は回らずに2回跳ぶ、★1 は小さく1回跳ぶ。星が無ければ ★3', () => {
    expect(cueAction('cleared', { stars: 3 })).toBe('win');
    expect(cueAction('cleared', { stars: 2 })).toBe('win2');
    expect(cueAction('cleared', { stars: 1 })).toBe('win1');
    expect(cueAction('cleared')).toBe('win');
    for (const a of Object.values(STAR_WIN)) expect(ACTIONS[a]).toMatchObject({ hold: true, rank: ACTIONS.win.rank });
    const hops = (a) => {
      const ys = Array.from({ length: 400 }, (_, i) => mascotPose(a, (i / 399) * ACTIONS[a].s, 0, true).y);
      let n = 0;
      for (let i = 1; i < ys.length - 1; i++) if (ys[i] > 0.1 && ys[i] >= ys[i - 1] && ys[i] > ys[i + 1]) n++;
      return { n, top: Math.max(...ys) };
    };
    const [one, two, three] = ['win1', 'win2', 'win'].map(hops);
    expect(three.n).toBe(3);
    expect(two.n).toBe(2);
    expect(one.n).toBe(1);
    expect(three.top).toBeGreaterThan(two.top);
    expect(two.top).toBeGreaterThan(one.top);
    // 回るのは ★3 だけ
    const spins = (a) => Math.max(...Array.from({ length: 50 }, (_, i) => Math.abs(mascotPose(a, (i / 49) * ACTIONS[a].s, 0, true).spin)));
    expect(spins('win')).toBeGreaterThan(Math.PI);
    expect(spins('win2')).toBe(0);
    expect(spins('win1')).toBe(0);
  });

  it('★ごとの喜びもやり直すまでそのまま。章の終わりに同じ星でもう1回跳べる', () => {
    const st = createMascotState(0);
    expect(st.react('cleared', 0, { stars: 2 })).toBe(true);
    expect(st.current(60000).action).toBe('win2');
    expect(st.react('boxFull', 61000)).toBe(false);
    expect(st.react('cleared', 62000, { stars: 2 })).toBe(true);
    expect(st.current(62000).t).toBe(0);
  });
});

describe('動きの切り替え（createMascotState）', () => {
  const sec = (s) => s * 1000;

  it('小さな喜びと困り顔は、終わると待機へ戻る', () => {
    const st = createMascotState(0);
    expect(st.react('boxFull', 0)).toBe(true);
    expect(st.current(sec(ACTIONS.joy.s / 2)).action).toBe('joy');
    expect(st.current(sec(ACTIONS.joy.s + 0.01)).action).toBe('idle');
    st.react('blocked', sec(5));
    expect(st.current(sec(5 + ACTIONS.flinch.s + 0.01)).action).toBe('idle');
  });

  it('成功と失敗は、やり直すまでそのまま。ほかの合図に割り込まれない', () => {
    const st = createMascotState(0);
    st.react('cleared', 0);
    expect(st.react('boxFull', sec(1))).toBe(false);
    expect(st.react('blocked', sec(1))).toBe(false);
    expect(st.react('stuck', sec(1))).toBe(false);
    expect(st.current(sec(60)).action).toBe('win');
    st.reset(sec(61));
    expect(st.current(sec(61)).action).toBe('idle');
    st.react('stuck', sec(62));
    expect(st.react('cleared', sec(63))).toBe(false);
    expect(st.current(sec(99)).action).toBe('lose');
  });

  it('小さな喜びは困り顔を上書きし、困り顔は小さな喜びを遮らない。クリアは小さな喜びの途中でも始まる', () => {
    const st = createMascotState(0);
    st.react('blocked', 0);
    expect(st.react('boxFull', 100)).toBe(true);
    expect(st.react('blocked', 200)).toBe(false);
    expect(st.current(300).action).toBe('joy');
    expect(st.react('cleared', 400)).toBe(true);
    expect(st.current(500)).toEqual({ action: 'win', t: 0.1 });
  });
});

describe('姿勢（mascotPose）', () => {
  it('顔: 待機は縦長の瞳、成功は ^ ^、失敗は × と への字の口と汗', () => {
    expect(mascotPose('idle', 1, 1)).toMatchObject({ face: 'open', mouth: 'open', brows: 'normal', sweat: null });
    expect(mascotPose('win', 1)).toMatchObject({ face: 'happy', mouth: 'big' });
    expect(mascotPose('joy', 0.3)).toMatchObject({ face: 'happy' });
    expect(mascotPose('flinch', 0.1)).toMatchObject({ face: 'open', brows: 'worried' });
    const lose = mascotPose('lose', 2);
    expect(lose).toMatchObject({ face: 'x', mouth: 'sad', brows: 'worried' });
    expect(mascotPose('lose', 0.3).sweat).toBeNull();
    for (const t of samples('lose').filter((t) => t > 0.6)) {
      const s = mascotPose('lose', t).sweat;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1);
    }
  });

  it('待機はときどき瞬きする。「視差効果を減らす」設定では揺れない', () => {
    const blinks = Array.from({ length: 400 }, (_, i) => mascotPose('idle', 0, i * 0.02).blink);
    expect(blinks.some(Boolean)).toBe(true);
    expect(blinks.filter(Boolean).length).toBeLessThan(blinks.length / 10);
    for (const c of [0.3, 1.1, 2.7]) {
      const p = mascotPose('idle', 0, c, true);
      expect(p.y).toBeCloseTo(0, 9);
      expect(p.sway).toBeCloseTo(0, 9);
      expect(p.squash).toBeCloseTo(1, 9);
    }
  });

  it('成功: 最初の跳びでちょうど1回転し、3回跳んで着地する', () => {
    expect(mascotPose('win', 0).spin).toBeCloseTo(0);
    expect(mascotPose('win', WIN_JUMP).spin).toBeCloseTo(Math.PI * 2);
    const ys = samples('win').filter((t) => t < ACTIONS.win.s).map((t) => mascotPose('win', t).y);
    expect(Math.max(...ys)).toBeGreaterThan(0.4);
    expect(mascotPose('win', ACTIONS.win.s - 1e-6).y).toBeLessThan(0.01);
    expect(mascotPose('win', ACTIONS.win.s + 0.5).spin).toBe(0);
  });

  it('動きの終わりは待機の姿勢につながる（ぱっと飛ばない）', () => {
    for (const a of ['joy', 'flinch']) {
      const end = mascotPose(a, ACTIONS[a].s, 3);
      const idle = mascotPose('idle', 0, 3);
      expect(end.y).toBeCloseTo(idle.y, 2);
      expect(end.headSide).toBeCloseTo(idle.headSide, 2);
      expect(end.armL[0]).toBeCloseTo(idle.armL[0], 2);
    }
  });
});

describe('待機の軽い動きと手を振る（F）', () => {
  const idleAt = (c, still = false) => mascotPose('idle', 0, c, still);

  it('ときどき盤面の方（右上）を見上げ、反対へもちらっと見て、正面へ戻る。向きは滑らかに変わる', () => {
    const cs = Array.from({ length: 901 }, (_, i) => (i / 900) * LOOK.every);
    const turns = cs.map((c) => idleAt(c).headTurn);
    expect(Math.max(...turns)).toBeCloseTo(0.55, 2);
    expect(Math.min(...turns)).toBeCloseTo(-0.3, 2);
    expect(idleAt(0).headTurn).toBeCloseTo(0, 9);
    expect(idleAt(LOOK.every - 0.5).headTurn).toBeCloseTo(0, 9);
    expect(idleAt(2.5).headTilt).toBeLessThan(0);   // 見上げる
    for (let i = 1; i < turns.length; i++) expect(Math.abs(turns[i] - turns[i - 1])).toBeLessThan(0.02);
    // 次の周期の頭へもぱっと飛ばない
    expect(lookAt(LOOK.every - 1e-6).turn).toBeCloseTo(lookAt(0).turn, 6);
  });

  it('レンチをときどき1回転させる。それ以外の時は回さない', () => {
    const at = (c) => idleAt(c).keyTwirl;
    expect(at(TWIRL.at - 0.01)).toBe(0);
    expect(at(TWIRL.at + TWIRL.s / 2)).toBeCloseTo(Math.PI, 5);
    expect(at(TWIRL.at + TWIRL.s + 0.01)).toBe(0);
    const on = Array.from({ length: 1300 }, (_, i) => at(i / 100)).filter((v) => v > 0).length;
    expect(on / 1300).toBeLessThan(0.1);
  });

  it('「視差効果を減らす」設定では見回さず、レンチも回さない（瞬きはする）', () => {
    for (const c of [1.5, 2.5, 5.9, TWIRL.at + 0.3]) {
      const p = idleAt(c, true);
      expect(p.headTurn).toBeCloseTo(0, 9);
      expect(p.headTilt).toBeCloseTo(0, 9);
      expect(p.keyTwirl).toBe(0);
    }
    expect(Array.from({ length: 400 }, (_, i) => idleAt(i * 0.02, true).blink).some(Boolean)).toBe(true);
  });

  it('成功と失敗の間は正面を向き、レンチも回さない', () => {
    for (const a of ['win', 'win2', 'win1', 'lose']) {
      const p = mascotPose(a, 5, 2.5);
      expect(p.headTurn).toBe(0);
      expect(mascotPose(a, 5, TWIRL.at + 0.3).keyTwirl).toBe(0);
    }
  });

  it('手を振るのは盤面の始まりの短い動きで、^ ^ の目で左手を上げて振り、終わると待機へ戻る', () => {
    expect(ACTIONS.wave).toMatchObject({ hold: false });
    const mid = mascotPose('wave', 0.7, 0.7);
    expect(mid.face).toBe('happy');
    expect(mid.armL[0]).toBeLessThan(-1.5);
    const lifts = Array.from({ length: 141 }, (_, i) => mascotPose('wave', i / 100, 0, true).armL[0]);
    let swings = 0;
    for (let i = 1; i < lifts.length - 1; i++) if (lifts[i] < lifts[i - 1] && lifts[i] <= lifts[i + 1] && lifts[i] < -1.5) swings++;
    expect(swings).toBeGreaterThanOrEqual(2);
    const end = mascotPose('wave', ACTIONS.wave.s, 3), idle = mascotPose('idle', 0, 3);
    expect(end.armL[0]).toBeCloseTo(idle.armL[0], 2);
    expect(end.headTurn).toBeCloseTo(idle.headTurn, 2);
    const st = createMascotState(0);
    expect(st.play('wave', 0)).toBe(true);
    expect(st.current(ACTIONS.wave.s * 1000 + 10).action).toBe('idle');
    // 手を振っている途中でも、外せないねじ・箱が満杯・クリアの合図は割り込める
    st.play('wave', 10000);
    expect(st.react('blocked', 10100)).toBe(true);
  });
});

describe('ネジまるの立体（mascot.js）', () => {
  const { root, parts } = buildMascot();

  it('描く回数はどの姿勢でも 24 回まで、三角形は 2 万枚まで（試作は約 140 回）', () => {
    let tris = 0;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    expect(tris).toBeLessThan(20000);
    for (const a of Object.keys(ACTIONS)) {
      for (const t of samples(a)) {
        applyPose(parts, mascotPose(a, t));
        expect(visibleMeshes(root).length).toBeLessThanOrEqual(24);
      }
    }
  });

  it('材質は同じものを1つの形にまとめている（動かす部分ごとに、材質1つにつき1回）', () => {
    const seen = new Set();
    root.traverse((o) => {
      if (!o.userData.part) return;
      const mats = o.children.filter((c) => c.isMesh && !c.userData.part).map((c) => c.material);
      expect(new Set(mats).size).toBe(mats.length);
      mats.forEach((m) => seen.add(m));
    });
    expect(seen.size).toBeGreaterThan(10);
  });

  it('どの動きでも、左下のキャンバスとカードの上のキャンバスからはみ出さない', () => {
    const camera = new THREE.PerspectiveCamera();
    const v = new THREE.Vector3();
    for (const aspect of [0.771, 150 / 194]) {
      frameCamera(camera, aspect);
      camera.updateMatrixWorld();
      for (const a of Object.keys(ACTIONS)) {
        for (const t of samples(a).filter((_, i) => i % 3 === 0)) {
          applyPose(parts, mascotPose(a, t), 0.27);
          root.updateMatrixWorld(true);
          let x = 0, y = 0;
          for (const m of visibleMeshes(parts.root)) {
            const pos = m.geometry.attributes.position;
            for (let i = 0; i < pos.count; i++) {
              v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).project(camera);
              x = Math.max(x, Math.abs(v.x));
              y = Math.max(y, Math.abs(v.y));
            }
          }
          expect(x, `${a} ${t.toFixed(2)}s 横`).toBeLessThan(1);
          expect(y, `${a} ${t.toFixed(2)}s 縦`).toBeLessThan(1);
        }
      }
      // 待機の見回しとレンチ回し（F）も、1 周期ぶんの時計ではみ出さない
      for (let c = 0; c < TWIRL.every; c += 0.25) {
        applyPose(parts, mascotPose('idle', 0, c), 0.27);
        root.updateMatrixWorld(true);
        for (const m of visibleMeshes(parts.root)) {
          const pos = m.geometry.attributes.position;
          for (let i = 0; i < pos.count; i += 3) {
            v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).project(camera);
            expect(Math.max(Math.abs(v.x), Math.abs(v.y)), `idle ${c}s`).toBeLessThan(1);
          }
        }
      }
    }
  });
});
