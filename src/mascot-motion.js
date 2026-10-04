// マスコット「ネジまる」（D3）の動きと、どの合図でどう動くか。描画にも DOM にも依存しない（テストする）。
// mascot.js がこの姿勢で立体を動かすだけ。形・寸法・動きは docs/design/mockup.src.html の試作から写した。
//
// 動き（action）:
//   idle   待機。小さく弾んで揺れ、ときどき瞬きする（縦長の大きな瞳）。
//          F: ゆっくり呼吸し、ときどき盤面の方を見上げて見回し、レンチをくるっと回す（どれも時計だけで決まる。描く回数は増えない）
//   wave   盤面が始まった（F）。^ ^ の目で空いた左手を振る。終わったら待機へ戻る
//   win    成功（クリア ★3）。^ ^ の目でバンザイして、1回転しながら3回跳ぶ。跳び終えたら ^ ^ のままバンザイで待つ
//   win2   成功（クリア ★2）。^ ^ の目でレンチを高く掲げ、回らずに2回跳ぶ。跳び終えたらレンチを掲げて揺れる
//   win1   成功（クリア ★1）。開いた目で「ふう」と小さく1回跳び、空いた手で額をぬぐう。その後は待機の顔で小さく揺れる
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
// クリアは星の数で喜び方を変える（E5）。opts.stars が無ければ ★3 の動き
export const STAR_WIN = { 1: 'win1', 2: 'win2', 3: 'win' };
export const cueAction = (cue, opts = {}) =>
  cue === 'cleared' && opts.stars ? STAR_WIN[Math.max(1, Math.min(3, opts.stars))] : CUE_ACTION[cue] ?? null;

// 動きの長さ（秒）。hold は終わった後もその動きのまま待つもの。rank が高い動きは低い動きに割り込まれない
export const ACTIONS = {
  idle: { s: Infinity, hold: true, rank: 0 },
  wave: { s: 1.4, hold: false, rank: 0 },
  flinch: { s: 0.45, hold: false, rank: 1 },
  joy: { s: 0.75, hold: false, rank: 2 },
  win: { s: 3.3, hold: true, rank: 3 },
  win2: { s: 2.2, hold: true, rank: 3 },
  win1: { s: 1.6, hold: true, rank: 3 },
  lose: { s: 1.1, hold: true, rank: 3 },
};
export const WIN_JUMP = 1.1;     // 1回の跳びの長さ（秒）。最初の跳びで1回転する
export const BLINK = { every: 3.4, s: 0.12 };
// 待機の見回し（F）。LOOK.every 秒ごとに、盤面の方（画面の右上）を見上げてしばらく見て、戻ってから反対へちらっと見る。
// [始め, 終わり, 首の向き, 見上げ] の区間で、区間のあいだは滑らかにつなぐ
export const LOOK = {
  every: 9,
  keys: [[0, 0, 0, 0], [0.9, 1.7, 0.55, -0.12], [3.2, 4.0, 0, 0], [5.6, 6.1, -0.3, 0.03], [6.9, 7.5, 0, 0]],
};
// レンチをくるっと1回転させる（F）。TWIRL.every 秒ごと、TWIRL.at 秒から TWIRL.s 秒
export const TWIRL = { every: 13, at: 10.4, s: 0.7 };

const clamp01 = (k) => Math.min(1, Math.max(0, k));
const smooth = (k) => { k = clamp01(k); return k * k * (3 - 2 * k); };

// 腕の姿勢 [横に開く角, 前に出す角, 手首のひねり]。既定は見本1枚目: 右手（画面左）でレンチを掲げる
const ARM_R = [1.2, 0, -0.9];
const ARM_L = [-0.25, 0, 0];

// 見回しの首の向きと見上げ（clock は通しの秒）
export function lookAt(clock) {
  const c = ((clock % LOOK.every) + LOOK.every) % LOOK.every;
  const k = LOOK.keys;
  let i = k.length - 1;
  while (i > 0 && c < k[i][0]) i--;
  const [t0, t1, turn, up] = k[i];
  if (!i || c >= t1) return { turn, up };
  // 区間 [t0, t1] の間は、前の区間の向きからこの区間の向きへ動く
  const [, , turn0, up0] = k[i - 1];
  const f = smooth((c - t0) / (t1 - t0));
  return { turn: turn0 + (turn - turn0) * f, up: up0 + (up - up0) * f };
}

