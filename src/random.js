// ランダムの盤面（D6）。「おまかせ」（ランダムな番号で1問）と「今日の1問」（日付で決まる1問）。
// 難しさは 3 段（やさしい・ふつう・むずかしい）で、それぞれステージの帯の設定（stageConfig）をそのまま借りる。
// 形（家具 3 種と題材 3 種）は番号から決まる乱数で選び、その形の帯の中のステージの設定で作る。
// こうすると、ステージと同じ条件（ねじの数の範囲・層 2 段以上・待機スロットの回数）で難しさがそろい、
// 解ける保証（生成器が手順を見つけた盤面しか返さない）も、親子のルール（held）もステージと同じに守られる。
// 同じ番号と難しさなら同じ盤面（Math.random は使わない。番号を選ぶときだけ画面側が使う）。

import { mulberry32 } from './generator.js';
import { stageConfig, pickLevel, ROTATION } from './stages.js';

// 難しさの段と、借りるステージの帯の始まり（7, 13, 19 … は ROTATION の頭がそろう番号）
export const DIFFICULTIES = {
  easy: { label: 'やさしい', band: 7 },     // 4 色・札 2 枚・ねじ 15〜21 本・層 2 段以上
  normal: { label: 'ふつう', band: 19 },    // 5 色・札 3 枚・ねじ 18〜30 本
  hard: { label: 'むずかしい', band: 37 },  // 6 色・札 4 枚・ねじ 24〜30 本・待機スロット 2 回を「なるべく」
};
export const DIFFICULTY_IDS = Object.keys(DIFFICULTIES);
// 今日の1問の難しさ
export const DAILY_DIFFICULTY = 'normal';

// おまかせの番号の範囲（画面に「#番号」で出し、?random=番号 で同じ盤面を開ける）
export const MAX_RANDOM = 999999;
// 生成器に渡すシード。ステージ（n * 1000 + t）と重ならない所から、番号ごとに SEED_STRIDE 個ずつ
const RANDOM_BASE = 100_000_000;
const SEED_STRIDE = 50;
// 今日の1問の番号は DAILY_BASE + 2000-01-01 からの日数（おまかせの番号とは重ならない）
const DAILY_BASE = MAX_RANDOM + 1;

export const isRandomNo = (no) => Number.isInteger(no) && no >= 1 && no <= MAX_RANDOM;

// おまかせの番号と難しさの設定。形は番号の乱数で選ぶ
export function randomConfig(no, difficulty) {
  const d = DIFFICULTIES[difficulty];
  if (!d) throw new Error(`難しさが正しくない: ${difficulty}`);
  const k = Math.floor(mulberry32(no * 2654435761 + 97)() * ROTATION.length);
  return stageConfig(d.band + k);
}

// おまかせの盤面。meta に random: { no, difficulty } を持つ
export function randomLevel(no, difficulty = 'normal') {
  if (!Number.isInteger(no) || no < 1) throw new Error(`番号が正しくない: ${no}`);
  return pickLevel(randomConfig(no, difficulty), (t) => RANDOM_BASE + no * SEED_STRIDE + t, { random: { no, difficulty } });
}

// 端末の日付（年・月・日）を「20261003」の形の数に
export const dateKey = (date) => date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();

// 「20261003」から 2000-01-01 からの日数
export function dayIndex(key) {
  const y = Math.floor(key / 10000), m = Math.floor(key / 100) % 100, d = key % 100;
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2000, 0, 1)) / 86400000);
}

export const isDateKey = (key) => {
  if (!Number.isInteger(key) || key < 20000101 || key > 99991231) return false;
  const y = Math.floor(key / 10000), m = Math.floor(key / 100) % 100, d = key % 100;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

// 今日の1問（日付ごとに 1 問。どの端末でも同じ日付なら同じ盤面）。meta に daily: 日付の数 を持つ
export function dailyLevel(key) {
  if (!isDateKey(key)) throw new Error(`日付が正しくない: ${key}`);
  const level = randomLevel(DAILY_BASE + dayIndex(key), DAILY_DIFFICULTY);
  return { ...level, meta: { ...level.meta, daily: key } };
}

// 「10月3日」
export const dateLabel = (key) => `${Math.floor(key / 100) % 100}月${key % 100}日`;

// 自己ベストを覚えるときの名前（ステージは番号のまま。今日の1問は日付ごと）
export const dailyBestKey = (key) => `daily-${key}`;
