// ゲームのルール。描画にも物理にも依存しない純粋なモジュール。
// 正本は 2D 版（shostako/screw-puzzle）の index.html と README の「現在のルール」。
//
// 盤面（level）: { plates: [{ id }], screws: [{ id, plate, color }], queue: [color, ...] }
//   queue は箱が出てくる順番の色。どの色も「ねじの本数 = 3 × 箱の数」でなければならない。
// 状態（state）は関数が返すたびに新しいオブジェクトになり、前の状態は書き換えない（戻るやヒントの探索で使い回せる）。
//
// 「ねじが外せるか（隠れていないか）」はここでは決めず、isBlocked(screwId, state) を外から渡す。
// 3D の隠れ判定は M3、板の姿勢による判定は M5 で入れる。渡さなければ、どのねじも隠れていないとみなす。
//
// 部品の親子（D5）: 板が parent（親の板の id）を持つとき、子の板がまだ残っている（ねじが1本でも盤面にある）間は、
// 親の板の最後のねじは外せない（'held'）。子は親にくっついているので、子が付いたままの親は落ちない。
// こうしないと、親を先に外したときに子の部品が宙に浮いて残る（D4 で分かったこと）。parent が無い盤面は今までどおり。

export const ACTIVE_BOXES = 2;   // 同時に出ている箱の数
export const SLOT_COUNT = 5;     // 待機スロットの数
export const BOX_SIZE = 3;       // 箱が満杯になる本数

const notBlocked = () => false;

// 板の状態: ねじ2本以上で固定、1本でぶら下がり、0本で落下
export function plateStateOf(count) {
  return count >= 2 ? 'fixed' : count === 1 ? 'hanging' : 'fallen';
}

export function validateLevel(level) {
  const plateIds = new Set();
  for (const p of level.plates) {
    if (plateIds.has(p.id)) throw new Error(`板の id が重複している: ${p.id}`);
    plateIds.add(p.id);
  }
  for (const p of level.plates) {
    if (p.parent != null && !plateIds.has(p.parent)) throw new Error(`板 ${p.id} の親 ${p.parent} が無い`);
  }
  const screwIds = new Set(), perColor = new Map();
  for (const s of level.screws) {
    if (screwIds.has(s.id)) throw new Error(`ねじの id が重複している: ${s.id}`);
    if (!plateIds.has(s.plate)) throw new Error(`ねじ ${s.id} の板 ${s.plate} が無い`);
    screwIds.add(s.id);
    perColor.set(s.color, (perColor.get(s.color) || 0) + 1);
  }
  const boxes = new Map();
  for (const c of level.queue) boxes.set(c, (boxes.get(c) || 0) + 1);
  for (const c of new Set([...perColor.keys(), ...boxes.keys()])) {
    const n = perColor.get(c) || 0, b = boxes.get(c) || 0;
    if (n !== b * BOX_SIZE) throw new Error(`色 ${c}: ねじ ${n} 本に対して箱が ${b} 個（ねじは箱の数 × ${BOX_SIZE} 本）`);
  }
}

// 1局の始まりの状態
export function newGame(level) {
  validateLevel(level);
  const st = {
    level,
    where: Object.fromEntries(level.screws.map(s => [s.id, 'board'])),   // 'board' | 'box' | 'slot'
    left: Object.fromEntries(level.plates.map(p => [p.id, 0])),          // 板ごとに残っているねじの本数
    boxes: new Array(ACTIVE_BOXES).fill(null),   // { color, n, order }。order は queue の何番目の箱か。null = もう出す箱が無い
    nextBox: 0,                                  // 次に出す箱の queue の位置
    slots: new Array(SLOT_COUNT).fill(null),     // 待機スロットに入っているねじの id
    filled: 0,                                   // 満杯になって消えた箱の数
  };
  for (const s of level.screws) st.left[s.plate]++;
  const events = [];
  for (let i = 0; i < ACTIVE_BOXES; i++) spawnBox(st, i, events);
  return st;
}

export const screwById = (st, id) => st.level.screws.find(s => s.id === id);
export const plateState = (st, plateId) => plateStateOf(st.left[plateId]);

// その色のねじが入る箱の位置（-1 = 無い）。同じ色の箱が2つなら多く入っている方（早く満杯にして次の箱を出す）
export function openBoxFor(st, color) {
  let best = -1;
  st.boxes.forEach((b, i) => {
    if (b && b.color === color && b.n < BOX_SIZE && (best < 0 || b.n > st.boxes[best].n)) best = i;
  });
  return best;
}

const freeSlot = st => st.slots.indexOf(null);

// 板ごとの子の板の id（盤面ごとに1回だけ求める）
const childrenCache = new WeakMap();
export function childrenOf(level) {
  let m = childrenCache.get(level);
  if (!m) {
    m = new Map(level.plates.map(p => [p.id, []]));
    for (const p of level.plates) if (p.parent != null && m.has(p.parent)) m.get(p.parent).push(p.id);
    childrenCache.set(level, m);
  }
  return m;
}

