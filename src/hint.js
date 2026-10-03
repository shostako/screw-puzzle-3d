// ヒント: 今の局面から解ける手順を探し、その最初の手（外すねじ）を返す。描画にも DOM にも依存しない。
// 探索は生成器と同じ solve（src/solve.js）を途中の局面から呼び、隠れ判定は安全側の見積もり safeBlocker（src/safe.js）。
// 見積もりは物理より厳しいので、返す手順は「板を外したら立体を傾けて落とし切る」遊び方で実際にも外せる。
//
// 返り値: { screw: 最初に外すねじの id, path: 残りの手順 }
//       | { screw: null, reason: 'over'（クリアか詰みの後）| 'none'（解ける手順が無い）| 'budget'（探しきれなかった） }

import { solve } from './solve.js';
import { isCleared, checkRemove, removeScrew } from './rules.js';

export const HINT_BUDGET = 20000;   // 調べる局面の数の上限（生成器の 3 倍ほど。途中の局面は手順が短いので、ふつうはずっと少なく済む）
const PREFER_TRIES = 8;             // prefer のねじを最初の手にして試す本数の上限

// prefer に今画面で見えているねじを渡すと、その中から最初の手を選べればそちらを返す（回して探させずに済む）
export function findHint(level, state, isBlocked, { budget = HINT_BUDGET, prefer = [] } = {}) {
  if (isCleared(state)) return { screw: null, reason: 'over' };
  const path = solve(level, isBlocked, { budget, from: state });
  if (path === null) return { screw: null, reason: 'budget' };
  if (!path || !path.length) return { screw: null, reason: 'none' };
  if (!prefer.includes(path[0])) {
    const tries = prefer.filter((id) => checkRemove(state, id, isBlocked) === 'ok').slice(0, PREFER_TRIES);
    for (const id of tries) {
      const rest = solve(level, isBlocked, { budget: budget / 4, from: removeScrew(state, id, isBlocked).state });
      if (rest) return { screw: id, path: [id, ...rest] };
    }
  }
  return { screw: path[0], path };
}
