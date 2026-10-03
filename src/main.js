import * as THREE from 'three';
import { createGesture } from './gesture.js';
import { dragRotation, zoomDistance, radPerPx } from './view.js';
import { buildBoard } from './scene.js';
import { createGame, hudOf, applyEvent } from './game.js';
import { nearestScrew } from './pick.js';
import { fixedBlocker, sweepHits } from './board.js';
import { initPhysics, createPhysics, syncPlates, STEP } from './physics.js';
import { generateLevel, KINDS } from './generator.js';
import { BOX_LEVEL } from './levels/box.js';
import { stageLevel, START_VIEW as START_EULER } from './stages.js';
import { createProgress, deviceStorage } from './progress.js';
import { createFeedback, tapCue, eventCue, endCue } from './feedback.js';

// 既定はステージの進行（到達したステージから始める）。
// ?seed=番号（と &kind=box|shelf|table）なら生成した盤面を1つだけ遊ぶ（進行は保存しない）。
// ?level=box なら M3 の固定の箱（物理の確かめ用。進行は保存しない）。
// ?stage=番号 ならそのステージから（確かめ用。クリアすれば進行は保存する）
const query = new URLSearchParams(window.location.search);
const freeSeed = Number.parseInt(query.get('seed') ?? '', 10);
const fixedBox = query.get('level') === 'box';
const freePlay = fixedBox || Number.isFinite(freeSeed);
const progress = createProgress(freePlay ? null : deviceStorage());
const askedStage = Number.parseInt(query.get('stage') ?? '', 10);
let stage = Number.isInteger(askedStage) && askedStage >= 1 ? askedStage : progress.stage;

function levelFor() {
  if (fixedBox) return BOX_LEVEL;
  if (freePlay) {
    const kind = query.get('kind');
    return generateLevel(freeSeed, KINDS.includes(kind) ? { kind } : {});
  }
  return stageLevel(stage);
}
let LEVEL = levelFor();

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const hint = $('hint');

// ---- 3D ----

// 画素の細かい画面（devicePixelRatio 2 以上。今のスマホのほとんど）では、縁のギザギザが目立たないので
// アンチエイリアス（MSAA）を切って、塗る量を減らす
const DPR = window.devicePixelRatio || 1;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: DPR < 2, powerPreference: 'high-performance' });
renderer.setClearColor(0xf4ead9);

