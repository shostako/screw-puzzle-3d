import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createFeedback, tapCue, eventCue, endCue, VIBRATION, SOUNDS, VOLUME, MASTER, peakOf, soundOf, platePitch,
  ratchetTimes, RATCHET, BGM, bgmNotes, bgmLength, bgmShouldPlay,
} from '../src/feedback.js';
import { FX } from '../src/effects.js';
import { createSettings } from '../src/settings.js';
import { createGame } from '../src/game.js';
import { BOX_LEVEL } from '../src/levels/box.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

afterEach(() => vi.unstubAllGlobals());

describe('どの場面で何を鳴らすか', () => {
  it('タップの結果: 外れた・隠れている・いっぱい。それ以外は鳴らさない', () => {
    expect(tapCue('ok')).toBe('unscrew');
    expect(tapCue('blocked')).toBe('blocked');
    expect(tapCue('full')).toBe('full');
    expect(tapCue('gone')).toBeNull();
    expect(tapCue('over')).toBeNull();
  });

  it('板は落ちるときだけ鳴らし、ぶら下がるときは鳴らさない', () => {
    expect(eventCue({ type: 'plate', from: 'fixed', to: 'hanging' })).toBeNull();
    expect(eventCue({ type: 'plate', from: 'hanging', to: 'fallen' })).toBe('plate');
    expect(eventCue({ type: 'boxSpawn' })).toBeNull();
  });

  it('クリアと詰み', () => {
    expect(endCue('cleared')).toBe('cleared');
    expect(endCue('stuck')).toBe('stuck');
    expect(endCue('playing')).toBeNull();
  });

  it('ランダムに遊んで出てくる合図には、どれも音と振動の型がある', () => {
    const seen = new Set();
    for (let k = 0; k < 100; k++) {
      const g = createGame(BOX_LEVEL);
      const rand = rng(k + 1);
      while (g.status === 'playing') {
        const ids = BOX_LEVEL.screws.map((s) => s.id).filter((id) => g.state.where[id] === 'board');
        const r = g.tap(ids[Math.floor(rand() * ids.length)]);
        seen.add(tapCue(r.reason));
        for (const ev of r.events) seen.add(eventCue(ev));
        seen.add(endCue(r.status));
      }
    }
    seen.delete(null);
    for (const cue of ['unscrew', 'blocked', 'box', 'slot', 'boxFull', 'plate', 'cleared']) expect(seen).toContain(cue);
    for (const cue of seen) {
      expect(VIBRATION[cue], cue).toBeDefined();
      expect(SOUNDS[cue]?.length, cue).toBeGreaterThan(0);
    }
  });

  it('音と振動の型の名前はそろっている', () => {
    expect(Object.keys(SOUNDS).sort()).toEqual(Object.keys(VIBRATION).sort());
  });
});

