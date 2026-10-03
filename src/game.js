// 1局の進行と、画面上の箱・待機スロットの表示の形。描画にも DOM にも依存しない。
// ルール（rules.js）と隠れ判定（board.js）をつなぎ、タップされたねじを外す。

import { newGame, removeScrew, status, screwById, legalMoves, SLOT_COUNT } from './rules.js';
import { blockerFor } from './board.js';
import { safeBlocker } from './safe.js';
import { findHint } from './hint.js';

// 1局。tap(id) は { reason, events, status } を返す。
//   reason: 'ok' | 'blocked'（隠れている）| 'full'（入れる所が無い）| 'gone' | 'over'（クリアか詰みの後）
// isBlocked はタップしたねじを外せるかの判定（物理があれば今の姿勢で調べる physics.blocker()）。
// stuckBlocker は詰みを決める判定。物理で動く板がある間は、回せば外せるようになるかもしれないので、
// 動かない板だけで判定する楽観的なもの（board.js の fixedBlocker）を渡す。省略すると isBlocked と同じ。
// hint(prefer) は今の局面から解ける手順の最初のねじを返し（hint.js の findHint）、使った回数 hints を数える（クリアの評価で使う）。
// prefer（画面で見えているねじ）から選べればそちらを優先する。探索の隠れ判定は安全側の見積もり（safe.js）。初めて使うときに作る
export function createGame(level, isBlocked = blockerFor(level), stuckBlocker = isBlocked) {
  let state = newGame(level);
  let current = status(state, stuckBlocker);
  let hints = 0;
  let safe = null;
  return {
    get state() { return state; },
    get status() { return current; },
    get hints() { return hints; },
    tap(id) {
      if (current !== 'playing') return { reason: 'over', events: [], status: current };
      const r = removeScrew(state, id, isBlocked);
      if (r.ok) {
        state = r.state;
        current = status(state, stuckBlocker);
      }
      return { reason: r.reason, events: r.events, status: current };
    },
    // 今外せるねじの id
    legal() { return legalMoves(state, isBlocked); },
    hint(prefer = []) {
      if (current !== 'playing') return { screw: null, reason: 'over' };
      safe ??= safeBlocker(level);
      const r = findHint(level, state, safe, { prefer });
      if (r.screw) hints++;
      return r;
    },
    restart() {
      state = newGame(level);
      hints = 0;
      current = status(state, stuckBlocker);
    },
  };
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
