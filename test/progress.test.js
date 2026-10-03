import { describe, it, expect, beforeAll } from 'vitest';
import { createResume, restoreRecord, replayPath, levelSignature, encodeSnapshot, decodeSnapshot, physicsAgrees, validRecord, RESUME_KEY, RESUME_VERSION } from '../src/resume.js';
import { createProgress, STORAGE_KEY as STAGE_KEY } from '../src/progress.js';
import { createBests, BEST_KEY, createPlayClock } from '../src/rating.js';
import { createSettings, clearRecords, SETTINGS_KEY } from '../src/settings.js';
import { createGame } from '../src/game.js';
import { stageLevel } from '../src/stages.js';
import { randomLevel, dailyLevel } from '../src/random.js';
import { initPhysics, createPhysics, syncPlates, settle } from '../src/physics.js';
import { removeScrew } from '../src/rules.js';

beforeAll(() => initPhysics());

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { map: m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// 生成器の手順の頭 n 手を、物理の隠れ判定なしで打つ（ルールだけの1局）
function playSome(level, n) {
  const g = createGame(level, () => false);
  for (const id of level.meta.solution.slice(0, n)) expect(g.tap(id).reason).toBe('ok');
  return g;
}

const record = (level, g, extra = {}) => ({
  mode: { type: 'stage' }, stage: 5, sig: levelSignature(level), path: g.path,
  seconds: 42.5, hints: 1, rewinds: 2, view: { q: [0, 0, 0, 1], d: 19 }, physics: null, ...extra,
});

describe('遊んでいる途中の局面の保存（E10）', () => {
  const cases = [
    ['ステージ', () => stageLevel(5), { mode: { type: 'stage' }, stage: 5 }],
    ['おまかせ', () => randomLevel(1234, 'hard'), { mode: { type: 'random', no: 1234, difficulty: 'hard' }, stage: 3 }],
    ['今日の1問', () => dailyLevel(20261003), { mode: { type: 'daily', key: 20261003 }, stage: 3 }],
  ];
  for (const [name, make, mode] of cases) {
    it(`${name}: 保存して開き直すと、同じ盤面・同じ局面・同じ時間と回数から続き、戻るの履歴もそろう`, () => {
      const level = make();
      const g = playSome(level, 7);
      const st = memoryStorage();
      expect(createResume(st).save(record(level, g, mode))).toBe(true);

      // 開き直す: 保存から遊び方を読み、同じ盤面を作り直して戻す
      const loaded = createResume(memoryStorage(Object.fromEntries(st.map))).load();
      expect(loaded.mode).toEqual(mode.mode);
      const again = make();
      const r = restoreRecord(loaded, again);
      expect(r).not.toBeNull();
      expect(r.state.where).toEqual(g.state.where);
      expect(r.state.boxes).toEqual(g.state.boxes);
      expect(r.state.slots).toEqual(g.state.slots);
      expect([r.seconds, r.hints, r.rewinds]).toEqual([42.5, 1, 2]);

      const g2 = createGame(again, () => false);
      g2.resume(r, r.path);
      expect(g2.moves).toBe(7);
      expect(g2.path).toEqual(g.path);
      expect(g2.status).toBe('playing');
      // 続きを手順どおりに外せばクリアできる
      for (const id of level.meta.solution.slice(7)) expect(g2.tap(id).reason).toBe('ok');
      expect(g2.status).toBe('cleared');
      // 戻すと、保存前に外した手の直前の局面へ戻れる
      const g3 = createGame(again, () => false);
      g3.resume(r, r.path);
      expect(g3.rewind(3)).toBe(true);
      expect(g3.state.where).toEqual(playSome(level, 3).state.where);
    });
  }

  it('打ち直し: 外した順に打てばルールの局面が同じになり、外せない手があれば null', () => {
    const level = stageLevel(8);
    const g = playSome(level, 10);
    const r = replayPath(level, g.path);
    expect(r.state.where).toEqual(g.state.where);
    expect(r.history.length).toBe(10);
    expect(replayPath(level, [...g.path, g.path[0]])).toBeNull();   // 同じねじは2回外せない
    expect(replayPath(level, ['no-such-screw'])).toBeNull();
  });

  it('盤面の作りが変わった後（指紋が違う）、壊れた保存、クリア済みの局面は戻さない', () => {
    const level = stageLevel(5);
    const g = playSome(level, 5);
    expect(restoreRecord(record(level, g), stageLevel(6))).toBeNull();
    expect(restoreRecord(record(level, g), level)).toBeNull();   // v が無い形は validRecord が拒む（save が付ける）
    const ok = { v: RESUME_VERSION, ...record(level, g) };
    expect(restoreRecord(ok, level)).not.toBeNull();
    expect(restoreRecord({ ...ok, sig: '00000000' }, level)).toBeNull();
    expect(restoreRecord({ ...ok, path: ['zzz'] }, level)).toBeNull();
    expect(restoreRecord({ ...ok, seconds: -1 }, level)).toBeNull();
    const done = playSome(level, level.meta.solution.length);
    expect(done.status).toBe('cleared');
    expect(restoreRecord({ ...ok, path: done.path }, level)).toBeNull();

    const st = memoryStorage({ [RESUME_KEY]: 'こわれた' });
    expect(createResume(st).load()).toBeNull();
    st.setItem(RESUME_KEY, JSON.stringify({ ...ok, v: 0 }));
    expect(createResume(st).load()).toBeNull();
    st.setItem(RESUME_KEY, JSON.stringify({ ...ok, mode: { type: 'random', no: 0, difficulty: 'hard' } }));
    expect(createResume(st).load()).toBeNull();
    expect(createResume(null).load()).toBeNull();
    expect(createResume(null).save(ok)).toBe(false);
  });

  it('盤面の指紋: 同じ盤面は同じ値、違う盤面は違う値', () => {
    expect(levelSignature(stageLevel(9))).toBe(levelSignature(stageLevel(9)));
    const sigs = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => levelSignature(stageLevel(n))));
    expect(sigs.size).toBe(10);
    expect(levelSignature(randomLevel(5, 'easy'))).not.toBe(levelSignature(randomLevel(5, 'normal')));
  });

  it('物理の写しは JSON を通しても戻せ、そこから同じ操作で写さずに続けたときと同じ姿勢になる', () => {
    const level = stageLevel(8);
    const g = playSome(level, 12);
    const ph = createPhysics(level);
    syncPlates(ph, g.state);
    ph.setDown([0.3, -0.9, 0.2]);
    for (let i = 0; i < 20; i++) ph.step();   // 板が動いている途中で写す
    const saved = JSON.parse(JSON.stringify(encodeSnapshot(ph.snapshot())));
    expect(typeof saved.bytes).toBe('string');

    const ph2 = createPhysics(level);
    ph2.restore(decodeSnapshot(saved));
    expect(physicsAgrees(g.state, (id) => ph2.mode(id))).toBe(true);
    for (let i = 0; i < 90; i++) {
      ph.step();
      ph2.step();
    }
    expect(ph2.poses()).toEqual(ph.poses());
    ph.free();
    ph2.free();
  });

  it('写しが無いとき: ルールの局面から物理を作り直して落ち着かせると、板の状態は局面と食い違わない', () => {
    const level = stageLevel(8);
    const g = playSome(level, 12);
    const ph = createPhysics(level);
    syncPlates(ph, g.state);
    ph.setDown([0, -1, 0]);
    settle(ph);
    expect(ph.moving()).toBe(false);
    expect(physicsAgrees(g.state, (id) => ph.mode(id))).toBe(true);
    // 最初の局面の物理（全部固定）は、12 手進んだ局面とは食い違う
    const fresh = createPhysics(level);
    expect(physicsAgrees(g.state, (id) => fresh.mode(id))).toBe(false);
    ph.free();
    fresh.free();
  });

  it('容量が足りないときは、物理の写しを外して保存する', () => {
    const level = stageLevel(5);
    const g = playSome(level, 3);
    const st = memoryStorage();
    const setItem = st.setItem;
    st.setItem = (k, v) => {
      if (v.length > 2000) throw new Error('QuotaExceededError');
      setItem(k, v);
    };
    expect(createResume(st).save(record(level, g, { physics: { bytes: 'A'.repeat(5000) } }))).toBe(true);
    const r = createResume(st).load();
    expect(r.physics).toBeNull();
    expect(r.path).toEqual(g.path);
  });

  it('遊んだ時間の時計は、保存した秒から続けて数える', () => {
    let t = 0;
    const c = createPlayClock(() => t);
    c.resume();
    t = 5000;
    c.set(42.5);
    expect(c.running).toBe(false);
    expect(c.seconds).toBe(42.5);
    c.resume();
    t = 8000;
    expect(c.seconds).toBe(45.5);
  });
});

