// 効果音・BGM・振動（M8、E6 で作り直し）。
// どの場面で何を鳴らすか（合図 = cue の名前）と、合図ごとの振動の型・音の型・音量・BGM の譜面は、描画にも DOM にも依存しない（テストする）。
// 鳴らすのは createFeedback() が返すもので、音は Web Audio で合成する（音のファイルは持たない。dist だけで動き、軽い）。
//
// 合図:
//   unscrew  ねじが外れた（タップの瞬間）
//   blocked  隠れていて外せない
//   full     待機スロットがいっぱいで外せない
//   box      ねじが箱に入った（スロットから移ったときも）
//   slot     ねじが待機スロットに入った
//   boxFull  箱が満杯になった（opts.chain で連鎖の数。2 からきらめきの音程が上がる）
//   plate    板が外れて落ち始めた
//   cleared  クリア
//   stuck    詰み
//   undo     戻した（1手戻す・解ける所まで戻る）

// 音・BGM・振動の入り切りは設定（settings.js の sound / bgm / vibrate）が持つ。ここは毎回それを読んで鳴らすだけ。
// 「音」は全体のつまみで、切ると BGM も止まる。BGM は「音」が入りで「BGM」も入りの時だけ鳴る

// タップの結果（game.tap の reason）の合図
export function tapCue(reason) {
  return { ok: 'unscrew', blocked: 'blocked', held: 'blocked', full: 'full' }[reason] ?? null;
}

// removeScrew の出来事の合図（演出でその出来事を見せるときに鳴らす）
export function eventCue(ev) {
  switch (ev.type) {
    case 'toBox':
    case 'slotToBox': return 'box';
    case 'toSlot': return 'slot';
    case 'boxFull': return 'boxFull';
    case 'plate': return ev.to === 'fallen' ? 'plate' : null;
    default: return null;   // boxSpawn は boxFull の続きなので鳴らさない
  }
}

// 1局の終わりの合図
export function endCue(status) {
  return { cleared: 'cleared', stuck: 'stuck' }[status] ?? null;
}

// 振動の型（navigator.vibrate に渡すミリ秒の列）。短いものほど頻繁に鳴る合図
export const VIBRATION = {
  unscrew: [12],
  blocked: [30, 40, 30],
  full: [30, 40, 30],
  box: [8],
  slot: [8],
  boxFull: [18, 50, 18],
  plate: [20],
  cleared: [30, 60, 30, 60, 80],
  stuck: [120],
  undo: [10, 30, 10],
  hint: [10],
};

// 音量の釣り合い（合図ごとの大きさ。1 が一番大きい）。たくさん鳴る音ほど小さく、たまにしか鳴らない節目ほど大きい。
//   毎タップ: unscrew（ラチェットとポン）・box / slot（印が入る）… 小さめ
//   ときどき: blocked / full / undo / hint … 中くらい（耳に引っかかる程度）
//   節目:     boxFull・plate … やや大きめ。stuck … 大きめ。cleared … 一番大きい
//   bgm: 効果音の下に敷く（効果音のどれよりも小さい）
export const VOLUME = {
  unscrew: 0.42,
  box: 0.45,
  slot: 0.42,
  blocked: 0.55,
  full: 0.55,
  undo: 0.5,
  hint: 0.5,
  boxFull: 0.7,
  plate: 0.68,
  stuck: 0.8,
  cleared: 1,
  bgm: 0.26,
};
// すべての音にかける全体の大きさ（端末のスピーカーで割れない所）
export const MASTER = 0.5;

// 音の型: 音を順に並べたもの。
// 音: { at: 始まり（秒）, f: 周波数（Hz）, to: 終わりの周波数, d: 長さ（秒）, wave, gain（その音の中での大きさ 0〜1）, attack（立ち上がり秒） }
// 雑音: noise に濾し方（'highpass' | 'bandpass' | 'lowpass'）、f は濾す周波数、q は鋭さ
const MIDI = (n) => 440 * 2 ** ((n - 69) / 12);