// 描く解像度。DPR は 2 まで。動かしている間の1フレームが重ければ段階的に下げる（中級機で滑らかに動かすため）。
// 下げた解像度はその回のあいだ保つ（上げ下げを繰り返すと画面がちらつく）
const PIXEL_RATIOS = [2, 1.5, 1.25, 1].filter((r) => r <= Math.max(1, DPR));
let pixelLevel = 0;
renderer.setPixelRatio(PIXEL_RATIOS[0]);
const SLOW_FRAME_MS = 24;   // 続けて描いたフレームの間隔の平均がこれを超えたら下げる（40fps を切る）
const frameTimes = [];
function watchFrameTime(now, last) {
  if (!last || now - last > 100) { frameTimes.length = 0; return; }   // 止まっていた後の1フレームは数えない
  frameTimes.push(now - last);
  if (frameTimes.length < 40) return;
  const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  frameTimes.length = 0;
  if (avg > SLOW_FRAME_MS && pixelLevel < PIXEL_RATIOS.length - 1) {
    renderer.setPixelRatio(PIXEL_RATIOS[++pixelLevel]);
    resize();
  }
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
// 盤面（外寸 6 の箱）が縦画面の横幅に収まる距離
const ZOOM = { min: 12, max: 34 };
const START_DISTANCE = 19;
let distance = START_DISTANCE;
camera.position.set(0, 0, distance);

scene.add(new THREE.HemisphereLight(0xfff8ee, 0x8a7a66, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.position.set(4, 7, 9);
scene.add(sun);

// 立体はこの group ごと回す。盤面は中に作り直す（やり直し）
const model = new THREE.Group();
// 最初は斜め上から見た向きにして、立体だと分かるようにする（ステージが変わるたびにこの向きへ戻す）
const START_VIEW = new THREE.Euler(...START_EULER);
model.quaternion.setFromEuler(START_VIEW);
scene.add(model);

let board = null;
let physics = null;   // 板の物理（盤面の座標で動く。やり直しで作り直す）

// 描き直しは、何かが変わったときだけ次のフレームで行う。何も動いていなければフレームの呼び出しも止めて、電池を使わない
let needsRender = true;
let framePending = false;
let started = false;   // 物理の準備ができるまではフレームを回さない
function requestRender() {
  needsRender = true;
  wake();
}
function wake() {
  if (framePending || !started) return;
  framePending = true;
  requestAnimationFrame(frame);
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
  homing = null;
  const { axis: a, angle } = dragRotation(dx, dy, radPerPx(window.innerWidth, window.innerHeight));
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

// 向きと距離を最初に戻す（見失ったとき用のボタン）。0.35 秒かけて回して戻す
let homing = null;
function goHome() {
  const from = model.quaternion.clone(), to = new THREE.Quaternion().setFromEuler(START_VIEW);
  const d0 = distance;
  const t = tween(350, (k) => {
    if (homing !== t) return;
    const e = k * k * (3 - 2 * k);
    model.quaternion.slerpQuaternions(from, to, e);
    distance = d0 + (START_DISTANCE - d0) * e;
    camera.position.set(0, 0, distance);
  });
  homing = t;
}

// ---- 時間で動くもの（ねじが抜ける、震える、板が落ちる） ----

const tweens = new Set();
function tween(duration, update, done) {
  const t = { start: performance.now(), duration, update, done };
  wake();
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
  for (const m of mats) {
    m.transparent = true;   // 板はふだん不透明で描いている（scene.js）。消えるときだけ透明にする
    m.needsUpdate = true;
  }
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
let game = null;
let colorOf = null;
function newGameFor(level) {
  game = createGame(level, (id, st) => physics.blocker()(id, st), fixedBlocker(level));
  colorOf = new Map(level.screws.map((s) => [s.id, s.color]));
}
newGameFor(LEVEL);
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
      if (ev.type !== 'plate') feedback.cue(eventCue(ev));   // 板の落ちる音はタップの瞬間に鳴らしている
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
  feedback.cue(tapCue(r.reason));
  if (r.reason === 'blocked') {
    shake(obj);
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
    if (r.events.some((ev) => eventCue(ev) === 'plate')) feedback.cue('plate');
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
  const cleared = status === 'cleared';
  feedback.cue(endCue(status));
  // クリアしたらその場で次のステージを保存する（ボタンを押す前に閉じても、次は続きから）
  if (cleared && !freePlay) progress.cleared(stage);
  $('end-title').textContent = cleared ? (freePlay ? 'クリア！' : `ステージ ${stage} クリア！`) : '詰み';
  $('end-text').textContent = cleared ? 'すべての箱を埋めた' : '外せるねじが無くなった';
  const next = cleared && !freePlay;
  $('next').hidden = !next;
  $('again').textContent = cleared ? 'もう一度' : 'やり直す';
  $('again').classList.toggle('sub', next);
  ov.hidden = false;
}

function showStage() {
  $('title').textContent = fixedBox ? '固定の箱' : freePlay ? `シード ${freeSeed}` : `ステージ ${stage}`;
}

// 次のステージへ。盤面の生成に少しかかるので、先に表示を切り替えてから作る
let loading = false;
async function nextStage() {
  if (loading) return;
  loading = true;
  stage++;
  $('overlay').hidden = true;
  showStage();
  hint.textContent = `ステージ ${stage} を組み立て中…`;
  await wait(30);
  LEVEL = levelFor();
  newGameFor(LEVEL);
  homing = null;
  model.quaternion.setFromEuler(START_VIEW);
  zoomBy(distance / START_DISTANCE);
  restart();
  hint.textContent = '1本指で回す・ねじをタップで外す';
  loading = false;
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
  showStage();
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
  feedback.unlock();   // 音は利用者の操作の中でしか鳴らし始められない
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
$('home').addEventListener('click', goHome);

// 音と振動の入り切り（端末に保存する）
const feedback = createFeedback(deviceStorage());
const soundButton = $('sound');
function showSound() {
  soundButton.classList.toggle('off', !feedback.on);
  soundButton.setAttribute('aria-pressed', String(feedback.on));
  soundButton.setAttribute('aria-label', feedback.on ? '音と振動を切る' : '音と振動を入れる');
}
soundButton.addEventListener('click', () => {
  feedback.on = !feedback.on;
  showSound();
  feedback.cue('box');
});
showSound();
$('again').addEventListener('click', restart);
$('next').addEventListener('click', nextStage);

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

let lastDraw = 0;
function frame(now) {
  framePending = false;
  stepPhysics(now);
  if (tweens.size) {
    runTweens(now);
    needsRender = true;
  }
  if (needsRender) {
    needsRender = false;
    renderer.render(scene, camera);
    watchFrameTime(now, lastDraw);
    lastDraw = now;
  }
  // 物理が動いているか演出の途中なら次のフレームも。止まっていればここで止め、次の操作（requestRender）で再開する
  if (physics.moving() || tweens.size || needsRender) wake();
  else lastFrame = 0;
}

async function start() {
  await initPhysics();
  started = true;
  restart();
  resize();
  wake();
}
start();

// スクリーンショットのスクリプトが描画の完了や盤面の様子を知るための目印
window.__app = {
  model,
  camera,
  startQuaternion: new THREE.Quaternion().setFromEuler(START_VIEW).toArray(),
  get game() { return game; },
  get stage() { return freePlay ? null : stage; },
  get rendered() { return !loading && !needsRender && !tweens.size && !playing && !physics?.moving(); },
  // rendered が false の理由（スクリーンショットのスクリプトが待ちきれなかったとき用）
  why: () => ({ loading, needsRender, tweens: tweens.size, playing, moving: physics?.moving(), modes: window.__app.plateModes() }),
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
  // 生成した盤面の、解ける手順
  get solution() { return LEVEL.meta?.solution ?? null; },
  get level() { return LEVEL.meta; },
};
