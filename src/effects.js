// 分解の演出（D2）の時間と動きの曲線。描画にも DOM にも依存しない（テストする）。
// main.js がこの曲線で立体と HUD を動かす。演出は見た目だけで、ルール・隠れ判定・物理には触らない。
//
//   ねじ: 右ねじなので、頭から見て反時計回りに回りながら、1回転でピッチ1つ分だけ抜ける。
//         ねじ部が板から抜けきったら、ポンと少し飛び出して膨らみ、画面の印に持ち替えて箱やスロットへ回りながら飛ぶ。
//   板:   最後のねじが抜けた瞬間に、ぷくっと膨らんで白く光る（はじける）。盤面の外まで落ちたら、回りながら外へ落ちて消える。
//   箱:   最後の1本が入ると、ふたが閉まり（ここで音と振動）、箱ははずんで上へ抜け、次の箱が出る。

import { BOLT } from './scene.js';

// ねじ山（scene.js のらせん）: ねじ部の長さの 0.95 を 3 回転で進む
export const THREAD_TURNS = 3;
export const pitchOf = (r) => (BOLT.length * r * 0.95) / THREAD_TURNS;

export const FX = {
  unscrew: { ms: 300, engaged: 0.72, pop: 0.45, swell: 0.12 },   // engaged: 時間のうちねじ山がかかっている割合。pop: 抜けた後に飛び出す量 × r
  fly: { ms: 360, slotMs: 260, turns: 1.5, arc: 34 },          // 印が飛ぶ時間（スロットから箱へは slotMs）・回る回数・弧の高さ（px）
  land: { ms: 220 },                                            // 印が入った穴がはずむ
  burst: { ms: 260, swell: 0.07, glow: 0.45 },                  // 板がはじける（膨らむ割合と光の強さ）
  held: { ms: 700, tint: 0.75, glow: 0.15 },                    // 親を留めている子の部品が橙に染まる（2回。色を寄せる割合と光の強さ）
  drop: { ms: 900, fall: 26, drift: 3, turns: 0.7 },            // 盤面の外へ落ちた板（落ちる距離・横へ流れる距離・回る回数）
  box: { settle: 60, lid: 160, hold: 110, leave: 220, spawn: 160 },
};

const clamp01 = (k) => Math.min(1, Math.max(0, k));
const easeIn = (k) => k * k;
const easeOut = (k) => 1 - (1 - k) * (1 - k);

// ねじの抜け方。k は 0〜1、r は頭の半径。
// 返り値 { lift: 抜けた距離, angle: 頭の軸（+Y）まわりの回転（正 = 頭から見て反時計回り）, scale }
export function unscrewPose(k, r) {
  const { engaged, pop, swell } = FX.unscrew;
  const L = BOLT.length * r, pitch = pitchOf(r);
  k = clamp01(k);
  if (k <= engaged) {
    // ねじ山がかかっている間は、回った分だけ抜ける（だんだん速く回す）
    const lift = L * easeIn(k / engaged);
    return { lift, angle: (2 * Math.PI * lift) / pitch, scale: 1 };
  }
  // 抜けきった後は、勢いで少し飛び出しながら回り続け、少し膨らむ
  const u = (k - engaged) / (1 - engaged);
  const spinAtRelease = (2 * Math.PI * 2 * L) / (pitch * engaged);   // 抜けきった瞬間の回る速さ（k あたり）
  return {
    lift: L + pop * r * easeOut(u),
    angle: (2 * Math.PI * L) / pitch + spinAtRelease * (1 - engaged) * u * (1 - u / 2),
    scale: 1 + swell * Math.sin(u * Math.PI / 2),
  };
}

// 板がはじける: 膨らみ（大きさの倍率）と光（0〜glow）。終わりで元に戻る
export function burstPose(k) {
  const { swell, glow } = FX.burst;
  k = clamp01(k);
  const bump = k < 0.625 ? Math.sin(Math.PI * k * 1.6) : 0;   // 前半でふくらんで戻り、後半は元の大きさ
  return { scale: 1 + swell * bump, glow: glow * (1 - k) * (1 - k) };
}

// 盤面の外へ落ちた板: 世界の下へ落ち、横へ流れ、回る。side は横へ流れる向き（-1 か 1）
export function dropPose(k, side = 1) {
  const { fall, drift, turns } = FX.drop;
  k = clamp01(k);
  return {
    down: fall * k * k,
    side: side * drift * easeOut(k),
    angle: side * turns * 2 * Math.PI * k,
    opacity: Math.min(1, 2.2 - 2.2 * k),
  };
}

// 飛ぶ印のキーフレーム（Web Animations に渡す）。from / to は画面の座標、scale は飛び始めの大きさ
export function flyFrames(from, to, scale = 1.25, turns = FX.fly.turns) {
  const { arc } = FX.fly;
  const deg = turns * 360;
  const t = (x, y, s, a) => ({ transform: `translate(${x}px, ${y}px) rotate(${a}deg) scale(${s})` });
  return [
    t(from[0], from[1], scale, 0),
    { ...t((from[0] + to[0]) / 2, Math.min(from[1], to[1]) - arc, (scale + 1) / 2 * 1.08, deg * 0.55), offset: 0.45 },
    t(to[0], to[1], 1, deg),
  ];
}

// 箱が満杯になってからの段取り（ミリ秒）。cue はふたが閉まりきる瞬間（音と振動をここで鳴らす）
export function boxCloseTimeline(fast = 1) {
  const { settle, lid, hold, leave } = FX.box;
  const s = (ms) => ms * fast;
  return {
    lid: s(settle),                          // ふたを閉め始める
    cue: s(settle + lid),                    // 閉まりきる（boxFull の音と振動）
    leave: s(settle + lid + hold),           // 箱が上へ抜け始める
    end: s(settle + lid + hold + leave),     // 次の箱を出してよい
  };
}

// 1回のタップで見せる演出の長さの目安（ミリ秒）。続けてタップされているときは fast = 0.5
export function batchDuration(events, fast = 1) {
  let ms = FX.unscrew.ms;
  for (const ev of events) {
    if (ev.type === 'toBox' || ev.type === 'toSlot') ms += FX.fly.ms * fast;
    else if (ev.type === 'slotToBox') ms += FX.fly.slotMs * fast;
    else if (ev.type === 'boxFull') ms += boxCloseTimeline(fast).end;
    else if (ev.type === 'boxSpawn') ms += FX.box.spawn * fast;
  }
  return ms;
}

// マットと影の位置と大きさ（画面のピクセル）。立体の中心の画面の位置 cy と、立体を包む球の見かけの半径 R（px）から決める。
// 立体の真下にマットを敷き、寄ると大きく、引くと小さくなる（D1 では画面の高さの割合で固定だった）。
// 係数は、固定の箱を最初の距離で見たときに D1 の見た目（マットは画面の高さの 82%、影は 77%）とそろう値
export function groundOf(cy, R) {
  return {
    matY: cy + 1.02 * R,
    matRx: 1.6 * R,
    matRy: 0.58 * R,
    shadeY: cy + 0.81 * R,
    shadeRx: 0.7 * R,
    shadeRy: 0.2 * R,
  };
}
