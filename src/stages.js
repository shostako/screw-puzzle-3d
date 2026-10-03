// ステージの進行（M7）。ステージ番号から生成器の設定を決め、盤面を作る。同じ番号なら同じ盤面。
//
// 難しさの並び:
//   1     閉じた小さな箱。札も中の板も無く、ねじは板ごとに 2 本、2 色。箱の色は交互で、出ている 2 箱がいつも違う色なので、
//         どの順に外しても詰まない。見えている面のねじを外し終えると、残りは裏や底にあるので、回して探すことを覚える。
//   2〜3  閉じた箱に札が載る。札の下のねじは、札を外すまで外せない（外すと見える）。
//   4     閉じた箱の中に仕切りか棚板がある。外の板を外すと、中のねじが出てくる。
//   5〜6  本棚と机（形が変わる）。
//   7〜   形は家具 3 種類と題材 3 種類（D4: 車・家・ぶた）を交互に回し、色・札・ねじの数・色の混ぜ方を少しずつ増やす。
//         題材は札を載せない（窓やぶちなどの飾りの部品が札の代わり）。
// 設定の形は generator.js の generateLevel の opts。want は盤面が満たすべき条件で、満たすまでシードを変えて作り直す。

import { generateLevel } from './generator.js';
import { blockerFor } from './board.js';
import { newGame } from './rules.js';

// 盤面を最初に見せる向き（three.js の Euler、XYZ）。斜め上から見て立体だと分かるように
export const START_VIEW = [0.45, -0.6, 0];

const plateCount = (level, prefix) => level.plates.filter((p) => p.id.startsWith(prefix)).length;
const screwRange = (lo, hi) => (level) => level.screws.length >= lo && level.screws.length <= hi;

// 始めに他の板に隠れているねじの数
export function hiddenAtStart(level) {
  const st = newGame(level), b = blockerFor(level);
  return level.screws.filter((s) => b(s.id, st)).length;
}

// 7 から先の形の回し方。家具と題材を交互に（8 で最初の題材の車が出る）
export const ROTATION = ['box', 'car', 'shelf', 'house', 'table', 'animal'];
// ねじの数の下限の頭打ち。机（18）と家（21）は部品が少なく、多いねじを置きにくい
const SCREW_CAP = { table: 18, house: 21 };

const INTRO = [
  { kind: 'box', open: false, inner: false, labels: 0, colors: 2, maxPer: 2, win: 1, noise: 0, alternate: true,
    want: screwRange(12, 12) },
  { kind: 'box', open: false, inner: false, labels: 1, colors: 2, maxPer: 3, win: 2, noise: 1,
    want: (l) => screwRange(12, 15)(l) && plateCount(l, 'label') === 1 && hiddenAtStart(l) >= 1 },
  { kind: 'box', open: false, inner: false, labels: 2, colors: 3, maxPer: 3, win: 3, noise: 1,
    want: (l) => screwRange(15, 18)(l) && plateCount(l, 'label') === 2 && hiddenAtStart(l) >= 2 },
  { kind: 'box', open: false, labels: 1, colors: 3, maxPer: 3, win: 3, noise: 2,
    want: (l) => screwRange(15, 21)(l) && (plateCount(l, 'shelf') + plateCount(l, 'wall')) >= 1 },
  { kind: 'shelf', labels: 1, colors: 3, maxPer: 3, win: 4, noise: 2, want: screwRange(15, 21) },
  { kind: 'table', labels: 1, colors: 3, maxPer: 3, win: 4, noise: 2, want: screwRange(15, 21) },
];

// ステージ番号（1 から）の生成の設定
export function stageConfig(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`ステージ番号が正しくない: ${n}`);
  if (n <= INTRO.length) return { ...INTRO[n - 1] };
  const k = n - INTRO.length - 1;   // 7 で 0
  const kind = ROTATION[k % ROTATION.length];
  const colors = Math.min(6, 4 + Math.floor(k / 8));        // 7〜14: 4 色、15〜22: 5 色、23〜: 6 色
  const labels = Math.min(4, 2 + Math.floor(k / 12));       // 7〜18: 2 枚、19〜30: 3 枚、31〜: 4 枚
  const win = Math.min(9, 4 + Math.floor(k / 4));           // 色の混ぜ方は 4 ステージごとに強める
  const noise = Math.min(6, 2 + Math.floor(k / 6));
  // ねじの数の下限は 3 ステージごとに 3 本ずつ。頭打ちは SCREW_CAP（無ければ 24 本）
  const lo = Math.min(SCREW_CAP[kind] ?? 24, 15 + Math.floor(k / 3) * 3);
  return { kind, labels, colors, win, noise, want: screwRange(lo, Infinity) };
}

const SEED_TRIES = 40;

// ステージ番号の盤面。条件を満たすまでシードを n * 1000 + 0, 1, 2 … と変える。
// meta に stage と、使ったシードを持つ（?seed= で同じ盤面を開ける）
export function stageLevel(n) {
  const { want, ...opts } = stageConfig(n);
  let last = null;
  for (let t = 0; t < SEED_TRIES; t++) {
    const seed = n * 1000 + t;
    let level;
    try {
      level = generateLevel(seed, opts);
    } catch {
      continue;
    }
    last = level;
    if (!want || want(level)) return { ...level, meta: { ...level.meta, stage: n, opts } };
  }
  // 条件に合う盤面が見つからなければ、最後に作れたものを使う（どれも解ける）
  if (last) return { ...last, meta: { ...last.meta, stage: n, opts } };
  throw new Error(`ステージ ${n} の盤面を作れなかった`);
}
