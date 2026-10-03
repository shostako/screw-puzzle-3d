import * as THREE from 'three';
import { createGesture } from './gesture.js';
import { dragRotation, zoomDistance } from './view.js';
import { buildBoard } from './scene.js';
import { createGame, hudOf, applyEvent } from './game.js';
import { nearestScrew } from './pick.js';
import { fixedBlocker, sweepHits } from './board.js';
import { initPhysics, createPhysics, syncPlates, STEP } from './physics.js';
import { BOX_LEVEL } from './levels/box.js';
import { generateLevel, KINDS } from './generator.js';

// ?seed=番号（と &kind=box|shelf|table）で生成した盤面を遊べる。無ければ固定の箱（M7 でステージの進行に置き換える）
function levelFromUrl() {
  const q = new URLSearchParams(window.location.search);
  const seed = Number.parseInt(q.get('seed') ?? '', 10);
  if (!Number.isFinite(seed)) return BOX_LEVEL;
  const kind = q.get('kind');
  return generateLevel(seed, KINDS.includes(kind) ? { kind } : {});
}
const LEVEL = levelFromUrl();

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const hint = $('hint');

// ---- 3D ----

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0xf4ead9);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
// 盤面（外寸 6 の箱）が縦画面の横幅に収まる距離
const ZOOM = { min: 12, max: 34 };
let distance = 19;
camera.position.set(0, 0, distance);