// 待機の姿勢（clock は通しの秒。止まっている間も呼吸のように動く）
function idlePose(clock, still) {
  const m = still ? 0 : 1;
  const breath = Math.sin(clock * 1.6);   // ゆっくりした呼吸（F）
  const look = lookAt(clock);
  const tw = ((clock % TWIRL.every) - TWIRL.at) / TWIRL.s;
  return {
    y: Math.abs(Math.sin(clock * 2.4)) * 0.03 * m,
    spin: 0,
    squash: 1 + (Math.sin(clock * 4.8) * 0.008 + breath * 0.014) * m,
    sway: Math.sin(clock * 1.2) * 0.03 * m,
    shake: 0,
    headTilt: look.up * m,
    headSide: 0,
    headTurn: look.turn * m,
    face: 'open',
    brows: 'normal',
    mouth: 'open',
    armR: [ARM_R[0] + Math.sin(clock * 2.4) * 0.06 * m, ARM_R[1], ARM_R[2]],
    armL: [ARM_L[0] - breath * 0.05 * m, ARM_L[1], ARM_L[2]],
    legSwing: 0,
    keyFlip: 0,
    keyTwirl: tw > 0 && tw < 1 ? smooth(tw) * Math.PI * 2 * m : 0,
    sweat: null,
    // 瞬き。見回しの周期の頭では2回続けて瞬く（F）
    blink: (clock % BLINK.every) < BLINK.s || (m > 0 && Math.abs((clock % LOOK.every) - 0.35) < BLINK.s / 2),
  };
}

// 動き action の、始まってから t 秒の姿勢。still は「視差効果を減らす」設定（待機の揺れを止める）
export function mascotPose(action, t, clock = t, still = false) {
  const p = idlePose(clock, still);
  // 見回しとレンチ回しは待機（と手を振る・小さな動き）だけ。成功・失敗では正面を向く
  if (ACTIONS[action]?.hold && action !== 'idle') {
    p.headTurn = 0;
    p.headTilt = 0;
    p.keyTwirl = 0;
  }
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
  } else if (action === 'win2') {
    p.face = 'happy';
    p.mouth = 'big';
    p.blink = false;
    // レンチを高く掲げ（右手を真上近くへ）、左手は横へ開く
    p.armR = [2.3, 0.3, -0.2];
    p.armL = [-1.1, 0.2, 0];
    if (t < ACTIONS.win2.s) {
      const k = (t % WIN_JUMP) / WIN_JUMP;
      p.y = Math.sin(k * Math.PI) * 0.3;
      p.squash = k < 0.1 ? 1 - (0.1 - k) * 1.0 : 1 + Math.sin(k * Math.PI) * 0.03;
      p.legSwing = Math.sin(k * Math.PI) * 0.25;
    } else {
      p.y = Math.abs(Math.sin(clock * 2.6)) * 0.04;
      p.sway = Math.sin(clock * 2.6) * 0.06;
      p.armR[0] += Math.sin(clock * 5.2) * 0.1;
    }
  } else if (action === 'win1') {
    // 「ふう」: 小さく1回跳び、空いた左手を額へ持っていく
    p.mouth = 'open';
    p.blink = false;
    const hop = t < 0.7 ? Math.sin((t / 0.7) * Math.PI) : 0;
    p.face = t < 0.7 ? 'happy' : 'open';
    p.y = hop * 0.16;
    p.squash = t < 0.07 ? 1 - (0.07 - t) * 0.8 : p.squash;
    p.legSwing = hop * 0.18;
    const wipe = smooth((t - 0.6) / 0.35) * (1 - smooth((t - 1.35) / 0.25));
    p.armL = [ARM_L[0] - wipe * 2.3, wipe * 0.9, 0];
    p.headSide = wipe * 0.08 * Math.sin(t * 9);
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
  } else if (action === 'wave') {
    // 空いた左手を上げて、2回半振る（始めと終わりは待機の腕へ滑らかにつなぐ）
    const k = clamp01(t / ACTIONS.wave.s);
    const up = smooth(k / 0.2) * (1 - smooth((k - 0.8) / 0.2));
    p.face = up > 0.3 ? 'happy' : 'open';
    p.blink = p.blink && up <= 0.3;
    p.armL = [p.armL[0] - up * (1.9 + Math.sin(k * Math.PI * 5) * 0.32), p.armL[1] + up * 0.7, 0];
    p.headSide = up * -0.07;
    p.headTurn *= 1 - up;
    p.headTilt *= 1 - up;
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
    react(cue, now, opts) {
      const next = cueAction(cue, opts);
      return next ? api.play(next, now) : false;
    },
    reset(now) {
      action = 'idle';
      t0 = now;
    },
  };
  return api;
}