// ラチェット（ねじが回る擦れ）: ねじ山がかかっている間（FX.unscrew の 300ms × 0.72）、同じ角度ごとにカチッと鳴る。
// 抜ける量は時間の2乗で増え、角度は抜けた量に比例するので、k 回目のカチは T√(k/N) の時刻（だんだん詰まる）
export const RATCHET = { clicks: 6, span: 0.216 };
export function ratchetTimes({ clicks, span } = RATCHET) {
  return Array.from({ length: clicks }, (_, i) => span * Math.sqrt((i + 1) / clicks));
}
function ratchet() {
  return ratchetTimes().flatMap((at, i) => [
    { at, d: 0.014, noise: 'highpass', f: 5200, gain: 0.55 + 0.05 * i },
    { at, f: 2900 + 120 * i, d: 0.012, wave: 'square', gain: 0.12 },
  ]);
}

// 板が落ちるコトン: 板の大きさ（面積の平方根）で音程を決める。大きい板ほど低い。木の板を叩いた音（基音＋少し高い部分音）
export const PLATE_PITCH = { ref: 4, f: 330, k: 0.7, min: 140, max: 720 };
export function platePitch(size) {
  const { ref, f, k, min, max } = PLATE_PITCH;
  const s = Number.isFinite(size) && size > 0 ? size : ref;
  return Math.min(max, Math.max(min, f * (ref / s) ** k));
}
function plate(size) {
  const f = platePitch(size);
  return [
    // コ
    { at: 0, f: f * 1.5, to: f * 1.2, d: 0.05, wave: 'sine', gain: 0.5, attack: 0.002 },
    { at: 0, d: 0.03, noise: 'bandpass', f: f * 6, q: 2, gain: 0.35 },
    // トン（少し遅れて低く、長めに響く）
    { at: 0.075, f, to: f * 0.82, d: 0.2, wave: 'sine', gain: 0.75, attack: 0.002 },
    { at: 0.075, f: f * 2.76, d: 0.08, wave: 'sine', gain: 0.18, attack: 0.002 },
    { at: 0.075, d: 0.04, noise: 'lowpass', f: f * 4, q: 0.7, gain: 0.3 },
  ];
}

// 鉄琴の1音（基音と、4倍の澄んだ部分音を短く）
const bell = (at, n, d, gain) => [
  { at, f: MIDI(n), d, wave: 'sine', gain, attack: 0.003 },
  { at, f: MIDI(n) * 4, d: d * 0.35, wave: 'sine', gain: gain * 0.22, attack: 0.002 },
];

// 箱が閉まる音。chain（連鎖の数、E5）が増えるごとに、きらめきを全音（2 半音）ずつ上げ、2 からは3つ目の音で駆け上がる
export const CHAIN_STEP = 2;
function boxFull(chain) {
  const up = CHAIN_STEP * (Math.max(1, Math.min(4, chain)) - 1);
  return [
    { at: 0, f: 210, to: 95, d: 0.1, wave: 'sine', gain: 0.8, attack: 0.002 },
    { at: 0, d: 0.06, noise: 'lowpass', f: 1400, q: 0.8, gain: 0.45 },
    ...bell(0.08, 84 + up, 0.22, 0.32),
    ...bell(0.15, 91 + up, 0.3, 0.3),
    ...(chain >= 2 ? bell(0.22, 96 + up, 0.34, 0.26) : []),
  ];
}

