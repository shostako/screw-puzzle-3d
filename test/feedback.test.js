import { describe, it, expect, vi, afterEach } from 'vitest';
import { createFeedback, tapCue, eventCue, endCue, VIBRATION, SOUNDS } from '../src/feedback.js';
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

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