scene.add(new THREE.HemisphereLight(0xfff8ee, 0x8a7a66, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.position.set(4, 7, 9);
scene.add(sun);

// 立体はこの group ごと回す。盤面は中に作り直す（やり直し）
const model = new THREE.Group();
// 最初は斜め上から見た向きにして、立体だと分かるようにする
model.quaternion.setFromEuler(new THREE.Euler(0.45, -0.6, 0));
scene.add(model);

let board = null;
let physics = null;   // 板の物理（盤面の座標で動く。やり直しで作り直す）

let needsRender = true;
function requestRender() {
  needsRender = true;
}

// HUD の高さの分、立体を画面の下寄りに描く
let hudOffset = 0;
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 縦長の画面では横幅に合わせて立体が収まるよう、縦の画角を広げる
  camera.fov = w < h ? 40 * Math.min(1.6, h / w / 1.2) : 40;
  hudOffset = $('hud').getBoundingClientRect().height;
  camera.setViewOffset(w, h, 0, -hudOffset * 0.3, w, h);
  camera.updateProjectionMatrix();
  requestRender();
}
window.addEventListener('resize', resize);

const axis = new THREE.Vector3();
const turn = new THREE.Quaternion();
function rotateBy(dx, dy) {
  const { axis: a, angle } = dragRotation(dx, dy);
  if (angle === 0) return;
  // カメラから見た軸で回す（いまの向きに関係なく、指の方向へ回る）
  turn.setFromAxisAngle(axis.set(a[0], a[1], a[2]), angle);
  model.quaternion.premultiply(turn);
  requestRender();
}

function zoomBy(scale) {
  distance = zoomDistance(distance, scale, ZOOM.min, ZOOM.max);
  camera.position.set(0, 0, distance);
  requestRender();
}

// ---- 時間で動くもの（ねじが抜ける、震える、板が落ちる） ----

const tweens = new Set();
function tween(duration, update, done) {
  const t = { start: performance.now(), duration, update, done };
  tweens.add(t);
  requestRender();
  return t;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function runTweens(now) {
  for (const t of tweens) {
    const k = Math.min(1, (now - t.start) / t.duration);
    t.update(k);
    if (k >= 1) {
      tweens.delete(t);
      t.done?.();
    }
  }
}

// ねじが回りながら抜けて消える
function unscrew(obj) {
  const p0 = obj.position.clone();
  const out = new THREE.Vector3(0, 1, 0).applyQuaternion(obj.quaternion);
  const q0 = obj.quaternion.clone();
  const spin = new THREE.Quaternion();
  tween(260, (k) => {
    obj.position.copy(p0).addScaledVector(out, 0.9 * k);
    spin.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -k * Math.PI * 3);
    obj.quaternion.copy(q0).multiply(spin);
    obj.scale.setScalar(1 - 0.4 * k);
  }, () => { obj.visible = false; });
}

// 隠れたねじは震えて拒否する
function shake(obj) {
  if (obj.userData.shaking) return;
  obj.userData.shaking = true;
  const p0 = obj.position.clone();
  const side = new THREE.Vector3(1, 0, 0).applyQuaternion(obj.quaternion);
  tween(380, (k) => {
    obj.position.copy(p0).addScaledVector(side, 0.1 * Math.sin(k * Math.PI * 8) * (1 - k));
  }, () => {
    obj.position.copy(p0);
    obj.userData.shaking = false;
  });
}

// 物理で盤面の外まで落ちきった板は、立体から外して画面の下へ落とし、消す
function dropPlate(obj) {
  scene.attach(obj);   // 立体の回転から外し、世界の下（画面の下）へ落とす
  const y0 = obj.position.y;
  const mats = [];
  obj.traverse((o) => o.material && mats.push(o.material));
  tween(900, (k) => {
    obj.position.y = y0 - 26 * k * k;
    for (const m of mats) m.opacity = (m.userData.opacity0 ??= m.opacity) * Math.min(1, 2.2 - 2.2 * k);
  }, () => {
    scene.remove(obj);
  });
}

// ---- 画面の上: 箱とスロット ----

const boxesEl = $('boxes');
const slotsEl = $('slots');
const cssColor = (c) => `var(--${c}, #999)`;

function dot(color) {
  const d = document.createElement('div');
  d.className = 'dot';
  d.style.setProperty('--c', cssColor(color));
  return d;
}

function renderHud(hud, spawned = -1) {
  boxesEl.replaceChildren(...hud.boxes.map((b, i) => {
    const el = document.createElement('div');
    el.className = 'box' + (b ? '' : ' empty') + (i === spawned ? ' spawn' : '');
    if (b) el.style.setProperty('--c', cssColor(b.color));
    for (let k = 0; k < 3; k++) {
      const hole = document.createElement('div');
      hole.className = 'hole';
      if (b && k < b.n) hole.append(dot(b.color));
      el.append(hole);
    }
    return el;
  }));
  slotsEl.replaceChildren(...hud.slots.map((c) => {
    const el = document.createElement('div');
    el.className = 'slot';
    if (c) el.append(dot(c));
    return el;
  }));
  $('progress').textContent = `${hud.filled} / ${hud.total}`;
}

const centerOf = (el) => {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
};

// 画面の from から to へ、ねじの印を飛ばす
function fly(color, from, to, ms) {
  const el = dot(color);
  el.classList.add('flyer');
  $('flyers').append(el);
  const anim = el.animate([
    { transform: `translate(${from[0]}px, ${from[1]}px) scale(1.25)` },
    { transform: `translate(${(from[0] + to[0]) / 2}px, ${Math.min(from[1], to[1]) - 30}px) scale(1.1)`, offset: 0.45 },
    { transform: `translate(${to[0]}px, ${to[1]}px) scale(1)` },
  ], { duration: ms, easing: 'ease-in-out', fill: 'forwards' });
  return anim.finished.then(() => el.remove(), () => el.remove());
}

let flashTimer = 0;
function say(text, warn = false) {
  hint.textContent = text;
  hint.classList.toggle('flash', warn);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    hint.textContent = '1本指で回す・ねじをタップで外す';
    hint.classList.remove('flash');
  }, 1200);
}

// ---- 1局 ----

// 外せるかは今の板の姿勢で調べ、詰みは動かない板だけで決める（回せばどけられる板があるうちは詰みにしない）
const game = createGame(LEVEL, (id, st) => physics.blocker()(id, st), fixedBlocker(LEVEL));
const colorOf = new Map(LEVEL.screws.map((s) => [s.id, s.color]));
let hud = hudOf(game.state);   // いま画面に出している箱とスロット（演出の途中の様子）
let queue = [];                // まだ見せていない出来事のまとまり { events, from: [x, y], status }
let playing = false;
let generation = 0;            // やり直しで古い演出を捨てるための番号

function screenOf(obj) {
  const p = new THREE.Vector3();
  obj.getWorldPosition(p).project(camera);
  return [(p.x + 1) / 2 * window.innerWidth, (1 - p.y) / 2 * window.innerHeight];
}

