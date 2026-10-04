// ステージの進行（M7）。ステージ番号から生成器の設定を決め、盤面を作る。同じ番号なら同じ盤面。
//
// 難しさの並び:
//   1     閉じた小さな箱。札も中の板も無く、ねじは板ごとに 2 本、2 色。箱の色は交互で、出ている 2 箱がいつも違う色なので、
//         どの順に外しても詰まない。見えている面のねじを外し終えると、残りは裏や底にあるので、回して探すことを覚える。
//   2〜3  閉じた箱に札が載る。札の下のねじは、札を外すまで外せない（外すと見える）。
//   4     閉じた箱の中に仕切りか棚板がある。外の板を外すと、中のねじが出てくる。
//   5〜6  本棚と机（形が変わる）。
//   7〜   E8 から 10 ステージで 1 章（CHAPTERS）。章ごとに題材の組（家具 3 種と E7 までの題材 9 種から）と空の色の名前を決める。
//         難しさは「のこぎりの歯」: 章の中で段（stageStep）が上がり、次の章の頭で少し下がる。段から色・札・色の混ぜ方・
//         ねじの本数・待機スロットの回数を決める（curveConfig）。章の 10 番目は大物（色を 1 つ足し、ねじの下限をその形のいちばん多い所に、
//         待機スロットを 1 回多く、何枚か作った中でいちばん重い盤面）。ねじの本数は形の部品の数で決まる幅（SCREWS）に収める。
//         題材は札を載せない（窓やぶちなどの飾りの部品が札の代わり）。
//         D5 から、難しさの数値（layers.js、盤面の meta.difficulty）も条件に入れる: 層は 2 段以上（ねじが全部見えている
//         平たい盤面を避ける）。待機スロットの回数は「なるべく」の条件（prefer）で、PREFER_TRIES 個の
//         シードで見つからなければ、ほかの条件だけで選ぶ（ぶたは手順に待機スロットが要らない割り当てになりやすく、待つと作る時間が延びるため）。
//         章の大物は、条件に合う盤面を FINALE_PICKS 個作って、いちばん重いもの（weightOf）を選ぶ。
//         曲線の表は scripts/curve.mjs で出す。
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
const INTRO_LENGTH = INTRO.length;

// 章（E8）。10 ステージで 1 章。章ごとに題材の組と空の名前（sky、E2 の theme.js の skies で色を引く）を持つ。
// kinds は章の 1〜10 番目の形。家具（箱・本棚・机）は息抜きに混ぜ、10 番目は章の大物（色を 1 つ多く、ねじと待機スロットを増やす）。
// 大物にはねじが多く置ける形（ロボット・車・箱・ぶた）を置く。家は 21 本を超えにくく、機関車は作るのが遅いので大物にしない。
// 1 章の 1〜6 は導入（INTRO）なので、kinds の 1〜6 は使わない（7〜10 は M7 からの箱・車・本棚・家のまま）。
// 7 章から先は 2〜6 章の題材の組を回し、難しさは 6 章と同じ山（のこぎりの歯の上端）を繰り返す。
export const CHAPTERS = [
  { title: 'はじめての工作', sky: 'ch1', kinds: ['box', 'box', 'box', 'box', 'shelf', 'table', 'box', 'car', 'shelf', 'house'] },
  { title: 'どうぶつとロボット', sky: 'ch2', kinds: ['table', 'robot', 'animal', 'box', 'car', 'shelf', 'animal', 'car', 'animal', 'robot'] },
  { title: '空と海', sky: 'ch3', kinds: ['shelf', 'plane', 'ship', 'table', 'plane', 'house', 'ship', 'plane', 'ship', 'box'] },
  { title: 'しゅっぱつ進行', sky: 'ch4', kinds: ['table', 'rocket', 'train', 'box', 'rocket', 'shelf', 'car', 'train', 'rocket', 'car'] },
  { title: 'カメラとどうぶつ', sky: 'ch5', kinds: ['shelf', 'camera', 'animal', 'table', 'plane', 'camera', 'house', 'camera', 'plane', 'animal'] },
  { title: 'おもちゃ箱ぜんぶ', sky: 'ch6', kinds: ['table', 'ship', 'rocket', 'camera', 'box', 'shelf', 'plane', 'car', 'train', 'robot'] },
];
export const CHAPTER_SIZE = 10;
// 7 章から先に回す章（2〜6 章の組）
const REPEAT_FROM = 1;

