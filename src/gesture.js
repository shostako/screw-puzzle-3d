// 指の動きを「タップ」「回す（ドラッグ）」「拡大・縮小（ピンチ）」に分ける。
// 描画にも DOM にも依存しない。座標は CSS ピクセル、時刻はミリ秒で渡す。

// 指が置いた位置からこれ以上動いたらタップではなくドラッグ
export const TAP_MAX_MOVE = 10;
// 置いてから離すまでがこれより長ければタップではない（長押しや迷った指）
export const TAP_MAX_MS = 350;
// ねじの上に置いた指（aim() で知らせる）は、押し込んだまま少し考えても、指の腹が少し転がってもタップのまま。
// ボタンと同じく「押したねじの上で離せば押したことになる」（F1。0.35 秒を超えると、沈んだねじが外れずに戻っていた）
export const AIM_MAX_MOVE = 18;

// 1回の操作（最初の指が触れてから全部の指が離れるまで）を追う。
// down/move/up/cancel はそれぞれ、起きた出来事の配列を返す:
//   { type: 'rotate', dx, dy }  1本指のドラッグ。前回からの移動量
//   { type: 'zoom', scale }     2本指の間隔の比（前回比。1 より大きければ広がった）
//   { type: 'tap', x, y }       タップと判定された。離した位置
// aim() は最初の指がねじの上に置かれたときに呼ぶ。その操作では時間の上限を外し、ぶれの許しを aimMaxMove に広げる
export function createGesture({ tapMaxMove = TAP_MAX_MOVE, tapMaxMs = TAP_MAX_MS, aimMaxMove = AIM_MAX_MOVE } = {}) {
  const pointers = new Map(); // id -> { x, y }
  let start = null; // 最初の指 { id, x, y, t }
  let tapPossible = false;
  let dragging = false;
  let aimed = false;
  let pinchDist = 0;

  function distance() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function down(id, x, y, t) {
    if (pointers.size === 0) {
      start = { id, x, y, t };
      tapPossible = true;
      dragging = false;
      aimed = false;
    } else {
      // 2本目の指が来たら、この操作はもうタップにならない
      tapPossible = false;
    }
    pointers.set(id, { x, y });
    if (pointers.size === 2) pinchDist = distance();
    return [];
  }

  function move(id, x, y, t) {
    const p = pointers.get(id);
    if (!p) return [];
    const prev = { x: p.x, y: p.y };
    p.x = x;
    p.y = y;

    if (pointers.size >= 2) {
      if (pointers.size !== 2) return [];
      const d = distance();
      const events = pinchDist > 0 && d > 0 ? [{ type: 'zoom', scale: d / pinchDist }] : [];
      pinchDist = d;
      return events;
    }

    if (!dragging) {
      const moved = Math.hypot(x - start.x, y - start.y);
      if (id === start.id && moved <= (aimed ? aimMaxMove : tapMaxMove)) return [];
      dragging = true;
      tapPossible = false;
      // しきい値までの分も回す（指の下の立体が遅れてついてこないように）
      if (id === start.id) return [{ type: 'rotate', dx: x - start.x, dy: y - start.y }];
    }
    return [{ type: 'rotate', dx: x - prev.x, dy: y - prev.y }];
  }

  function up(id, x, y, t) {
    if (!pointers.has(id)) return [];
    if (x !== undefined) move(id, x, y, t);
    pointers.delete(id);
    if (pointers.size === 1) {
      // ピンチから1本に戻った。残った指で続けて回せるが、タップにはしない
      dragging = true;
      return [];
    }
    if (pointers.size > 0) return [];
    const isTap = tapPossible && !dragging && id === start.id && (aimed || t - start.t <= tapMaxMs);
    start = null;
    return isTap ? [{ type: 'tap', x: x ?? 0, y: y ?? 0 }] : [];
  }

  function cancel(id) {
    pointers.delete(id);
    tapPossible = false;
    if (pointers.size === 0) start = null;
    return [];
  }

  // 最初の指がねじの上にある（1本指で、まだ動かしていないときだけ効く）
  function aim() {
    if (pointers.size === 1 && tapPossible && !dragging) aimed = true;
  }

  return { down, move, up, cancel, aim, get activePointers() { return pointers.size; } };
}