describe('音と振動の入り切り', () => {
  it('既定は両方入り。振動を切ると振動しない（音の設定とは別）', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    const settings = createSettings(memoryStorage());
    const fb = createFeedback(settings);
    expect(fb.sound).toBe(true);
    expect(fb.vibrate).toBe(true);
    fb.cue('unscrew');
    expect(vibrate).toHaveBeenLastCalledWith(VIBRATION.unscrew);
    settings.set('vibrate', false);
    fb.cue('cleared');
    expect(vibrate).toHaveBeenCalledTimes(1);
    // 音だけ切っても振動は続く
    settings.set('vibrate', true);
    settings.set('sound', false);
    fb.cue('box');
    expect(vibrate).toHaveBeenLastCalledWith(VIBRATION.box);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('振動の確かめは振動を切っていると鳴らさない', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    const settings = createSettings(memoryStorage());
    const fb = createFeedback(settings);
    fb.sample('vibrate');
    expect(vibrate).toHaveBeenCalledTimes(1);
    settings.set('vibrate', false);
    fb.sample('vibrate');
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('設定が無くても、振動できない端末でも例外にならない', () => {
    vi.stubGlobal('navigator', {});
    const fb = createFeedback(null);
    expect(fb.sound).toBe(true);
    expect(() => fb.cue('box')).not.toThrow();
    expect(() => fb.cue(null)).not.toThrow();
    expect(() => fb.sample('sound')).not.toThrow();
  });
});

describe('音の作り（E6）', () => {
  const cues = Object.keys(SOUNDS);

  it('どの合図にも音量があり、全体の大きさを掛けても割れない（同時に鳴る大きさの和 ≤ 1）', () => {
    for (const c of cues) {
      expect(VOLUME[c], c).toBeGreaterThan(0);
      expect(MASTER * VOLUME[c] * peakOf(SOUNDS[c]), c).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < bgmLength(); i++) expect(MASTER * VOLUME.bgm * peakOf(bgmNotes(i))).toBeLessThanOrEqual(1);
  });

  it('音量の釣り合い: 毎タップ鳴る音が一番小さく、クリアが一番大きく、BGM は効果音のどれよりも小さい', () => {
    const sfx = cues.map((c) => VOLUME[c]);
    for (const c of ['unscrew', 'box', 'slot']) {
      for (const d of ['blocked', 'full', 'undo', 'hint', 'boxFull', 'plate', 'stuck', 'cleared']) expect(VOLUME[c], `${c} < ${d}`).toBeLessThan(VOLUME[d]);
    }
    expect(VOLUME.cleared).toBe(Math.max(...sfx));
    expect(VOLUME.bgm).toBeLessThan(Math.min(...sfx));
  });

  it('ラチェットのカチはねじ山がかかっている間に鳴り、だんだん詰まる。最後にポンと抜ける', () => {
    const t = ratchetTimes();
    expect(t).toHaveLength(RATCHET.clicks);
    expect(RATCHET.span * 1000).toBeCloseTo(FX.unscrew.ms * FX.unscrew.engaged, 5);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    for (let i = 2; i < t.length; i++) expect(t[i] - t[i - 1]).toBeLessThan(t[i - 1] - t[i - 2]);
    const pop = SOUNDS.unscrew.filter((n) => !n.noise && n.to > n.f);
    expect(pop.length).toBe(1);
    expect(pop[0].at).toBeGreaterThanOrEqual(t.at(-1));
  });

  it('板のコトンは大きい板ほど低い。大きさが分からなければ基準の音程、極端な大きさは上下で止める', () => {
    expect(platePitch(6)).toBeLessThan(platePitch(4));
    expect(platePitch(4)).toBeLessThan(platePitch(2));
    expect(platePitch(undefined)).toBe(platePitch(4));
    expect(platePitch(0.01)).toBe(720);
    expect(platePitch(1000)).toBe(140);
    const low = Math.min(...soundOf('plate', { size: 6 }).filter((n) => !n.noise).map((n) => n.f));
    const high = Math.min(...soundOf('plate', { size: 2 }).filter((n) => !n.noise).map((n) => n.f));
    expect(low).toBeLessThan(high);
    expect(soundOf('plate')).toBe(SOUNDS.plate);
  });

  it('箱の連鎖（E5）: 2 連鎖からきらめきの音程が上がり、音を足しても割れない', () => {
    expect(soundOf('boxFull', { chain: 1 })).toBe(SOUNDS.boxFull);
    const top = (c) => Math.max(...soundOf('boxFull', { chain: c }).filter((n) => !n.noise).map((n) => n.f));
    expect(top(2)).toBeGreaterThan(top(1));
    expect(top(3)).toBeGreaterThan(top(2));
    expect(top(9)).toBe(top(4));
    for (const c of [2, 3, 4]) expect(MASTER * VOLUME.boxFull * peakOf(soundOf('boxFull', { chain: c }))).toBeLessThanOrEqual(1);
  });

  it('BGM: 8 小節のループで、旋律は和音の音か C 長調の音だけ。どの拍にも何かが鳴る', () => {
    const scale = new Set([0, 2, 4, 5, 7, 9, 11]);
    expect(BGM.melody).toHaveLength(BGM.roots.length);
    for (const bar of BGM.melody) {
      expect(bar).toHaveLength(BGM.steps);
      for (const n of bar) if (n != null) expect(scale.has(n % 12), String(n)).toBe(true);
    }
    for (let i = 0; i < bgmLength(); i++) if (i % 2 === 0) expect(bgmNotes(i).length, String(i)).toBeGreaterThan(0);
    expect(bgmNotes(bgmLength())).toEqual(bgmNotes(0));   // ループする
  });

  it('BGM を鳴らすのは、音が入り・BGM が入り・アプリが表にある時だけ', () => {
    expect(bgmShouldPlay({ sound: true, bgm: true, hidden: false })).toBe(true);
    expect(bgmShouldPlay({ sound: false, bgm: true, hidden: false })).toBe(false);
    expect(bgmShouldPlay({ sound: true, bgm: false, hidden: false })).toBe(false);
    expect(bgmShouldPlay({ sound: true, bgm: true, hidden: true })).toBe(false);
  });
});

describe('鳴らすもの（Web Audio の代わりの記録係で）', () => {
  function setup(init = {}) {
    vi.useFakeTimers();
    const made = { osc: 0, noise: 0, ctx: null };
    class FakeAC {
      constructor() {
        this.state = 'running';
        this.currentTime = 0;
        this.sampleRate = 8000;
        this.destination = {};
        made.ctx = this;
      }
      param() {
        return { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} };
      }
      node(extra = {}) { return { connect: (n) => n, disconnect() {}, ...extra }; }
      createGain() { return this.node({ gain: this.param() }); }
      createDynamicsCompressor() { return this.node(); }
      createBiquadFilter() { return this.node({ frequency: this.param(), Q: this.param() }); }
      createOscillator() { made.osc++; return this.node({ frequency: this.param(), start() {}, stop() {} }); }
      createBufferSource() { made.noise++; return this.node({ start() {}, stop() {} }); }
      createBuffer(_c, n) { return { getChannelData: () => new Float32Array(n) }; }
      resume() { this.state = 'running'; return Promise.resolve(); }
      suspend() { this.state = 'suspended'; return Promise.resolve(); }
    }
    vi.stubGlobal('AudioContext', FakeAC);
    vi.stubGlobal('navigator', { vibrate: vi.fn() });
    const doc = new EventTarget();
    doc.hidden = false;
    const settings = createSettings(memoryStorage());
    for (const [k, v] of Object.entries(init)) settings.set(k, v);
    const fb = createFeedback(settings, { doc });
    return { made, doc, settings, fb };
  }
  afterEach(() => vi.useRealTimers());

  it('最初のタッチまでは音を作らず、タッチの後に BGM が始まる', () => {
    const { made, fb } = setup();
    fb.cue('unscrew');
    expect(made.ctx).toBeNull();
    fb.unlock();
    expect(fb.bgmPlaying).toBe(true);
    const before = made.osc;
    made.ctx.currentTime = 2;
    vi.advanceTimersByTime(200);
    expect(made.osc).toBeGreaterThan(before);   // 譜面が先へ進んで予約される
  });

  it('音を切ると効果音も BGM も止まり、BGM だけ切ると効果音は鳴る', () => {
    const { made, settings, fb } = setup();
    fb.unlock();
    settings.set('bgm', false);
    expect(fb.bgmPlaying).toBe(false);
    const n = made.osc + made.noise;
    fb.cue('box');
    expect(made.osc + made.noise).toBeGreaterThan(n);
    settings.set('bgm', true);
    expect(fb.bgmPlaying).toBe(true);
    settings.set('sound', false);
    expect(fb.bgmPlaying).toBe(false);
    const m = made.osc + made.noise;
    fb.cue('cleared');
    expect(made.osc + made.noise).toBe(m);
    settings.set('sound', true);   // 入れ直すと BGM も戻る
    expect(fb.bgmPlaying).toBe(true);
  });

  it('BGM を切って保存した端末では、タッチしても BGM は始まらない', () => {
    const { fb } = setup({ bgm: false });
    fb.unlock();
    expect(fb.bgmPlaying).toBe(false);
  });

  it('アプリが裏に回ると BGM を止めて休ませ、表に戻ると再開する', async () => {
    const { made, doc, fb } = setup();
    fb.unlock();
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(fb.bgmPlaying).toBe(false);
    expect(made.ctx.state).toBe('suspended');
    fb.unlock();   // 裏にいる間のタッチでは鳴らし始めない
    expect(fb.bgmPlaying).toBe(false);
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    await Promise.resolve();
    expect(made.ctx.state).toBe('running');
    expect(fb.bgmPlaying).toBe(true);
  });

  it('板の音は大きさを受け取っても例外にならず、知らない合図は音を作らない', () => {
    const { made, fb } = setup();
    fb.unlock();
    expect(() => fb.cue('plate', { size: 5 })).not.toThrow();
    const n = made.osc + made.noise;
    fb.cue('nothing');
    expect(made.osc + made.noise).toBe(n);
  });
});

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