// ステージ番号の章: { no: 章の番号（1 から）, first, last（章のステージの範囲）, pos（章の中の何番目か、1〜10）, title, sky, kinds }
export function chapterOf(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`ステージ番号が正しくない: ${n}`);
  const no = Math.floor((n - 1) / CHAPTER_SIZE) + 1;
  const i = no <= CHAPTERS.length ? no - 1 : REPEAT_FROM + (no - 1 - REPEAT_FROM) % (CHAPTERS.length - REPEAT_FROM);
  const first = (no - 1) * CHAPTER_SIZE + 1;
  return { no, first, last: first + CHAPTER_SIZE - 1, pos: n - first + 1, ...CHAPTERS[i] };
}

// 難しさの段（0 から。curveConfig に渡す）。のこぎりの歯: 章の中で上がり、次の章の頭で少し下がる。
// 章の中の山の形（1〜10 番目）。6 番目は息抜き、10 番目は大物
const RAMP = [0, 1, 1, 2, 3, 1, 3, 4, 4, 5];
// 1 章の 7〜10（導入の直後なので緩く）
const FIRST_RAMP = { 7: 0, 8: 1, 9: 1, 10: 2 };
// 章の土台は 2 段ずつ上げ、MAX_LEVEL で頭打ち（そこから先の章も同じ山を繰り返す）
export const MAX_LEVEL = 14;
export function stageStep(n) {
  const ch = chapterOf(n);
  if (ch.no === 1) return FIRST_RAMP[n] ?? 0;
  const base = Math.min(2 * ch.no - 3, MAX_LEVEL - RAMP[CHAPTER_SIZE - 1]);
  return base + RAMP[ch.pos - 1];
}
// 章の大物（10 番目）か
export const isFinale = (n) => n > INTRO_LENGTH && chapterOf(n).pos === CHAPTER_SIZE;

// 形ごとのねじの本数の下限の範囲 [いちばん少なく, いちばん多く]。部品の数で置けるねじが決まるので、
// 難しさから決めた下限をこの範囲に収める（上限は下限 + 6 本）。生成器で 30 シードずつ数えた本数の分布から
export const SCREWS = {
  box: [15, 27], shelf: [15, 24], table: [12, 18],
  car: [21, 24], house: [15, 21], animal: [21, 24], robot: [18, 24],
  plane: [15, 18], ship: [15, 18], rocket: [15, 18], train: [24, 27], camera: [12, 15],
};

// 形と難しさの段（と大物か）から生成の設定。ステージ（stageConfig）とおまかせ（random.js）が使う
export function curveConfig(kind, step, finale = false) {
  const s = Math.max(0, Math.min(MAX_LEVEL, step));
  const colors = Math.min(6, 4 + Math.floor(s / 4) + (finale ? 1 : 0));   // 0〜3: 4 色、4〜7: 5 色、8〜: 6 色
  const labels = Math.min(4, 2 + Math.floor(s / 5));                     // 札（家具だけ）
  const win = Math.min(9, 4 + Math.floor(s / 2));                        // 色の混ぜ方
  const noise = Math.min(6, 2 + Math.floor(s / 3));
  const [lo0, hi0] = SCREWS[kind] ?? [15, 24];
  // 大物はその形で置けるいちばん多い下限（hi0）
  const lo = finale ? hi0 : Math.max(lo0, Math.min(hi0, 15 + Math.floor(s / 3) * 3));
  const minLayers = 2;
  const minSlots = Math.min(2, (s >= 10 ? 2 : s >= 5 ? 1 : 0) + (finale && s >= 2 ? 1 : 0));
  const layered = (l) => l.meta.difficulty.layers >= minLayers;
  const want = (l) => screwRange(lo, lo + 6)(l) && layered(l);
  // 大物は条件に合う盤面を FINALE_PICKS 個作って、いちばん重いもの（待機スロット・層・ねじが多い）を選ぶ
  if (finale) return { kind, labels, colors, win, noise, minSlots, minLayers, want, best: FINALE_PICKS };
  const prefer = (l) => l.meta.difficulty.slots >= minSlots;
  return { kind, labels, colors, win, noise, minSlots, minLayers, want, prefer };
}

