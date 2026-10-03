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
//         D5 から、難しさの数値（layers.js、盤面の meta.difficulty）も条件に入れる: 層は 2 段以上（ねじが全部見えている
//         平たい盤面を避ける）、見つけた手順で待機スロットを使う回数の下限を 25 から 1 回、37 から 2 回。
//         待機スロットの回数は「なるべく」の条件（prefer）で、PREFER_TRIES 個のシードで見つからなければ、ほかの条件だけで選ぶ
//         （ぶたは手順に待機スロットが要らない割り当てになりやすく、待つと作る時間が延びるため）。
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
  // ねじの数の下限は 3 ステージごとに 3 本ずつ。頭打ちは SCREW_CAP（無ければ 24 本）。
  // 上限は下限 + 6 本（D5: 早いステージに後より多いねじの盤面が出ないように）
  const lo = Math.min(SCREW_CAP[kind] ?? 24, 15 + Math.floor(k / 3) * 3);
  const minLayers = 2;
  const minSlots = n >= 37 ? 2 : n >= 25 ? 1 : 0;
  const layered = (l) => l.meta.difficulty.layers >= minLayers;
  const prefer = (l) => l.meta.difficulty.slots >= minSlots;
  return { kind, labels, colors, win, noise, minSlots, minLayers, want: (l) => screwRange(lo, lo + 6)(l) && layered(l), prefer };
}

const SEED_TRIES = 40;
const PREFER_TRIES = 3;

// 設定 config（stageConfig の形）で盤面を1つ選ぶ。条件を満たすまでシードを seedAt(0), seedAt(1) … と変える。
// 待機スロットの条件（prefer）は PREFER_TRIES 個のシードで見つからなければ外す。meta に extra と opts を足す
// （D6 のおまかせ・今日の1問も同じ選び方を使う）
export function pickLevel(config, seedAt, extra = {}) {
  const { want, prefer, minLayers, ...opts } = config;
  const done = (level) => ({ ...level, meta: { ...level.meta, ...extra, opts } });
  let last = null, ok = null;
  for (let t = 0; t < SEED_TRIES; t++) {
    let level;
    try {
      level = generateLevel(seedAt(t), opts);
    } catch {
      continue;
    }
    last = level;
    if (want && !want(level)) continue;
    if (!prefer || prefer(level)) return done(level);
    ok ??= level;
    if (t + 1 >= PREFER_TRIES) return done(ok);
  }
  // 条件に合う盤面が見つからなければ、最後に作れたものを使う（どれも解ける）
  if (ok || last) return done(ok ?? last);
  throw new Error('盤面を作れなかった');
}

// ステージ番号の盤面。シードは n * 1000 + 0, 1, 2 …。
// meta に stage と、使ったシードを持つ（?seed= で同じ盤面を開ける）
export function stageLevel(n) {
  try {
    return pickLevel(stageConfig(n), (t) => n * 1000 + t, { stage: n });
  } catch {
    throw new Error(`ステージ ${n} の盤面を作れなかった`);
  }
}