// 出来事を順に見せる。続けてタップされて溜まっているときは速める
async function play() {
  if (playing) return;
  playing = true;
  const gen = generation;
  while (queue.length && gen === generation) {
    const batch = queue.shift();
    for (const ev of batch.events) {
      const fast = queue.length ? 0.5 : 1;
      const before = hud;
      const after = applyEvent(hud, ev, LEVEL);
      if (ev.type === 'toBox' || ev.type === 'toSlot') {
        const target = ev.type === 'toBox'
          ? boxesEl.children[ev.box].children[before.boxes[ev.box].n]
          : slotsEl.children[ev.slot];
        await fly(colorOf.get(ev.screw), batch.from, centerOf(target), 380 * fast);
      } else if (ev.type === 'slotToBox') {
        const from = centerOf(slotsEl.children[ev.slot]);
        const to = centerOf(boxesEl.children[ev.box].children[before.boxes[ev.box].n]);
        slotsEl.children[ev.slot].replaceChildren();
        await fly(colorOf.get(ev.screw), from, to, 300 * fast);
      } else if (ev.type === 'boxFull') {
        await wait(120 * fast);
        boxesEl.children[ev.box].classList.add('done');
        await wait(220 * fast);
      }
      if (gen !== generation) break;
      hud = after;
      renderHud(hud, ev.type === 'boxSpawn' ? ev.box : -1);
      if (ev.type === 'boxSpawn') await wait(200 * fast);
    }
    if (gen === generation && batch.status !== 'playing' && !queue.length) showEnd(batch.status);
  }
  if (gen === generation) playing = false;
}

function tapScrew(id) {
  const obj = board.screws.get(id);
  const r = game.tap(id);
  if (r.reason === 'blocked') {
    shake(obj);
    navigator.vibrate?.(30);
    const by = movableBlockers(id);
    say(by === 'loose' ? '落ちた板に隠れている。回して払い落とそう'
      : by === 'hanging' ? 'ぶら下がった板に隠れている。回して動かそう'
      : 'ほかの板に隠れていて外せない', true);
  } else if (r.reason === 'full') {
    shake(obj);
    slotsEl.classList.add('warn');
    setTimeout(() => slotsEl.classList.remove('warn'), 400);
    say('待機スロットがいっぱい', true);
  } else if (r.reason === 'ok') {
    const from = screenOf(obj);
    unscrew(obj);
    syncPlates(physics, game.state);   // 1本になった板はぶら下がり、0本の板は落ち始める
    requestRender();
    queue.push({ events: r.events, from, status: r.status });
    play();
  }
  return r.reason;
}

// ねじを隠しているのが動ける板だけなら、その種類（落ちた板があれば 'loose'、ぶら下がりだけなら 'hanging'）。
// 固定の板にも隠れていれば null（回しても外せない）
function movableBlockers(id) {
  const present = new Set(physics.present());
  const hits = sweepHits(LEVEL, id, { plates: LEVEL.plates.filter((p) => present.has(p.id)), poses: physics.poses() });
  const modes = hits.map((p) => physics.mode(p));
  if (!hits.length || modes.includes('fixed')) return null;
  return modes.includes('loose') ? 'loose' : 'hanging';
}

function showEnd(status) {
  const ov = $('overlay');
  ov.className = status;
  $('end-title').textContent = status === 'cleared' ? 'クリア！' : '詰み';
  $('end-text').textContent = status === 'cleared' ? 'すべての箱を埋めた' : '外せるねじが無くなった';
  ov.hidden = false;
}

function restart() {
  generation++;
  queue = [];
  playing = false;
  for (const t of tweens) tweens.delete(t);
  $('flyers').replaceChildren();
  if (board) {
    model.remove(board.root);
    for (const p of board.plates.values()) if (p.parent === scene) scene.remove(p);
  }
  board = buildBoard(LEVEL);
  model.add(board.root);
  physics?.free();
  physics = createPhysics(LEVEL);
  stepClock = 0;
  game.restart();
  syncPlates(physics, game.state);
  hud = hudOf(game.state);
  renderHud(hud);
  $('overlay').hidden = true;
  requestRender();
}

// ---- タップでねじを選ぶ ----

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

// 当たり判定の相手: 盤面に残っている板と、残っているねじ
function pickTargets() {
  const out = [];
  for (const p of board.plates.values()) if (p.parent === board.root) out.push(p);
  for (const [id, s] of board.screws) if (game.state.where[id] === 'board') out.push(s);
  return out;
}

function screwIdOf(obj) {
  for (let o = obj; o; o = o.parent) if (o.userData.screwId) return o.userData.screwId;
  return null;
}