// ステージ番号（1 から）の生成の設定
export function stageConfig(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`ステージ番号が正しくない: ${n}`);
  if (n <= INTRO.length) return { ...INTRO[n - 1] };
  const ch = chapterOf(n);
  return curveConfig(ch.kinds[ch.pos - 1], stageStep(n), isFinale(n));
}

const SEED_TRIES = 40;
// 章の大物で比べる盤面の数
export const FINALE_PICKS = 3;

// 盤面の重さ（大物を選ぶときの目安）: 待機スロットを使う回数・層・ねじの本数
export const weightOf = (l) => 3 * l.meta.difficulty.slots + 2 * l.meta.difficulty.layers + l.screws.length / 3;
const PREFER_TRIES = 3;

// 設定 config（stageConfig の形）で盤面を1つ選ぶ。条件を満たすまでシードを seedAt(0), seedAt(1) … と変える。
// 待機スロットの条件（prefer）は PREFER_TRIES 個のシードで見つからなければ外す。meta に extra と opts を足す
// （D6 のおまかせ・今日の1問も同じ選び方を使う）
export function pickLevel(config, seedAt, extra = {}) {
  const { want, prefer, minLayers, best, ...opts } = config;
  const done = (level) => ({ ...level, meta: { ...level.meta, ...extra, opts } });
  let last = null, ok = null, top = null, found = 0;
  for (let t = 0; t < SEED_TRIES; t++) {
    let level;
    try {
      level = generateLevel(seedAt(t), opts);
    } catch {
      continue;
    }
    last = level;
    if (want && !want(level)) continue;
    // best（E8 の章の大物）: 条件に合う盤面を best 個まで作り、いちばん重いもの（weightOf）を選ぶ
    if (best) {
      if (!top || weightOf(level) > weightOf(top)) top = level;
      if (++found >= best) return done(top);
      continue;
    }
    if (!prefer || prefer(level)) return done(level);
    ok ??= level;
    if (t + 1 >= PREFER_TRIES) return done(ok);
  }
  // 条件に合う盤面が見つからなければ、最後に作れたものを使う（どれも解ける）
  if (top || ok || last) return done(top ?? ok ?? last);
  throw new Error('盤面を作れなかった');
}

// ステージ番号の盤面。シードは n * 1000 + 0, 1, 2 …。
// meta に stage・章の番号 chapter・空の名前 sky（E8）と、使ったシードを持つ（?seed= で同じ盤面を開ける）。
// variant（F「別の問題」）が 1 以上なら、同じ設定（形・段・条件）のまま別のシードで作った盤面。シードは
// n * 1000 + variant * SEED_TRIES + 0, 1, 2 …（そのステージの 1000 個の中で、ほかの variant と重ならない）。meta に variant を持つ
export const MAX_VARIANT = Math.floor(1000 / SEED_TRIES) - 1;
export function stageLevel(n, variant = 0) {
  if (!Number.isInteger(variant) || variant < 0 || variant > MAX_VARIANT) throw new Error(`別の盤面の番号が正しくない: ${variant}`);
  try {
    const ch = chapterOf(n);
    const extra = { stage: n, chapter: ch.no, sky: ch.sky, ...(variant ? { variant } : {}) };
    return pickLevel(stageConfig(n), (t) => n * 1000 + variant * SEED_TRIES + t, extra);
  } catch {
    throw new Error(`ステージ ${n} の盤面を作れなかった`);
  }
}
// 次の別の盤面の番号（1〜MAX_VARIANT を回る。0 の元の盤面には戻らない）
export const nextVariant = (v = 0) => (v % MAX_VARIANT) + 1;
