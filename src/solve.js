// クリアまでの手順を1つ探す（M6）。全部の局面を数えるのではなく、深さ優先で1つ見つけたら終わる。
// ルールは rules.js をそのまま使い、隠れ判定は外から渡す（生成器は safe.js の安全側の見積もりを渡す）。
//
// 枝刈り（2D 版の solveFull と同じ考え方）:
//   ・ねじが3本以上残っている板のねじを、合う箱へ入れる手は先に打つ（分岐させない）。板は固定のままで隠し方も変わらず、
//     いずれ外すねじを空いている箱へ入れるだけなので、打って損をしない。入れ替えただけの同じ手順を何通りも調べずに済む。
//   ・待機スロットへ置く手は、次に出る箱で早く要る色から3色、各色2本まで。
//   ・行き止まりと分かった局面は覚えておき、2度調べない。
// from に途中の局面（rules.js の状態）を渡すと、そこからの残りの手順を探す（ヒント）。省略すると始めの局面から。
// 返り値: 外す順番（ねじの id の配列）/ false（手順が無い）/ null（調べる局面の数 budget を超えて打ち切り）
// from を渡すと、その途中の局面から探す（戻る先を探すため）。省略すると始めの局面から

import { newGame, removeScrew, legalMoves, checkRemove, isCleared, openBoxFor, heldBy } from './rules.js';

export function solve(level, isBlocked, { budget = 5000, from = null } = {}) {
  const colorOf = new Map(level.screws.map((s) => [s.id, s.color]));
  const plateOf = new Map(level.screws.map((s) => [s.id, s.plate]));
  const dead = new Set();
  let nodes = 0;

  const keyOf = (st) => {
    let k = '';
    for (const s of level.screws) k += st.where[s.id] === 'board' ? '1' : '0';
    return k + '|' + st.slots.join(',') + '|' + st.boxes.map((b) => b && `${b.order}.${b.n}`).join(',');
  };
  // 次に出る箱の中で、その色が何番目に要るか
  const need = (st, c) => {
    for (let k = st.nextBox; k < level.queue.length; k++) if (level.queue[k] === c) return k - st.nextBox;
    return Infinity;
  };

  function forced(st, path) {
    for (;;) {
      // 安い条件を先に見て、隠れ判定は最後に呼ぶ
      const s = level.screws.find((x) => st.where[x.id] === 'board' && st.left[x.plate] >= 3 &&
        openBoxFor(st, x.color) >= 0 && checkRemove(st, x.id, isBlocked) === 'ok');
      if (!s) return st;
      const id = s.id;
      st = removeScrew(st, id, isBlocked).state;
      path.push(id);
    }
  }

  function dfs(st0, path0) {
    const path = path0.slice();
    const st = forced(st0, path);
    if (isCleared(st)) return path;
    if (++nodes > budget) return null;
    const key = keyOf(st);
    if (dead.has(key)) return false;
    const legal = legalMoves(st, isBlocked);
    // 箱へ入れる手を先に。中でも板を外し切る手（残り1本）を先に、板をぶら下げる手（残り2本）を後に試す。
    // ぶら下がった板は届く範囲全部を隠すとみなすので、増やさないほうが先へ進みやすい。
    // 子の部品が残っている板（D5: 子を外すまで落とせない）をぶら下げる手は一番後に（長くぶら下がったまま周りを隠し続けるため）
    const rank = (id) => {
      const p = plateOf.get(id);
      return st.left[p] === 1 ? 0 : heldBy(st, p).length ? 2 : 1;
    };
    const moves = legal.filter((id) => openBoxFor(st, colorOf.get(id)) >= 0).sort((a, b) => rank(a) - rank(b));
    if (st.slots.includes(null)) {
      const byColor = new Map();
      for (const id of legal) {
        const c = colorOf.get(id);
        if (openBoxFor(st, c) >= 0) continue;
        if (!byColor.has(c)) byColor.set(c, []);
        if (byColor.get(c).length < 2) byColor.get(c).push(id);
      }
      [...byColor.entries()].sort((a, b) => need(st, a[0]) - need(st, b[0])).slice(0, 3).forEach((e) => moves.push(...e[1]));
    }
    for (const id of moves) {
      const r = dfs(removeScrew(st, id, isBlocked).state, [...path, id]);
      if (r) return r;
      if (r === null) return null;
    }
    dead.add(key);
    return false;
  }

  return dfs(from ?? newGame(level), []);
}

