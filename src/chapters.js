// 章ごとのステージ一覧と章の終わり（E9）。DOM にも three.js にも依存しない（テストする）。
// 新しい保存は作らない: 到達したステージ（progress.js）と自己ベストの星（rating.js の createBests）から毎回組み立てる。
// 一覧のための保存は足さないので、E10 までの記録はそのまま使え、記録を消せば一覧も最初に戻る。

import { chapterOf, CHAPTER_SIZE } from './stages.js';
import { MAX_STARS } from './rating.js';

// 形の名前（章の終わりのお披露目と一覧に出す）
export const KIND_NAMES = {
  box: '箱', shelf: '本棚', table: '机', car: '車', house: '家', animal: 'ぶた',
  robot: 'ロボット', plane: '飛行機', ship: '船', rocket: 'ロケット', train: '機関車', camera: 'カメラ',
};

const firstOf = (no) => (no - 1) * CHAPTER_SIZE + 1;
const unique = (list) => [...new Set(list)];

// 章 no で初めて出てくる形（前の章までに出ていない形）。7 章から先は組を回すので、初めての形は無い
export function newKinds(no) {
  const seen = new Set();
  for (let k = 1; k < no; k++) for (const kind of chapterOf(firstOf(k)).kinds) seen.add(kind);
  // 1 章の 1〜6 は導入の箱・本棚・机（stages.js の INTRO）。kinds の 1〜6 もその形なのでそのまま数えてよい
  return unique(chapterOf(firstOf(no)).kinds).filter((k) => !seen.has(k));
}

// 章 no の様子。reached は到達したステージ（progress.stage）、bests は createBests の形（get(n) が { stars } か null）。
// stages: 各ステージ { n, state: 'cleared'（クリア済み）| 'next'（次に遊ぶ）| 'locked'（まだ）, stars（自己ベストの星、無ければ 0） }
export function chapterView(no, reached, bests) {
  const ch = chapterOf(firstOf(no));
  const stages = [];
  for (let n = ch.first; n <= ch.last; n++) {
    const state = n < reached ? 'cleared' : n === reached ? 'next' : 'locked';
    stages.push({ n, state, stars: state === 'cleared' ? (bests?.get(n)?.stars ?? 0) : 0 });
  }
  const stars = stages.reduce((a, s) => a + s.stars, 0);
  const max = CHAPTER_SIZE * MAX_STARS;
  const done = ch.last < reached;
  return {
    no, title: ch.title, sky: ch.sky, first: ch.first, last: ch.last,
    kinds: unique(ch.kinds), fresh: newKinds(no),
    stages, stars, max,
    open: ch.first <= reached,   // 1 本でも遊べる
    done,                        // 全部クリアした
    perfect: done && stars === max,   // 全部 ★3（章の見出しに王冠）
  };
}

// 一覧に出す章: 1 章から到達した章まで（開いている章）と、その次の章を1つ（鍵のかかった予告）
export function chapterList(reached, bests) {
  const last = chapterOf(Math.max(1, reached)).no;
  return Array.from({ length: last + 1 }, (_, i) => chapterView(i + 1, reached, bests));
}

// 全部の章の星の合計（一覧の上に出す）
export function totalStars(reached, bests) {
  let sum = 0;
  for (let n = 1; n < reached; n++) sum += bests?.get(n)?.stars ?? 0;
  return sum;
}

// ステージ n をクリアして、その章を初めて終えたか。before はクリアする前の到達（progress.stage）。
// 遊び直し（before が n より先）では章の終わりの演出を出さない
export const finishesChapter = (n, before) => chapterOf(n).last === n && before <= n;