// 板を留めている子の板（ねじが残っている子）の id
export function heldBy(st, plateId) {
  return childrenOf(st.level).get(plateId).filter(c => st.left[c] > 0);
}

// ねじを外せるか。'ok' | 'gone'（もう盤面に無い）| 'held'（板の最後のねじで、子の板がまだ残っている）
//   | 'blocked'（隠れている）| 'full'（合う箱が無く待機スロットも満杯）
export function checkRemove(st, id, isBlocked = notBlocked) {
  const s = screwById(st, id);
  if (!s) throw new Error(`ねじ ${id} が無い`);
  if (st.where[id] !== 'board') return 'gone';
  if (st.left[s.plate] === 1 && heldBy(st, s.plate).length) return 'held';
  if (isBlocked(id, st)) return 'blocked';
  if (openBoxFor(st, s.color) < 0 && freeSlot(st) < 0) return 'full';
  return 'ok';
}

// ねじを外す。返り値 { ok, reason, state, events }。外せないときは state は元のまま、events は空
// events（起きた順）:
//   { type: 'toBox', screw, box }            ねじが箱へ
//   { type: 'toSlot', screw, slot }          ねじが待機スロットへ
//   { type: 'plate', plate, from, to }       板の状態が変わった（fixed / hanging / fallen）
//   { type: 'boxFull', box, color }          箱が満杯になって消えた
//   { type: 'boxSpawn', box, color }         新しい箱が出た
//   { type: 'slotToBox', screw, slot, box }  待機スロットのねじが新しい箱へ自動で移った
export function removeScrew(st0, id, isBlocked = notBlocked) {
  const reason = checkRemove(st0, id, isBlocked);
  if (reason !== 'ok') return { ok: false, reason, state: st0, events: [] };
  const st = clone(st0), events = [];
  const s = screwById(st, id);

  const before = plateStateOf(st.left[s.plate]);
  st.left[s.plate]--;
  const after = plateStateOf(st.left[s.plate]);

  const b = openBoxFor(st, s.color);
  if (b >= 0) {
    st.where[id] = 'box';
    st.boxes[b].n++;
    events.push({ type: 'toBox', screw: id, box: b });
  } else {
    const k = freeSlot(st);
    st.where[id] = 'slot';
    st.slots[k] = id;
    events.push({ type: 'toSlot', screw: id, slot: k });
  }
  if (before !== after) events.push({ type: 'plate', plate: s.plate, from: before, to: after });
  if (b >= 0 && st.boxes[b].n === BOX_SIZE) finishBox(st, b, events);
  return { ok: true, reason, state: st, events };
}

// 満杯の箱を消し、同じ場所に次の箱を出す
function finishBox(st, i, events) {
  events.push({ type: 'boxFull', box: i, color: st.boxes[i].color });
  st.filled++;
  spawnBox(st, i, events);
}

// 位置 i に次の箱を出し、待機スロットの同じ色のねじを（スロットの番号の若い順に）移す。
// 移しただけで満杯になれば、その箱も消えて次が出る
function spawnBox(st, i, events) {
  if (st.nextBox >= st.level.queue.length) { st.boxes[i] = null; return; }
  const color = st.level.queue[st.nextBox];
  st.boxes[i] = { color, n: 0, order: st.nextBox };
  st.nextBox++;
  events.push({ type: 'boxSpawn', box: i, color });
  const byId = new Map(st.level.screws.map(s => [s.id, s]));
  for (let k = 0; k < SLOT_COUNT && st.boxes[i].n < BOX_SIZE; k++) {
    const sid = st.slots[k];
    if (sid === null || byId.get(sid).color !== color) continue;
    st.slots[k] = null;
    st.where[sid] = 'box';
    st.boxes[i].n++;
    events.push({ type: 'slotToBox', screw: sid, slot: k, box: i });
  }
  if (st.boxes[i].n === BOX_SIZE) finishBox(st, i, events);
}

// 今外せるねじの id
export function legalMoves(st, isBlocked = notBlocked) {
  return st.level.screws.filter(s => checkRemove(st, s.id, isBlocked) === 'ok').map(s => s.id);
}

export const isCleared = st => st.filled === st.level.queue.length;

// 'cleared'（全部の箱を埋めた）| 'stuck'（詰み: 外せるねじが1本も無い）| 'playing'
// 詰みは 2D 版の「スロットが満杯で、入れられるねじが無い」を一般にしたもの。2D 版では最上階層のねじが必ず見えているので同じことになる。
// 3D では隠れ方しだいで、スロットに空きがあってもどのねじも外せないことがありうるので、それも詰みとする。
// 板が揺れている間の扱い（落ち着くまで詰みを決めない）は物理側（M5）で決める
export function status(st, isBlocked = notBlocked) {
  if (isCleared(st)) return 'cleared';
  return legalMoves(st, isBlocked).length ? 'playing' : 'stuck';
}

function clone(st) {
  return {
    level: st.level,
    where: { ...st.where },
    left: { ...st.left },
    boxes: st.boxes.map(b => b && { ...b }),
    nextBox: st.nextBox,
    slots: st.slots.slice(),
    filled: st.filled,
  };
}