export const SOUNDS = {
  // カチカチと回って、最後にポンと抜ける
  unscrew: [
    ...ratchet(),
    { at: 0.225, f: 380, to: 1100, d: 0.07, wave: 'sine', gain: 0.8, attack: 0.003 },
    { at: 0.225, d: 0.035, noise: 'bandpass', f: 1800, q: 1.2, gain: 0.3 },
  ],
  // 箱に入るカチッ（明るい樹脂の爪が掛かる音）
  box: [
    { at: 0, d: 0.012, noise: 'highpass', f: 3500, gain: 0.6 },
    { at: 0, f: 2400, to: 1900, d: 0.03, wave: 'triangle', gain: 0.45, attack: 0.002 },
    { at: 0.028, f: 1250, to: 1000, d: 0.06, wave: 'sine', gain: 0.5, attack: 0.002 },
  ],
  // 待機スロットに置く（箱より低く、ためらいのある音）
  slot: [
    { at: 0, d: 0.012, noise: 'bandpass', f: 1800, q: 1.5, gain: 0.5 },
    { at: 0, f: 620, to: 480, d: 0.08, wave: 'sine', gain: 0.6, attack: 0.002 },
  ],
  // 箱が閉まるパタン、続けて小さなきらめき
  boxFull: boxFull(1),
  plate: plate(PLATE_PITCH.ref),
  // 隠れていて外せない: 鈍いコツコツ
  blocked: [
    { at: 0, f: 170, to: 130, d: 0.08, wave: 'square', gain: 0.5 },
    { at: 0.11, f: 160, to: 120, d: 0.08, wave: 'square', gain: 0.4 },
  ],
  // スロットがいっぱい: 短いブザー
  full: [{ at: 0, f: 220, to: 185, d: 0.2, wave: 'sawtooth', gain: 0.45 }],
  // 戻す: 巻き戻しのヒュッ
  undo: [
    { at: 0, f: 520, to: 760, d: 0.06, wave: 'sine', gain: 0.6 },
    { at: 0.065, f: 760, to: 440, d: 0.09, wave: 'sine', gain: 0.5 },
  ],
  hint: [...bell(0, 88, 0.2, 0.45), ...bell(0.08, 93, 0.24, 0.45)],
  // クリアのジングル: ド・ミ・ソ・ド と駆け上がり、和音で締める（約 1.2 秒）
  cleared: [
    ...[72, 76, 79, 84].flatMap((n, i) => bell(i * 0.1, n, 0.22, 0.42)),
    ...[84, 88, 91].flatMap((n) => bell(0.42, n, 0.8, 0.2)),
    { at: 0.42, f: MIDI(48), d: 0.7, wave: 'triangle', gain: 0.3, attack: 0.004 },
  ],
  // 詰み: 下がっていく2音
  stuck: [
    { at: 0, f: 330, to: 300, d: 0.22, wave: 'sine', gain: 0.6 },
    { at: 0.22, f: 262, to: 220, d: 0.42, wave: 'sine', gain: 0.6 },
  ],
};

// 合図の音（opts で形を変えるもの: plate は opts.size で音程、boxFull は opts.chain で連鎖）
export function soundOf(name, opts = {}) {
  if (name === 'plate' && opts.size != null) return plate(opts.size);
  if (name === 'boxFull' && opts.chain > 1) return boxFull(opts.chain);
  return SOUNDS[name] ?? [];
}

// 1つの音の中で、同時に鳴っている大きさの和の最大（音割れの目安。テストで MASTER × VOLUME × これ ≤ 1 を確かめる）
export function peakOf(notes) {
  let peak = 0;
  for (const a of notes) {
    let sum = 0;
    for (const b of notes) if (b.at <= a.at && a.at < b.at + b.d) sum += b.gain;
    peak = Math.max(peak, sum);
  }
  return peak;
}

// ---- BGM: おもちゃ箱のオルゴール ----
// 8 小節のループ。1 小節は 8 分音符 8 つ。和音は C・Am・F・G を 2 回（2 回目は旋律を上げる）。
// 旋律は鉄琴、低音は三角波で1拍目と3拍目、裏拍に小さなシャカ（雑音）。数字は MIDI の音番号、null は休み
export const BGM = {
  bpm: 100,
  steps: 8,
  roots: [48, 45, 41, 43, 48, 45, 41, 43],
  chords: [[0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7]],
  melody: [
    [72, null, 76, null, 79, 76, null, 74],
    [72, null, 69, null, 72, null, 76, null],
    [77, null, 76, null, 74, 72, null, 69],
    [71, null, 74, null, 79, null, null, null],
    [76, null, 79, null, 84, null, 79, 76],
    [81, null, 79, null, 76, null, 72, null],
    [77, 76, 74, null, 72, null, 69, null],
    [71, null, 74, null, 72, null, null, null],
  ],
};
export const bgmStepSec = () => 60 / BGM.bpm / 2;
export const bgmLength = () => BGM.melody.length * BGM.steps;