function castAt(x, y) {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObjects(pickTargets(), true)[0] ?? null;
}

// 画面上で見えているねじの位置（頭の中心が手前の板に隠れていないもの）
function visibleScrews() {
  const out = [];
  const camPos = camera.position;
  const p = new THREE.Vector3();
  for (const [id, s] of board.screws) {
    if (game.state.where[id] !== 'board') continue;
    s.getWorldPosition(p);
    const [x, y] = screenOf(s);
    const hit = castAt(x, y);
    if (hit && screwIdOf(hit.object) === id) out.push({ id, x, y });
    else if (!hit || hit.distance > p.distanceTo(camPos) - 0.05) out.push({ id, x, y });
  }
  return out;
}

function onTap(x, y) {
  if (!$('overlay').hidden) return;
  const hit = castAt(x, y);
  const id = (hit && screwIdOf(hit.object)) || nearestScrew(visibleScrews(), x, y);
  if (id) tapScrew(id);
}

// ---- 指の操作 ----

const gesture = createGesture();
function handle(events) {
  for (const e of events) {
    if (e.type === 'rotate') rotateBy(e.dx, e.dy);
    else if (e.type === 'zoom') zoomBy(e.scale);
    else if (e.type === 'tap') onTap(e.x, e.y);
  }
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  handle(gesture.down(e.pointerId, e.clientX, e.clientY, e.timeStamp));
});
canvas.addEventListener('pointermove', (e) => {
  handle(gesture.move(e.pointerId, e.clientX, e.clientY, e.timeStamp));
});
canvas.addEventListener('pointerup', (e) => {
  handle(gesture.up(e.pointerId, e.clientX, e.clientY, e.timeStamp));
});
canvas.addEventListener('pointercancel', (e) => {
  handle(gesture.cancel(e.pointerId));
});
// PC で試すとき用: ホイールで寄り引き
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomBy(Math.exp(-e.deltaY * 0.001));
}, { passive: false });

$('restart').addEventListener('click', restart);
$('again').addEventListener('click', restart);

// ---- 物理を進める ----

const qInv = new THREE.Quaternion();
const down = new THREE.Vector3();
let stepClock = 0;      // 物理に渡していない時間（秒）
let lastFrame = 0;
const MAX_STEPS = 4;    // 1フレームで進める刻みの上限（遅い端末ではゆっくり動く。結果は刻みの数で決まる）

function stepPhysics(now) {
  // 画面の下（世界の -y）を、盤面の座標に直して重力の向きにする
  qInv.copy(model.quaternion).invert();
  down.set(0, -1, 0).applyQuaternion(qInv);
  physics.setDown([down.x, down.y, down.z]);
  const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  if (!physics.moving()) { stepClock = 0; return; }
  stepClock += dt;
  let n = 0;
  while (stepClock >= STEP && n < MAX_STEPS) {
    for (const id of physics.step()) dropPlate(board.plates.get(id));
    stepClock -= STEP;
    n++;
  }
  if (n === MAX_STEPS) stepClock = 0;
  for (const [id, pose] of Object.entries(physics.poses())) {
    const obj = board.plates.get(id);
    obj.position.set(...pose.position);
    obj.quaternion.set(...pose.quaternion);
  }
  requestRender();
}

function frame(now) {
  stepPhysics(now);
  if (tweens.size) {
    runTweens(now);
    needsRender = true;
  }
  if (needsRender) {
    needsRender = false;
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}

async function start() {
  await initPhysics();
  restart();
  resize();
  requestAnimationFrame(frame);
}
start();

// スクリーンショットのスクリプトが描画の完了や盤面の様子を知るための目印
window.__app = {
  model,
  camera,
  game,
  get rendered() { return !needsRender && !tweens.size && !playing && !physics?.moving(); },
  // 立体の向きを Euler で直接決める（スクリーンショットで同じ向きから撮るため）
  view(x, y, z, d = distance) {
    model.rotation.set(x, y, z);
    zoomBy(distance / d);
  },
  plateModes: () => Object.fromEntries(LEVEL.plates.map((p) => [p.id, physics.mode(p.id)])),
  tapScrew,
  screenOf: (id) => screenOf(board.screws.get(id)),
  visibleScrews,
  legal: () => game.legal(),
  // 生成した盤面の、解ける手順（固定の箱には無い）
  solution: LEVEL.meta?.solution ?? null,
};
