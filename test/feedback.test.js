import { describe, it, expect, vi, afterEach } from 'vitest';
import { createFeedback, tapCue, eventCue, endCue, VIBRATION, SOUNDS, SETTING_KEY } from '../src/feedback.js';
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
  it('既定は入り。切ると振動せず、切ったことを端末に保存する', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    const storage = new Map();
    const store = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
    const fb = createFeedback(store);
    expect(fb.on).toBe(true);
    fb.cue('unscrew');
    expect(vibrate).toHaveBeenLastCalledWith(VIBRATION.unscrew);
    fb.on = false;
    expect(storage.get(SETTING_KEY)).toBe('off');
    fb.cue('cleared');
    expect(vibrate).toHaveBeenCalledTimes(1);
    // 次に開いたときも切れたまま
    expect(createFeedback(store).on).toBe(false);
  });

  it('保存できない端末や、振動できない端末でも例外にならない', () => {
    vi.stubGlobal('navigator', {});
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    const fb = createFeedback(broken);
    expect(fb.on).toBe(true);
    expect(() => fb.cue('box')).not.toThrow();
    expect(() => { fb.on = false; }).not.toThrow();
    expect(() => createFeedback(null).cue(null)).not.toThrow();
  });
});
