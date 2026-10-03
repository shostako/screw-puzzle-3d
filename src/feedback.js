// 効果音と振動（M8）。
// どの場面で何を鳴らすか（合図 = cue の名前）と、合図ごとの振動の型・音の型は、描画にも DOM にも依存しない（テストする）。
// 鳴らすのは createFeedback() が返すもので、音は Web Audio で合成する（音のファイルは持たない。dist だけで動き、軽い）。
//
// 合図:
//   unscrew  ねじが外れた（タップの瞬間）
//   blocked  隠れていて外せない
//   full     待機スロットがいっぱいで外せない
//   box      ねじが箱に入った（スロットから移ったときも）
//   slot     ねじが待機スロットに入った
//   boxFull  箱が満杯になった
//   plate    板が外れて落ち始めた
//   cleared  クリア
//   stuck    詰み
//   undo     戻した（1手戻す・解ける所まで戻る）

export const SETTING_KEY = 'screw-puzzle-3d.sound';

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

// 音の型: 音を順に並べたもの。{ at: 始まり（秒）, f: 周波数（Hz）, to: 終わりの周波数, d: 長さ（秒）, wave, gain, noise }
// noise が true なら雑音（ねじが回る擦れの音）
export const SOUNDS = {
  unscrew: [{ at: 0, f: 900, to: 1500, d: 0.09, wave: 'triangle', gain: 0.18 }, { at: 0, d: 0.08, noise: true, gain: 0.08 }],
  blocked: [{ at: 0, f: 140, to: 110, d: 0.12, wave: 'square', gain: 0.1 }, { at: 0.13, f: 140, to: 110, d: 0.1, wave: 'square', gain: 0.08 }],
  full: [{ at: 0, f: 220, to: 180, d: 0.18, wave: 'sawtooth', gain: 0.07 }],
  box: [{ at: 0, f: 660, to: 520, d: 0.07, wave: 'sine', gain: 0.22 }],
  slot: [{ at: 0, f: 420, to: 360, d: 0.07, wave: 'sine', gain: 0.2 }],
  boxFull: [{ at: 0, f: 784, d: 0.12, wave: 'triangle', gain: 0.16 }, { at: 0.09, f: 1175, d: 0.2, wave: 'triangle', gain: 0.16 }],
  plate: [{ at: 0, f: 200, to: 90, d: 0.25, wave: 'triangle', gain: 0.16 }],
  cleared: [523, 659, 784, 1047].map((f, i) => ({ at: i * 0.11, f, d: i === 3 ? 0.45 : 0.14, wave: 'triangle', gain: 0.16 })),
  undo: [{ at: 0, f: 520, to: 700, d: 0.06, wave: 'sine', gain: 0.16 }, { at: 0.07, f: 700, to: 440, d: 0.08, wave: 'sine', gain: 0.14 }],
  hint: [1319, 1760].map((f, i) => ({ at: i * 0.08, f, d: 0.16, wave: 'sine', gain: 0.14 })),
  stuck: [{ at: 0, f: 330, to: 300, d: 0.22, wave: 'sine', gain: 0.16 }, { at: 0.22, f: 262, to: 220, d: 0.4, wave: 'sine', gain: 0.16 }],
};

// 音と振動を鳴らすもの。storage は設定の保存先（localStorage と同じ形、null なら保存しない）。
// 音は最初のタッチで AudioContext を作る（ブラウザは利用者の操作の前に音を出させない）
export function createFeedback(storage) {
  let on = true;
  try {
    on = storage?.getItem(SETTING_KEY) !== 'off';
  } catch {
    // 読めなければ鳴らす
  }
  let ctx = null;
  let noise = null;

  function unlock() {
    if (!on) return;
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return;
    try {
      ctx ??= new AC();
      if (ctx.state === 'suspended') ctx.resume();
    } catch {
      ctx = null;
    }
  }

  function noiseBuffer() {
    if (noise) return noise;
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
    const d = noise.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = (seed / 2147483647) * 2 - 1;
    }
    return noise;
  }

  function sound(name) {
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + 0.005;
    for (const n of SOUNDS[name] ?? []) {
      const start = t0 + n.at, end = start + n.d;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(n.gain, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      gain.connect(ctx.destination);
      let src;
      if (n.noise) {
        src = ctx.createBufferSource();
        src.buffer = noiseBuffer();
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = 3000;
        src.connect(band).connect(gain);
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

  return {
    get on() { return on; },
    set on(v) {
      on = !!v;
      try {
        storage?.setItem(SETTING_KEY, on ? 'on' : 'off');
      } catch {
        // 保存できなくても、この回は切り替える
      }
      if (on) unlock();
    },
    unlock,
    // 合図を鳴らす（null なら何もしない）
    cue(name) {
      if (!on || !name) return;
      sound(name);
      try {
        globalThis.navigator?.vibrate?.(VIBRATION[name] ?? 0);
      } catch {
        // 振動できない端末では何もしない
      }
    },
  };
}
