// マスコット「ネジまる」（D3）の動きと、どの合図でどう動くか。描画にも DOM にも依存しない（テストする）。
// mascot.js がこの姿勢で立体を動かすだけ。形・寸法・動きは docs/design/mockup.src.html の試作から写した。
//
// 動き（action）:
//   idle   待機。小さく弾んで揺れ、ときどき瞬きする（縦長の大きな瞳）
//   win    成功（クリア）。^ ^ の目でバンザイして、1回転しながら3回跳ぶ。跳び終えたら ^ ^ のままバンザイで待つ
//   lose   失敗（詰み）。× の目でぶるっと震え、頭を傾けてうなだれ、汗が垂れる。そのまま待つ
//   joy    小さな喜び（箱が満杯）。^ ^ の目で片手を上げて小さく跳ぶ
//   flinch 外せないねじをタップした。困り眉で首を小さく振る
// win と lose は、やり直すまでそのまま（reset）。joy と flinch は終わったら待機へ戻る。

// 合図（feedback.js の cue の名前）→ 動き
export const CUE_ACTION = {
  cleared: 'win',
  stuck: 'lose',
  boxFull: 'joy',
  blocked: 'flinch',
  full: 'flinch',
};
export const cueAction = (cue) => CUE_ACTION[cue] ?? null;

// 動きの長さ（秒）。hold は終わった後もその動きのまま待つもの。rank が高い動きは低い動きに割り込まれない
export const ACTIONS = {
  idle: { s: Infinity, hold: true, rank: 0 },
  flinch: { s: 0.45, hold: false, rank: 1 },
  joy: { s: 0.75, hold: false, rank: 2 },
  win: { s: 3.3, hold: true, rank: 3 },
  lose: { s: 1.1, hold: true, rank: 3 },
};
export const WIN_JUMP = 1.1;     // 1回の跳びの長さ（秒）。最初の跳びで1回転する
export const BLINK = { every: 3.4, s: 0.12 };

const clamp01 = (k) => Math.min(1, Math.max(0, k));
const smooth = (k) => { k = clamp01(k); return k * k * (3 - 2 * k); };

// 腕の姿勢 [横に開く角, 前に出す角, 手首のひねり]。既定は見本1枚目: 右手（画面左）でレンチを掲げる
const ARM_R = [1.2, 0, -0.9];
const ARM_L = [-0.25, 0, 0];

// 待機の姿勢（clock は通しの秒。止まっている間も呼吸のように動く）
function idlePose(clock, still) {
  const m = still ? 0 : 1;
  return {
    y: Math.abs(Math.sin(clock * 2.4)) * 0.03 * m,
    spin: 0,
    squash: 1 + Math.sin(clock * 4.8) * 0.012 * m,
    sway: Math.sin(clock * 1.2) * 0.03 * m,
    shake: 0,
    headTilt: 0,
    headSide: 0,
    face: 'open',
    brows: 'normal',
    mouth: 'open',
    armR: [ARM_R[0] + Math.sin(clock * 2.4) * 0.06 * m, ARM_R[1], ARM_R[2]],
    armL: [...ARM_L],
    legSwing: 0,
    keyFlip: 0,
    sweat: null,
    blink: (clock % BLINK.every) < BLINK.s,
  };
}

// 動き action の、始まってから t 秒の姿勢。still は「視差効果を減らす」設定（待機の揺れを止める）
export function mascotPose(action, t, clock = t, still = false) {
  const p = idlePose(clock, still);
  if (action === 'win') {
    p.face = 'happy';
    p.mouth = 'big';
    p.blink = false;
    // バンザイ: 手袋が頭の横から出るよう、真上より少し外へ開く（真上だと頭に隠れる）
    p.armR = [2.0, 0.45, -0.4];
    p.armL = [-2.0, 0.45, 0];
    p.spin = smooth(t / WIN_JUMP) * Math.PI * 2;
    if (t < ACTIONS.win.s) {
      const k = (t % WIN_JUMP) / WIN_JUMP;
      p.y = Math.sin(k * Math.PI) * 0.45;
      p.squash = k < 0.1 ? 1 - (0.1 - k) * 1.2 : 1 + Math.sin(k * Math.PI) * 0.04;
      p.legSwing = Math.sin(k * Math.PI) * 0.35;
    } else {
      // 跳び終えたら、バンザイのまま小さく弾む
      p.spin = 0;
      p.y = Math.abs(Math.sin(clock * 3)) * 0.06;
      p.armR[0] += Math.sin(clock * 6) * 0.08;
      p.armL[0] -= Math.sin(clock * 6) * 0.08;
    }
  } else if (action === 'lose') {
    p.face = 'x';
    p.brows = 'worried';
    p.mouth = 'sad';
    p.blink = false;
    if (t < 0.6) p.shake = Math.sin(t * 45) * 0.1 * (1 - t / 0.6);
    const k = smooth((t - 0.5) / 0.5);
    p.headTilt = k * 0.2;
    p.headSide = -k * 0.18;
    p.squash = 1 - k * 0.05;
    p.y = 0;
    p.sway = 0;
    p.armR = [0.15 - k * 0.05, 0, 0];
    p.armL = [-0.12, 0, 0];
    p.keyFlip = k;   // レンチを下へ向ける
    // 汗: 0.6 秒から、こめかみを 1.6 秒ごとに垂れる（0〜1 で垂れた量）
    p.sweat = t > 0.6 ? ((t - 0.6) % 1.6) / 1.6 : null;
  } else if (action === 'joy') {
    // 待機の動きに小さな跳びを足す（終わりで待機の姿勢にそのままつながる）
    const k = clamp01(t / ACTIONS.joy.s), hop = Math.sin(k * Math.PI);
    p.face = 'happy';
    p.mouth = 'big';
    p.blink = false;
    p.y += hop * 0.22;
    p.squash *= k < 0.12 ? 1 - (0.12 - k) * 0.8 : 1 + hop * 0.03;
    p.armL[0] -= hop * 2.2;   // 空いている左手を上げる
    p.legSwing = hop * 0.25;
  } else if (action === 'flinch') {
    const k = clamp01(t / ACTIONS.flinch.s);
    p.brows = 'worried';
    p.blink = false;
    p.headSide = Math.sin(k * Math.PI * 4) * 0.12 * (1 - k);
  }
  return p;
}

// どの動きを見せているか（時計は外から渡す。演出の時計 fxClock を ms で）。
// react(cue) で合図を受け、current(now) が { action, t: 始まってからの秒 } を返す
export function createMascotState(start = 0) {
  let action = 'idle', t0 = start;
  const done = (now) => action !== 'idle' && !ACTIONS[action].hold && (now - t0) / 1000 >= ACTIONS[action].s;
  const api = {
    current(now) {
      if (done(now)) { action = 'idle'; t0 = now; }
      return { action, t: Math.max(0, (now - t0) / 1000) };
    },
    play(next, now) {
      api.current(now);
      if (ACTIONS[next].rank < ACTIONS[action].rank) return false;
      if (ACTIONS[action].hold && action !== 'idle' && next !== action) return false;
      action = next;
      t0 = now;
      return true;
    },
    react(cue, now) {
      const next = cueAction(cue);
      return next ? api.play(next, now) : false;
    },
    reset(now) {
      action = 'idle';
      t0 = now;
    },
  };
  return api;
}
