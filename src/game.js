// 1局の進行と、画面上の箱・待機スロットの表示の形。描画にも DOM にも依存しない。
// ルール（rules.js）と隠れ判定（board.js）をつなぎ、タップされたねじを外す。

import { newGame, removeScrew, status, screwById, legalMoves, SLOT_COUNT } from './rules.js';
import { blockerFor } from './board.js';
import { solve } from './solve.js';

// 1局。tap(id) は { reason, events, status } を返す。
//   reason: 'ok' | 'blocked'（隠れている）| 'full'（入れる所が無い）| 'gone' | 'over'（クリアか詰みの後）
// isBlocked はタップしたねじを外せるかの判定（物理があれば今の姿勢で調べる physics.blocker()）。
// stuckBlocker は詰みを決める判定。物理で動く板がある間は、回せば外せるようになるかもしれないので、
// 動かない板だけで判定する楽観的なもの（board.js の fixedBlocker）を渡す。省略すると isBlocked と同じ。
//
// 戻る: 外した手ごとに、外す直前の状態とねじを覚えている（history）。undo() で1手、rewind(k) で k 手目を外す直前へ戻す。
// クリアの後は戻せない。詰みからは戻せる。戻した回数は undos に数える（クリアの評価で使う）
export function createGame(level, isBlocked = blockerFor(level), stuckBlocker = isBlocked) {
  let state = newGame(level);
  let current = status(state, stuckBlocker);
  let history = [];   // [{ state: 外す直前の状態, screw: 外したねじ }]
  let undos = 0;
  const api = {
    get state() { return state; },
    get status() { return current; },
    // 外した手の数（戻せる手の数）
    get moves() { return history.length; },
    get history() { return history.map((h) => h.state); },
    // 外したねじの順番
    get path() { return history.map((h) => h.screw); },
    get undos() { return undos; },
    get canUndo() { return history.length > 0 && current !== 'cleared'; },
    tap(id) {
      if (current !== 'playing') return { reason: 'over', events: [], status: current };
      const r = removeScrew(state, id, isBlocked);
      if (r.ok) {
        history.push({ state, screw: id });
        state = r.state;
        current = status(state, stuckBlocker);
      }
      return { reason: r.reason, events: r.events, status: current };
    },
    // k 手目（0 から数える）を外す直前へ戻す。戻せたら true
    rewind(k) {
      if (!api.canUndo || !(k >= 0 && k < history.length)) return false;
      state = history[k].state;
      history = history.slice(0, k);
      current = status(state, stuckBlocker);
      undos++;
      return true;
    },
    undo() { return api.rewind(history.length - 1); },
    // 今外せるねじの id
    legal() { return legalMoves(state, isBlocked); },
    restart() {
      state = newGame(level);
      current = status(state, stuckBlocker);
      history = [];
      undos = 0;
    },
  };
  return api;
}

// 戻る先: 解ける手順が残っている一番新しい局面の番号（states[k]。states は始めから今までの局面）と、そこからの手順。
// 解けるかは安全側の隠れ判定 safe（safe.js の safeBlocker）で探すので、見つかった手順は物理でも外せる。
// 本当の分かれ目より手前になることがある。2D 版と同じく、最初の局面は解けるとみなし（生成のときに確かめてある）、
// 最後の局面（詰み）は解けないとみなして、その間を二分法で詰める（探索は数回で済む）。
// 打ち切り（budget）で答えが出なかった局面は解けないとみなす（戻る先が手前になるだけ）
export function rewindPoint(level, states, safe, { budget = 3000 } = {}) {
  const solvable = (k) => solve(level, safe, { budget, from: states[k] });
  let lo = 0, hi = states.length - 1;
  let path = null;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const p = solvable(mid);
    if (p) { lo = mid; path = p; }
    else hi = mid;
  }
  if (!path) path = solvable(lo) || null;
  return { k: lo, path };
}

// 画面の上に出す箱とスロットの形:
//   { boxes: [{ color, n } | null, ...], slots: [色 | null, ...], filled: 埋めた箱の数, total: 箱の総数 }
export function hudOf(st) {
  return {
    boxes: st.boxes.map(b => b && { color: b.color, n: b.n }),
    slots: st.slots.map(id => (id === null ? null : screwById(st, id).color)),
    filled: st.filled,
    total: st.level.queue.length,
  };
}

// removeScrew の出来事を1つずつ表示に当てる（演出で途中の様子を見せるため）。
// 外す前の hudOf から出来事を全部当てると、外した後の hudOf と同じになる。
export function applyEvent(hud, ev, level) {
  const color = id => level.screws.find(s => s.id === id).color;
  const boxes = hud.boxes.map(b => b && { ...b });
  const slots = hud.slots.slice();
  let filled = hud.filled;
  switch (ev.type) {
    case 'toBox': boxes[ev.box].n++; break;
    case 'toSlot': slots[ev.slot] = color(ev.screw); break;
    case 'slotToBox': slots[ev.slot] = null; boxes[ev.box].n++; break;
    case 'boxFull': boxes[ev.box] = null; filled++; break;
    case 'boxSpawn': boxes[ev.box] = { color: ev.color, n: 0 }; break;
    default: break;   // 'plate' は表示の箱・スロットに関係しない
  }
  return { boxes, slots, filled, total: hud.total };
}

export { SLOT_COUNT };
