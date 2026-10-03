// 板の物理。ねじ1本の板はそのねじを軸に回ってぶら下がり、0本の板は落ちて他の板に当たる。
// 描画に依存しない（ブラウザ無しのテストで回すため）。物理ライブラリは Rapier（決定的な版）。
//
// 座標は盤面（board.js）の座標そのもの。画面で立体を回すと、盤面から見た「下」が変わるので、
// 重力の向きを setDown で盤面の座標に直して渡す（立体を回す速さによる慣性の力は無視する）。
//
// 時間は STEP 秒の固定の刻みで進める。同じ盤面に、同じ刻みの位置で同じ操作（hang / release / setDown）を
// 同じ値で渡せば、何度やっても同じ姿勢になる（Rapier の決定的な版は浮動小数の計算順まで固定している）。
//
// 使い方:
//   await initPhysics()                 // 1回だけ（wasm の準備）
//   const ph = createPhysics(level)     // 板は全部固定で始まる。ねじ1本の板は hang、0本の板は release しておく
//   ph.hang(板, 軸のねじ) / ph.release(板) // ルールの 'plate' の出来事に合わせて呼ぶ
//   ph.setDown([x, y, z])               // 盤面の座標での下向き
//   const gone = ph.step()              // 1刻み進める。盤面の外へ落ちきった板の id の配列が返る
//   ph.poses()                          // 動いている板の姿勢 { 板の id: { position, quaternion } }（sweepHits へそのまま渡せる）
//   ph.blocker()                        // ルールに渡す隠れ判定（今の姿勢で調べる）

import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { sub, dot, length, eulerMatrix, quaternionMatrix, matrixQuaternion } from './geom.js';
import { plateFrame, plateVertices, sweepHits } from './board.js';
import { plateState } from './rules.js';

export const STEP = 1 / 60;       // 1刻みの秒数
export const GRAVITY = 30;        // 重力の大きさ（盤面の単位 / 秒²）。外寸 6 の箱の高さを 0.6 秒ほどで落ちる
const SHRINK = 0.03;              // 板の当たりの形を縮める幅。組んだ盤面で隣の板と触れ合っていても、最初から押し合わないように
const ROUND = 0.02;               // 縮めた形の角を丸める半径（当たりを滑らかにする）。触れ合うのは SHRINK - ROUND の隙間から
const FRICTION = 0.8;
const RESTITUTION = 0.1;
const HANG_DAMPING = 1.5;         // ぶら下がった板の回転の減衰。揺れが数秒で収まるように
const LOOSE_DAMPING = 0.3;
// 落ち着いたとみなす条件: 速さと回る速さがこれ未満の刻みが QUIET_STEPS 続いた板は、動いていないとみなす。
// Rapier が自分で眠らせるより早く、画面の描き直しと刻みを止めるため。
// （体を sleep() で眠らせると、軸でつないだ板が起きたときに軸が外れることがあったので、眠らせはしない）
const QUIET_SPEED = 0.15;
const QUIET_STEPS = 30;
// 速さだけでは、隣の板に押し付けられて接触が震え続ける板（速さは 0.1〜0.4 を行き来するが、その場から動かない）や、
// 隣の板の間で 1〜2 度ほど揺れ続ける板が、いつまでも落ち着かない（M7 で見つかった）。
// そこで、ある姿勢から [距離, 刻み] の組のどれかについて、その刻みの数のあいだ板のどの点もその距離より離れなければ、
// 速さによらず落ち着いたとみなす（0.5 秒で 0.02、3 秒で 0.5。揺れ続ける板は数度の幅で振れていた）。動きは「中心の移動 + 回った角度 × 板の大きさ」で上から見積もる
const STILL = [[0.02, QUIET_STEPS], [0.5, 180]];
// それでも止まらない場合の歯止め: 最後に板の状態か重力の向きが変わってから RESTLESS_STEPS 刻み（20 秒）たったら、
// 動いていないとみなす（画面は刻みを止める。立体を回して重力の向きが変われば、また動き出す）
export const RESTLESS_STEPS = 1200;

let ready = null;
export function initPhysics() {
  ready ??= RAPIER.init();
  return ready;
}

const v3 = ([x, y, z]) => ({ x, y, z });
const arr = (v) => [v.x, v.y, v.z];

function plateQuaternion(plate) {
  return plate.quaternion ?? matrixQuaternion(eulerMatrix(plate.rotation || [0, 0, 0]));
}

// 板の当たりの形（板の中心を原点にした局所の頂点）
function plateShape(plate) {
  const { center, u, v, n } = plateFrame(plate);
  const pts = [];
  for (const p of plateVertices(plate, plate, SHRINK)) {
    const r = sub(p, center);
    pts.push(dot(r, u), dot(r, v), dot(r, n));
  }
  return RAPIER.ColliderDesc.roundConvexHull(new Float32Array(pts), ROUND)
    .setFriction(FRICTION)
    .setRestitution(RESTITUTION)
    .setDensity(1);
}

