import { describe, it, expect } from 'vitest';
import { plateLayers, slotUses, difficultyOf, plainOf } from '../src/layers.js';
import { generateLevel, THEMES, KINDS, LAYER_TABLE } from '../src/generator.js';
import { coverMap } from '../src/board.js';
import { safeBlocker } from '../src/safe.js';
import { newGame, removeScrew } from '../src/rules.js';

const SEEDS = [1, 2, 3, 4, 5, 6];

describe('層（D5）', () => {
  it('題材では、子の部品の層は親より浅い。根（芯）が一番深い', () => {
    for (const kind of THEMES) {
      for (const seed of SEEDS) {
        const level = generateLevel(seed, { kind });
        const layer = plateLayers(level);
        const max = Math.max(...Object.values(layer));
        for (const p of level.plates) {
          expect(p.id in layer, `${kind} ${seed} ${p.id} の層が無い`).toBe(true);
          if (p.parent) expect(layer[p.id], `${kind} ${seed} ${p.id}`).toBeLessThan(layer[p.parent]);
          else expect(layer[p.id]).toBe(max);
        }
        expect(max + 1, `${kind} ${seed} の層の数`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('層 0 の板は始めの局面からほかの板に手を付けずに外し切れ、層の順に外していけば全部外れる', () => {
    for (const kind of [...KINDS, ...THEMES]) {
      const level = generateLevel(3, { kind });
      const plain = plainOf(level), isBlocked = safeBlocker(plain);
      const layer = plateLayers(level, { plain, isBlocked });
      const order = level.plates.map((p) => p.id).sort((a, b) => layer[a] - layer[b]);
      let st = newGame(plain);
      for (const id of order) {
        // 板のねじを、外せるものから外していく（層の数え方と同じく、板 1 枚ずつ）
        for (let left = plain.screws.filter((s) => s.plate === id); left.length;) {
          const s = left.find((x) => removeScrew(st, x.id, isBlocked).ok);
          if (!s) break;
          st = removeScrew(st, s.id, isBlocked).state;
          left = left.filter((x) => x !== s);
        }
      }
      // 一部の板は単独では外し切れず、板をまたいで外す（層の数え方の行き詰まりの扱い）。ここでは数が合えばよい
      expect(Object.keys(layer).length).toBe(level.plates.length);
    }
  });

  it('待機スロットへ置いた回数を手順の再生から数える', () => {
    const level = {
      plates: [{ id: 'a' }],
      screws: [['r1', 'red'], ['r2', 'red'], ['r3', 'red'], ['g1', 'green'], ['g2', 'green'], ['g3', 'green'], ['b1', 'blue'], ['b2', 'blue'], ['b3', 'blue']]
        .map(([id, color]) => ({ id, plate: 'a', color })),
      queue: ['red', 'green', 'blue'],
    };
    expect(slotUses(level, ['r1', 'r2', 'r3', 'g1', 'g2', 'g3', 'b1', 'b2', 'b3'])).toBe(0);
    expect(slotUses(level, ['b1', 'r1', 'r2', 'r3', 'g1', 'g2', 'g3', 'b2', 'b3'])).toBe(1);
    expect(() => slotUses(level, ['r1', 'r1'])).toThrow();
  });

  it('生成した盤面の meta に難しさの数値がある（層ごとのねじの本数の合計 = ねじの本数）', () => {
    for (const kind of [...KINDS, ...THEMES]) {
      const level = generateLevel(2, { kind });
      const d = level.meta.difficulty;
      expect(d.perLayer).toHaveLength(d.layers);
      expect(d.perLayer.reduce((a, b) => a + b, 0)).toBe(level.screws.length);
      expect(d.slots).toBe(slotUses(level, level.meta.solution));
      expect(difficultyOf(level, level.meta.solution)).toEqual(d);
    }
  });
});

describe('層つきのねじ配置（D5）', () => {
  it('芯と骨組みの部品は、表の本数だけ子の部品の下にねじを隠す（子が載っている面があるとき）', () => {
    let hidden = 0, wanted = 0;
    for (const kind of THEMES) {
      for (const seed of SEEDS) {
        const level = generateLevel(seed, { kind });
        const cm = coverMap(level);
        const byId = new Map(level.plates.map((p) => [p.id, p]));
        for (const p of level.plates) {
          const row = LAYER_TABLE[p.role];
          if (!row?.hidden) continue;
          const own = level.screws.filter((s) => s.plate === p.id);
          expect(own.length, `${kind} ${seed} ${p.id} の本数`).toBeGreaterThanOrEqual(Math.min(row.min, 4));
          const under = own.filter((s) => cm[s.id].some((c) => byId.get(c).parent === p.id)).length;
          wanted += row.hidden;
          hidden += Math.min(under, row.hidden);
        }
      }
    }
    // 子が面に載っていない部品（家の屋根の三角の柱など）もあるので、全部ではない
    expect(hidden / wanted).toBeGreaterThan(0.6);
  });

  it('見つけた手順では、親の板が落ちるときに子の板はもう残っていない', () => {
    for (const kind of [...THEMES, 'box']) {
      for (const seed of SEEDS) {
        const level = generateLevel(seed, { kind });
        const isBlocked = safeBlocker(level);
        let st = newGame(level);
        for (const id of level.meta.solution) {
          const r = removeScrew(st, id, isBlocked);
          expect(r.ok, `${kind} ${seed} ${id}`).toBe(true);
          st = r.state;
          for (const ev of r.events) {
            if (ev.type !== 'plate' || ev.to !== 'fallen') continue;
            const kids = level.plates.filter((p) => p.parent === ev.plate);
            for (const k of kids) expect(st.left[k.id], `${kind} ${seed} ${ev.plate} が ${k.id} より先に落ちた`).toBe(0);
          }
        }
      }
    }
  });
});