describe('既存の記録を守る（E10 で保存を足した後も）', () => {
  // E10 より前の版の端末: 到達したステージ・自己ベスト・設定だけがある
  const before = () => memoryStorage({
    [STAGE_KEY]: '12',
    [BEST_KEY]: JSON.stringify({ 3: { stars: 3, seconds: 40 }, 'daily-20261002': { stars: 2, seconds: 99 } }),
    [SETTINGS_KEY]: JSON.stringify({ sound: false, vibrate: true, speed: 'fast', quality: 'light', mascot: true }),
  });

  it('途中の局面が無い古い端末でも、到達したステージ・自己ベスト・設定はそのまま読め、続きは無いとみなす', () => {
    const st = before();
    expect(createResume(st).load()).toBeNull();
    expect(createProgress(st).stage).toBe(12);
    expect(createBests(st).get(3)).toEqual({ stars: 3, seconds: 40 });
    expect(createBests(st).get('daily-20261002')).toEqual({ stars: 2, seconds: 99 });
    expect(createSettings(st).get('speed')).toBe('fast');
  });

  it('途中の局面を保存・上書き・消しても、ほかの記録の値は1文字も変わらない', () => {
    const st = before();
    const snapshot = () => [STAGE_KEY, BEST_KEY, SETTINGS_KEY].map((k) => st.getItem(k));
    const was = snapshot();
    const level = stageLevel(12);
    const resume = createResume(st);
    resume.save(record(level, playSome(level, 4), { stage: 12 }));
    resume.save(record(level, playSome(level, 6), { stage: 12 }));
    expect(resume.load().path.length).toBe(6);
    expect(snapshot()).toEqual(was);
    resume.clear();
    expect(resume.load()).toBeNull();
    expect(snapshot()).toEqual(was);
  });

  it('記録を消すと途中の局面も消え、設定は残る', () => {
    const st = before();
    const level = stageLevel(12);
    createResume(st).save(record(level, playSome(level, 4), { stage: 12 }));
    clearRecords(st);
    expect(createResume(st).load()).toBeNull();
    expect(createProgress(st).stage).toBe(1);
    expect(st.getItem(SETTINGS_KEY)).not.toBeNull();
  });

  it('保存の形の確かめ', () => {
    const level = stageLevel(2);
    const ok = { v: RESUME_VERSION, ...record(level, playSome(level, 1)) };
    expect(validRecord(ok)).toBe(true);
    expect(validRecord({ ...ok, mode: { type: 'free' } })).toBe(false);
    expect(validRecord({ ...ok, stage: 0 })).toBe(false);
    expect(validRecord({ ...ok, hints: 1.5 })).toBe(false);
    expect(validRecord({ ...ok, path: [1, 2] })).toBe(false);
    expect(validRecord({ ...ok, mode: { type: 'daily', key: '20261003' } })).toBe(false);
  });
});