// ループの step 番目（0 から。ループの長さで回る）に鳴らす音（at は 0）
export function bgmNotes(step) {
  const n = bgmLength();
  const i = ((step % n) + n) % n;
  const bar = Math.floor(i / BGM.steps), s = i % BGM.steps;
  const notes = [];
  const m = BGM.melody[bar][s];
  if (m != null) notes.push(...bell(0, m, 0.5, 0.42));
  if (s === 0 || s === 4) notes.push({ at: 0, f: MIDI(BGM.roots[bar] - 12 + (s === 4 ? 7 : 0)), d: 0.42, wave: 'triangle', gain: 0.5, attack: 0.01 });
  if (s === 2 || s === 6) notes.push({ at: 0, d: 0.04, noise: 'highpass', f: 6500, gain: 0.12 });
  return notes;
}

// BGM を鳴らすか: 音が入り・BGM が入り・アプリが表に出ている
export function bgmShouldPlay({ sound, bgm, hidden }) {
  return Boolean(sound && bgm && !hidden);
}

// 音・BGM・振動を鳴らすもの。settings は設定（get('sound') / get('bgm') / get('vibrate')、あれば onChange。null なら全部入り）。
// 音は最初のタッチで AudioContext を作る（ブラウザは利用者の操作の前に音を出させない）。BGM もそこから始まる。
// アプリが裏に回ったら（visibilitychange）BGM を止めて AudioContext を休ませ、表に戻ったら再開する
export function createFeedback(settings, { doc = globalThis.document } = {}) {
  const soundOn = () => settings?.get('sound') ?? true;
  const bgmOn = () => settings?.get('bgm') ?? true;
  const vibrateOn = () => settings?.get('vibrate') ?? true;
  const hidden = () => Boolean(doc?.hidden);
  let ctx = null;
  let out = null;       // 効果音と BGM をまとめる先（全体の大きさ → 割れ止め → スピーカー）
  let noise = null;
  let bgm = null;       // 鳴っている BGM { bus, timer, step, next }

  function unlock() {
    if (!soundOn()) return;
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return;
    try {
      if (!ctx) {
        ctx = new AC();
        out = ctx.createGain();
        out.gain.value = MASTER;
        const comp = ctx.createDynamicsCompressor?.();
        if (comp) out.connect(comp).connect(ctx.destination);
        else out.connect(ctx.destination);
      }
      if (ctx.state === 'suspended' && !hidden()) ctx.resume()?.then?.(updateBgm, () => {});
    } catch {
      ctx = null;
    }
    updateBgm();
  }

  function noiseBuffer() {
    if (noise) return noise;
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
    const d = noise.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = (seed / 2147483647) * 2 - 1;
    }
    return noise;
  }

  // 音を並べて鳴らす。dest は繋ぐ先、vol は大きさ、t0 は始まりの時刻
  function play(notes, dest, vol, t0) {
    for (const n of notes) {
      const start = t0 + n.at, end = start + n.d;
      const peak = Math.max(0.0002, n.gain * vol);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + (n.attack ?? 0.004));
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      gain.connect(dest);
      let src;
      if (n.noise) {
        src = ctx.createBufferSource();
        src.buffer = noiseBuffer();
        const filter = ctx.createBiquadFilter();
        filter.type = n.noise;
        filter.frequency.value = n.f;
        if (n.q != null) filter.Q.value = n.q;
        src.connect(filter).connect(gain);
      } else {
        src = ctx.createOscillator();
        src.type = n.wave;
        src.frequency.setValueAtTime(n.f, start);
        if (n.to) src.frequency.exponentialRampToValueAtTime(n.to, end);
        src.connect(gain);
      }
      src.start(start);
      src.stop(end + 0.02);
    }
  }

  function sound(name, opts) {
    if (!ctx || ctx.state !== 'running') return;
    play(soundOf(name, opts), out, VOLUME[name] ?? 0.5, ctx.currentTime + 0.005);
    if (name === 'cleared') duck(1.4);
  }

  // ---- BGM ----
  const LOOKAHEAD = 0.3;   // 先に予約しておく長さ（秒）。タイマーが遅れても途切れない
  function startBgm() {
    if (bgm || !ctx || ctx.state !== 'running') return;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, ctx.currentTime);
    bus.gain.exponentialRampToValueAtTime(VOLUME.bgm, ctx.currentTime + 0.6);   // ふわっと入る
    bus.connect(out);
    bgm = { bus, step: 0, next: ctx.currentTime + 0.1, timer: null };
    const tick = () => {
      if (!bgm || !ctx) return;
      while (bgm.next < ctx.currentTime + LOOKAHEAD) {
        play(bgmNotes(bgm.step), bgm.bus, 1, bgm.next);
        bgm.step = (bgm.step + 1) % bgmLength();
        bgm.next += bgmStepSec();
      }
    };
    tick();
    bgm.timer = setInterval(tick, 80);
  }
  function stopBgm() {
    if (!bgm) return;
    const { bus, timer } = bgm;
    bgm = null;
    clearInterval(timer);
    try {
      const t = ctx.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value || 0.0001), t);
      bus.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      setTimeout(() => bus.disconnect(), 250);   // 予約済みの音ごと切り離す
    } catch {
      // 止めるだけなので、失敗しても先へ
    }
  }
  // ジングルの間は BGM を小さくする
  function duck(sec) {
    if (!bgm) return;
    const g = bgm.bus.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(VOLUME.bgm, t);
    g.exponentialRampToValueAtTime(VOLUME.bgm * 0.25, t + 0.06);
    g.setValueAtTime(VOLUME.bgm * 0.25, t + sec);
    g.exponentialRampToValueAtTime(VOLUME.bgm, t + sec + 0.8);
  }
  function updateBgm() {
    if (bgmShouldPlay({ sound: soundOn(), bgm: bgmOn(), hidden: hidden() })) startBgm();
    else stopBgm();
  }

  // 裏に回ったら止めて休ませ、表に戻ったら再開する
  doc?.addEventListener?.('visibilitychange', () => {
    if (hidden()) {
      stopBgm();
      try { ctx?.suspend?.(); } catch { /* 休ませられなくても BGM は止めた */ }
    } else if (ctx && soundOn()) {
      try {
        const p = ctx.resume?.();
        if (p?.then) p.then(updateBgm, () => {});
        else updateBgm();
      } catch {
        // 次のタッチの unlock で再開する
      }
    }
  });
  // 音・BGM の入り切りが変わったら、すぐ BGM に効かせる
  settings?.onChange?.((name) => {
    if (name === 'sound' || name === 'bgm') {
      if (soundOn()) unlock();
      else updateBgm();
    }
  });

  function vibrate(name) {
    try {
      globalThis.navigator?.vibrate?.(VIBRATION[name] ?? 0);
    } catch {
      // 振動できない端末では何もしない
    }
  }

  return {
    get sound() { return soundOn(); },
    get vibrate() { return vibrateOn(); },
    get bgmPlaying() { return Boolean(bgm); },
    unlock,
    // 合図を鳴らす（null なら何もしない）。音と振動はそれぞれの設定に従う。opts は音の形（plate なら { size }）
    cue(name, opts) {
      if (!name) return;
      if (soundOn()) sound(name, opts);
      if (vibrateOn()) vibrate(name);
    },
    // 設定を入れたときの確かめ（音だけ・振動だけを鳴らす）
    sample(kind, name = 'box') {
      if (kind === 'sound' && soundOn()) {
        unlock();
        sound(name);
      }
      if (kind === 'vibrate' && vibrateOn()) vibrate(name);
    },
  };
}
