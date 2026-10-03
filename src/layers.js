// 層と難しさの数値（D5）。描画にも物理にも依存しない。
//
// 層: 「その板を外し切るまでに、先に外し切る板が何段あるか」。始めの局面から、ほかの板に手を付けずに
//   外し切れる板を層 0 とし、層 0 を全部外した局面で外し切れる板を層 1 … と皮をむくように数える。
//   外せるかは解ける保証と同じ安全側の見積もり（safe.js の safeBlocker）とルールの親子の決まり（rules.js の 'held'）で決め、
//   箱の色は見ない（1色だけの盤面として数える）。部品の木の題材では、だいたい 0 装飾・1 外板・2 骨組み・3 芯 に当たる
//   （板の role はその目安。数えた層とは一致しないことがある）。
// 難しさ: 層の数、始めに隠れているねじの数、見つけた手順で待機スロットへ置いた回数。ステージの条件（stages.js）で使う。

import { safeBlocker } from './safe.js';
import { newGame, removeScrew, checkRemove } from './rules.js';

// 色を 1 色にした盤面（箱の順番を気にせず、外せる順番だけを調べる）
export function plainOf(level) {
  return {
    ...level,
    screws: level.screws.map((s) => ({ ...s, color: 'x' })),
    queue: new Array(level.screws.length / 3).fill('x'),
  };
}

// 板 plate のねじを全部外せる順番があれば、外し切った後の状態（無ければ null）。板 1 枚のねじは数本なので総当たり
function peel(st, plate, isBlocked) {
  const ids = st.level.screws.filter((s) => s.plate === plate && st.where[s.id] === 'board').map((s) => s.id);
  if (!ids.length) return st;
  for (const id of ids) {
    if (checkRemove(st, id, isBlocked) !== 'ok') continue;
    const done = peel(removeScrew(st, id, isBlocked).state, plate, isBlocked);
    if (done) return done;
  }
  return null;
}

// 板ごとの層 { 板の id: 層 }。plain は 1 色の盤面（省略すると level から作る）
export function plateLayers(level, { plain = plainOf(level), isBlocked = safeBlocker(plain) } = {}) {
  const layer = {};
  let st = newGame(plain);
  let rest = plain.plates.map((p) => p.id);
  for (let round = 0; rest.length; round++) {
    // この段で外し切れる板（段の始めの局面から 1 枚ずつ調べる）
    const now = rest.filter((id) => peel(st, id, isBlocked));
    if (!now.length) {
      // どの板も単独では外し切れない（互いに隠し合っていて、両方をぶら下げてから外すなど）。外せるねじを外して進める
      const ids = plain.screws.filter((s) => checkRemove(st, s.id, isBlocked) === 'ok').map((s) => s.id);
      if (!ids.length) { for (const id of rest) layer[id] = round; break; }
      st = removeScrew(st, ids[0], isBlocked).state;
      round--;
      continue;
    }
    for (const id of now) {
      layer[id] = round;
      st = peel(st, id, isBlocked) ?? st;   // 先に外した板で道が開くことはあっても、閉じることはない
    }
    rest = rest.filter((id) => !(id in layer));
  }
  return layer;
}

// 手順を再生して、待機スロットへ置いた回数
export function slotUses(level, path) {
  let st = newGame(level), n = 0;
  for (const id of path) {
    const r = removeScrew(st, id);
    if (!r.ok) throw new Error(`手順のねじ ${id} を外せない（${r.reason}）`);
    n += r.events.filter((e) => e.type === 'toSlot').length;
    st = r.state;
  }
  return n;
}

// 難しさの数値: { layers: 層の数, perLayer: [層ごとのねじの本数], slots: 待機スロットへ置いた回数 }
export function difficultyOf(level, path, opts) {
  const layer = plateLayers(level, opts);
  const layers = Math.max(...Object.values(layer)) + 1;
  const perLayer = new Array(layers).fill(0);
  for (const s of level.screws) perLayer[layer[s.plate]]++;
  return { layers, perLayer, slots: path ? slotUses(level, path) : null };
}