// hangDamping はぶら下がった板の減衰（テストで、揺れ続ける板を作るために 0 にする）
export function createPhysics(level, { gravity = GRAVITY, hangDamping = HANG_DAMPING } = {}) {
  const world = new RAPIER.World({ x: 0, y: -gravity, z: 0 });
  world.timestep = STEP;
  const byId = new Map(level.plates.map((p) => [p.id, p]));
  const screws = new Map(level.screws.map((s) => [s.id, s]));

  // 盤面の中心と半径。板の中心がここから「半径 + その板の大きさ」より外へ出たら、盤面から落ちきったとみなす
  const all = level.plates.flatMap((p) => plateVertices(p));
  const mid = all.reduce((s, q) => [s[0] + q[0] / all.length, s[1] + q[1] / all.length, s[2] + q[2] / all.length], [0, 0, 0]);
  const radius = Math.max(...all.map((q) => length(sub(q, mid))));
  const reach = new Map(level.plates.map((p) => [p.id, Math.max(...plateVertices(p).map((q) => length(sub(q, p.position))))]));

  // 板の状態: fixed（体は固定）| hanging（軸のまわりに回る）| loose（自由に落ちる）| gone（盤面から落ちきって消えた）
  const mode = new Map();
  const bodies = new Map();
  const joints = new Map();

  function makeBody(plate, desc) {
    const b = world.createRigidBody(desc
      .setTranslation(...plate.position)
      .setRotation(Object.fromEntries(['x', 'y', 'z', 'w'].map((k, i) => [k, plateQuaternion(plate)[i]]))));
    world.createCollider(plateShape(plate), b);
    return b;
  }

  for (const p of level.plates) {
    bodies.set(p.id, makeBody(p, RAPIER.RigidBodyDesc.fixed()));
    mode.set(p.id, 'fixed');
  }

  // 固定の体を、同じ姿勢の動く体に作り直す
  function toDynamic(id, damping) {
    const old = bodies.get(id);
    const t = old.translation(), r = old.rotation();
    world.removeRigidBody(old);
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(t.x, t.y, t.z)
      .setRotation(r)
      .setCcdEnabled(false)
      .setAngularDamping(damping)
      .setLinearDamping(damping));
    world.createCollider(plateShape(byId.get(id)), b);
    bodies.set(id, b);
    return b;
  }

  let posesCache = null;
  const quiet = new Map();   // 板の id → 静かな刻みが続いた数
  const still = new Map();   // 板の id → STILL の組ごとの { position, rotation, n }: その姿勢から距離以内にとどまった刻みの数
  let restless = 0;          // 最後に板の状態か重力の向きが変わってからの刻みの数

  // 板 id を「今から動き出しうる」とみなして、落ち着きの数えを始めから
  function stir(id) {
    quiet.set(id, 0);
    still.delete(id);
    restless = 0;
  }

  // 前の姿勢 a から今の体 b まで、板の点が動いた距離の上限
  function moved(id, a, b) {
    const t = b.translation(), r = b.rotation();
    const dq = Math.abs(a.rotation.x * r.x + a.rotation.y * r.y + a.rotation.z * r.z + a.rotation.w * r.w);
    const angle = 2 * Math.acos(Math.min(1, dq));
    return length(sub(arr(t), a.position)) + angle * reach.get(id);
  }

  const api = {
    // 板 plateId を、ねじ screwId を軸にぶら下げる（固定の板が1本になったとき）
    hang(plateId, screwId) {
      if (mode.get(plateId) !== 'fixed') throw new Error(`板 ${plateId} は固定でない（${mode.get(plateId)}）`);
      const s = screws.get(screwId);
      if (!s || s.plate !== plateId) throw new Error(`ねじ ${screwId} は板 ${plateId} のねじでない`);
      const b = toDynamic(plateId, hangDamping);
      // 軸: 世界に固定した点（ねじの位置）と、板の局所でのねじの位置を、ねじの向きのまわりで回れるようにつなぐ
      const anchor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...s.position));
      const { center, u, v, n } = plateFrame(byId.get(plateId));
      const rel = sub(s.position, center);
      const local = [dot(rel, u), dot(rel, v), dot(rel, n)];
      const axisLocal = [dot(s.dir, u), dot(s.dir, v), dot(s.dir, n)];
      const data = RAPIER.JointData.revoluteWithAxes(v3([0, 0, 0]), v3(local), v3(s.dir), v3(axisLocal));
      joints.set(plateId, { joint: world.createImpulseJoint(data, anchor, b, true), anchor });
      mode.set(plateId, 'hanging');
      stir(plateId);
      posesCache = null;
    },

    // 板 plateId を自由にする（ねじが0本になったとき）。固定からでもぶら下がりからでもよい
    release(plateId) {
      const m = mode.get(plateId);
      if (m === 'fixed') toDynamic(plateId, LOOSE_DAMPING);
      else if (m === 'hanging') {
        const j = joints.get(plateId);
        world.removeImpulseJoint(j.joint, true);
        world.removeRigidBody(j.anchor);
        joints.delete(plateId);
        const b = bodies.get(plateId);
        b.setAngularDamping(LOOSE_DAMPING);
        b.setLinearDamping(LOOSE_DAMPING);
        b.wakeUp();
      } else throw new Error(`板 ${plateId} は固定でもぶら下がりでもない（${m}）`);
      mode.set(plateId, 'loose');
      stir(plateId);
      posesCache = null;
    },

    // 盤面の座標での下向き（長さは問わない）。向きが変われば眠っている板も起こす
    setDown(d) {
      const l = length(d);
      if (!(l > 0)) return;
      const g = { x: (d[0] / l) * gravity, y: (d[1] / l) * gravity, z: (d[2] / l) * gravity };
      const cur = world.gravity;
      if (Math.abs(cur.x - g.x) + Math.abs(cur.y - g.y) + Math.abs(cur.z - g.z) < 1e-6 * gravity) return;
      world.gravity = g;
      for (const [id, b] of bodies) if (mode.get(id) === 'hanging' || mode.get(id) === 'loose') { b.wakeUp(); stir(id); }
    },

    get down() {
      const g = world.gravity;
      return [g.x / gravity, g.y / gravity, g.z / gravity];
    },

    // 1刻み進める。盤面の外へ落ちきった板は物理から外し、その id を返す
    step() {
      world.step();
      posesCache = null;
      restless++;
      const gone = [];
      for (const [id, b] of bodies) {
        const m = mode.get(id);
        if (m !== 'hanging' && m !== 'loose') continue;
        const slow = length(arr(b.linvel())) < QUIET_SPEED && length(arr(b.angvel())) < QUIET_SPEED;
        quiet.set(id, slow ? (quiet.get(id) ?? 0) + 1 : 0);
        const ss = still.get(id) ?? STILL.map(() => null);
        STILL.forEach(([far], k) => {
          if (ss[k] && moved(id, ss[k], b) <= far) ss[k].n++;
          else ss[k] = { position: arr(b.translation()), rotation: b.rotation(), n: 0 };
        });
        still.set(id, ss);
        if (m === 'loose' && length(sub(arr(b.translation()), mid)) > radius + reach.get(id)) gone.push(id);
      }
      for (const id of gone) {
        world.removeRigidBody(bodies.get(id));
        bodies.delete(id);
        mode.set(id, 'gone');
      }
      return gone;
    },

    mode: (plateId) => mode.get(plateId),

    // まだ盤面にある（消えていない）板の id
    present() {
      return level.plates.filter((p) => mode.get(p.id) !== 'gone').map((p) => p.id);
    },

    // 動ける板（ぶら下がりと自由）の今の姿勢。固定の板は初めの姿勢のままなので入れない
    poses() {
      if (posesCache) return posesCache;
      const out = {};
      for (const [id, b] of bodies) {
        const m = mode.get(id);
        if (m !== 'hanging' && m !== 'loose') continue;
        const r = b.rotation();
        out[id] = { position: arr(b.translation()), quaternion: [r.x, r.y, r.z, r.w] };
      }
      return (posesCache = out);
    },

    // 動ける板が1枚でも動いているか（Rapier が眠らせたか、しばらく静かか、その場から動いていなければ動いていないとみなす）。
    // 画面はこれが false の間、刻みを進めない。重力の向きが変われば setDown がまた動かす
    moving() {
      if (restless >= RESTLESS_STEPS) return false;
      for (const [id, b] of bodies) {
        const m = mode.get(id);
        if (m !== 'hanging' && m !== 'loose') continue;
        if (b.isSleeping() || (quiet.get(id) ?? 0) >= QUIET_STEPS || STILL.some(([, n], k) => (still.get(id)?.[k]?.n ?? 0) >= n)) continue;
        return true;
      }
      return false;
    },

    // ルールに渡す隠れ判定: 今の姿勢で、消えていない板（ぶら下がり・落ちて止まった板も含む）に掃いた円柱が重なるか
    blocker() {
      return (id) => {
        const present = new Set(api.present());
        return sweepHits(level, id, { plates: level.plates.filter((p) => present.has(p.id)), poses: api.poses() }).length > 0;
      };
    },

    free() {
      world.free();
    },
  };
  return api;
}

// ルールの状態に物理の板を合わせる。ねじが1本になった固定の板はぶら下げ、0本になった板は自由にする。
// 1局の始まりと、ねじを外すたびに呼ぶ（始めからねじ1本・0本の板もこれで扱える）。変えた板の id を返す
export function syncPlates(ph, st) {
  const changed = [];
  for (const p of st.level.plates) {
    const want = plateState(st, p.id), m = ph.mode(p.id);
    if (want === 'hanging' && m === 'fixed') {
      const pivot = st.level.screws.find(s => s.plate === p.id && st.where[s.id] === 'board');
      ph.hang(p.id, pivot.id);
      changed.push(p.id);
    } else if (want === 'fallen' && (m === 'fixed' || m === 'hanging')) {
      ph.release(p.id);
      changed.push(p.id);
    }
  }
  return changed;
}

// 姿勢の四元数で、板の局所の点を盤面の座標へ（テストと描画の確かめ用）
export function poseApply(pose, local) {
  const m = quaternionMatrix(pose.quaternion);
  return [0, 1, 2].map((i) => dot(m[i], local) + pose.position[i]);
}
