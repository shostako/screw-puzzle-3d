import { describe, it, expect, vi } from 'vitest';
import { createSettings, clearRecords, DEFAULTS, SETTINGS_KEY, LEGACY_SOUND_KEY, SPEEDS, QUALITIES } from '../src/settings.js';
import { createProgress, STORAGE_KEY as STAGE_KEY } from '../src/progress.js';
import { createBests, BEST_KEY } from '../src/rating.js';
import { buildBoard, setKnurl } from '../src/scene.js';
import { stageLevel } from '../src/stages.js';

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { map: m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

describe('設定', () => {
  it('既定: 音と振動は入り、回す速さはふつう、画質は自動、ネジまるは出す', () => {
    const s = createSettings(memoryStorage());
    expect(s.all()).toEqual({ sound: true, vibrate: true, speed: 'normal', quality: 'auto', mascot: true });
    expect(DEFAULTS).toEqual(s.all());
  });

  it('変えた値は保存され、次に開いたときも残る', () => {
    const st = memoryStorage();
    const s = createSettings(st);
    expect(s.set('vibrate', false)).toBe(true);
    expect(s.set('speed', 'fast')).toBe(true);
    expect(s.set('quality', 'light')).toBe(true);
    expect(s.set('mascot', false)).toBe(true);
    expect(createSettings(st).all()).toEqual({ sound: true, vibrate: false, speed: 'fast', quality: 'light', mascot: false });
  });

  it('知らない値は受け付けず、壊れた保存は既定に戻す', () => {
    const st = memoryStorage();
    const s = createSettings(st);
    expect(s.set('speed', 'warp')).toBe(false);
    expect(s.set('sound', 'yes')).toBe(false);
    expect(s.set('nothing', true)).toBe(false);
    expect(s.all()).toEqual(DEFAULTS);
    st.setItem(SETTINGS_KEY, '{"speed":"warp","quality":"light","sound":1}');
    expect(createSettings(st).all()).toEqual({ ...DEFAULTS, quality: 'light' });
    st.setItem(SETTINGS_KEY, 'こわれた');
    expect(createSettings(st).all()).toEqual(DEFAULTS);
  });

  it('前の版で音と振動を切っていた端末は、両方切ったまま始まる（新しい保存があればそちら）', () => {
    expect(createSettings(memoryStorage({ [LEGACY_SOUND_KEY]: 'off' })).all()).toMatchObject({ sound: false, vibrate: false });
    expect(createSettings(memoryStorage({ [LEGACY_SOUND_KEY]: 'on' })).all()).toMatchObject({ sound: true, vibrate: true });
    const both = memoryStorage({ [LEGACY_SOUND_KEY]: 'off', [SETTINGS_KEY]: JSON.stringify({ sound: true }) });
    expect(createSettings(both).all()).toMatchObject({ sound: true, vibrate: true });
  });

  it('変わったときだけ知らせる', () => {
    const s = createSettings(memoryStorage());
    const f = vi.fn();
    const off = s.onChange(f);
    s.set('speed', 'slow');
    s.set('speed', 'slow');
    s.set('speed', 'bad');
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith('speed', 'slow');
    off();
    s.set('speed', 'fast');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('保存できない端末でも例外にならず、その回は切り替わる', () => {
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    const s = createSettings(broken);
    expect(s.all()).toEqual(DEFAULTS);
    expect(s.set('sound', false)).toBe(true);
    expect(s.get('sound')).toBe(false);
    expect(createSettings(null).all()).toEqual(DEFAULTS);
    expect(() => clearRecords(broken)).not.toThrow();
    expect(() => clearRecords(null)).not.toThrow();
  });

  it('回す速さはゆっくり < ふつう(1) < はやい、画質「軽い」は解像度 1 だけでローレットを刻まない', () => {
    expect(SPEEDS.slow.k).toBeLessThan(1);
    expect(SPEEDS.normal.k).toBe(1);
    expect(SPEEDS.fast.k).toBeGreaterThan(1);
    expect(QUALITIES.light.pixelRatios).toEqual([1]);
    expect(QUALITIES.light.knurl).toBe(false);
    expect(QUALITIES.auto.knurl).toBe(true);
    expect(QUALITIES.light.idleEvery).toBeGreaterThan(QUALITIES.auto.idleEvery);
    for (const q of Object.values(QUALITIES)) expect(q.pixelRatios.every((r, i, a) => i === 0 || r < a[i - 1])).toBe(true);
  });
});

describe('記録を消す', () => {
  it('到達したステージと自己ベストは消え、設定は残る', () => {
    const st = memoryStorage();
    createProgress(st).cleared(5);
    createBests(st).record(3, { stars: 3, seconds: 40 });
    createSettings(st).set('speed', 'fast');
    expect(st.map.has(STAGE_KEY)).toBe(true);
    expect(st.map.has(BEST_KEY)).toBe(true);
    clearRecords(st);
    expect(createProgress(st).stage).toBe(1);
    expect(createBests(st).get(3)).toBeNull();
    expect(createSettings(st).get('speed')).toBe('fast');
  });
});

describe('画質「軽い」の盤面', () => {
  const meshes = (o) => {
    const out = [];
    o.traverse((m) => m.isMesh && out.push(m));
    return out;
  };
  const tris = (g) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  const total = (board) => meshes(board.root).reduce((t, m) => t + tris(m.geometry), 0);

  it('ねじの頭の三角形が減り、描く回数は変わらない。途中で差し替えても同じになる', () => {
    const level = stageLevel(20);
    const fine = buildBoard(level), light = buildBoard(level, { knurl: false });
    expect(meshes(light.root).length).toBe(meshes(fine.root).length);
    expect(total(light)).toBeLessThan(total(fine) * 0.7);
    setKnurl(fine, false);
    expect(total(fine)).toBe(total(light));
    setKnurl(fine, true);
    expect(total(fine)).toBe(total(buildBoard(level)));
  });
});
