import * as THREE from 'three';
import { createGesture } from './gesture.js';
import { dragRotation, zoomDistance, radPerPx } from './view.js';
import { buildBoard, setKnurl, setContact, setDrives, driveIcon } from './scene.js';
import { THEME, cssVariables, skyVariables } from './theme.js';
import { bakeEnvironment } from './env.js';
import { createMascot } from './mascot.js';
import { createGame, hudOf, applyEvent, rewindPoint } from './game.js';
import { safeBlocker } from './safe.js';
import { nearestScrew } from './pick.js';
import { fixedBlocker, sweepHits, outlineOf } from './board.js';
import { initPhysics, createPhysics, syncPlates, settle, STEP } from './physics.js';
import { generateLevel, ALL_KINDS } from './generator.js';
import { BOX_LEVEL } from './levels/box.js';
import { stageLevel, chapterOf, START_VIEW as START_EULER } from './stages.js';
import { createProgress, deviceStorage } from './progress.js';
import { chapterView, chapterList, totalStars, finishesChapter, newKinds, KIND_NAMES } from './chapters.js';
import { createResume, restoreRecord, levelSignature, encodeSnapshot, decodeSnapshot, physicsAgrees } from './resume.js';
import { createSettings, clearRecords, SPEEDS, QUALITIES } from './settings.js';
import { randomLevel, dailyLevel, DIFFICULTIES, DIFFICULTY_IDS, MAX_RANDOM, isRandomNo, dateKey, isDateKey, dateLabel, dailyBestKey } from './random.js';
import { rate, clock, createPlayClock, createBests, MAX_STARS } from './rating.js';
import { createFeedback, tapCue, eventCue, endCue } from './feedback.js';
import { FX, unscrewPose, burstPose, dropPose, flyFrames, boxCloseTimeline, groundOf } from './effects.js';

// 既定はステージの進行（到達したステージから始める）。題名を押すと遊び方を選ぶ画面（ステージ・今日の1問・おまかせ）が出る。
// ?seed=番号（と &kind=box|shelf|table|car|house|animal）なら生成した盤面を1つだけ遊ぶ（進行は保存しない）。
// ?level=box なら M3 の固定の箱（物理の確かめ用。進行は保存しない）。
// ?stage=番号 ならそのステージから（確かめ用。クリアすれば進行は保存する）
// ?random=番号（と &diff=easy|normal|hard）ならおまかせのその番号、?daily=20261003 なら今日の1問のその日（?daily だけなら今日）（D6）
const query = new URLSearchParams(window.location.search);
const freeSeed = Number.parseInt(query.get('seed') ?? '', 10);
const fixedBox = query.get('level') === 'box';
const freePlay = fixedBox || Number.isFinite(freeSeed);
const progress = createProgress(freePlay ? null : deviceStorage());
// 設定（音・振動・回す速さ・画質・ネジまる）は端末の好みなので、自由な盤面でも保存する
const settings = createSettings(deviceStorage());
const quality = () => QUALITIES[settings.get('quality')];
const bests = createBests(freePlay ? null : deviceStorage());
// 遊んでいる途中の局面（E10）。URL で遊び方を決めていなければ、保存した局面の遊び方とステージから続ける
const resumeStore = createResume(freePlay ? null : deviceStorage());
const askedByUrl = ['stage', 'random', 'daily'].some((k) => query.has(k));
let pending = freePlay || askedByUrl ? null : resumeStore.load();
if (pending?.mode.type === 'random' && !DIFFICULTIES[pending.mode.difficulty]) pending = null;
if (pending?.mode.type === 'daily' && !isDateKey(pending.mode.key)) pending = null;
// ステージをまだ1本も外していなければ、続きではなく到達したステージから（おまかせ・今日の1問は外す前でも遊び方を続ける）
if (pending?.mode.type === 'stage' && !pending.path.length) pending = null;
const askedStage = Number.parseInt(query.get('stage') ?? '', 10);
let stage = Number.isInteger(askedStage) && askedStage >= 1 ? askedStage
  : pending?.mode.type === 'stage' ? pending.stage : progress.stage;

// 今の遊び方: { type: 'stage' } / { type: 'daily', key: 日付の数 } / { type: 'random', no: 番号, difficulty } / { type: 'free' }
const today = () => dateKey(new Date());
function askedMode() {
  if (freePlay) return { type: 'free' };
  if (query.has('daily')) {
    const key = Number.parseInt(query.get('daily'), 10);
    return { type: 'daily', key: isDateKey(key) ? key : today() };
  }
  const no = Number.parseInt(query.get('random') ?? '', 10);
  if (isRandomNo(no)) return { type: 'random', no, difficulty: DIFFICULTIES[query.get('diff')] ? query.get('diff') : 'normal' };
  return { type: 'stage' };
}
let mode = pending ? { ...pending.mode } : askedMode();
// おまかせの次の番号（端末の乱数で選ぶ。盤面は番号で決まる）
const freshRandomNo = () => 1 + Math.floor(Math.random() * MAX_RANDOM);

function levelFor() {
  if (fixedBox) return BOX_LEVEL;
  if (freePlay) {
    const kind = query.get('kind');
    return generateLevel(freeSeed, ALL_KINDS.includes(kind) ? { kind } : {});
  }
  if (mode.type === 'daily') return dailyLevel(mode.key);
  if (mode.type === 'random') return randomLevel(mode.no, mode.difficulty);
  return stageLevel(stage);
}
// 自己ベストを覚える名前（おまかせは 1 回きりなので覚えない）
const bestKey = () => (mode.type === 'stage' ? stage : mode.type === 'daily' ? dailyBestKey(mode.key) : null);
let LEVEL = levelFor();

const $ = (id) => document.getElementById(id);
// HUD と背景の色はテーマの表から入れる（CSS に色を二重に書かない）
for (const [name, value] of Object.entries(cssVariables())) document.documentElement.style.setProperty(name, value);
const canvas = $('stage');
const hint = $('hint');

// ---- 3D ----

// 画素の細かい画面（devicePixelRatio 2 以上。今のスマホのほとんど）では、縁のギザギザが目立たないので
// アンチエイリアス（MSAA）を切って、塗る量を減らす
const DPR = window.devicePixelRatio || 1;
// 背景の空とマットは CSS で描き、キャンバスは透明にして重ねる（3D で描くものを増やさない）
const renderer = new THREE.WebGLRenderer({ canvas, antialias: DPR < 2, alpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
// 日の当たる淡い面が白く飛ばないよう、高い所だけを寝かせるトーンマップ（E2。theme.js の exposure）
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = THEME.exposure;

// 描く解像度。DPR は 2 まで。動かしている間の1フレームが重ければ段階的に下げる（中級機で滑らかに動かすため）。
// 下げた解像度はその回のあいだ保つ（上げ下げを繰り返すと画面がちらつく）。設定の画質「軽い」なら初めから 1
let PIXEL_RATIOS = [];
let pixelLevel = 0;
function usePixelRatios() {
  PIXEL_RATIOS = quality().pixelRatios.filter((r) => r <= Math.max(1, DPR));
  pixelLevel = 0;
  renderer.setPixelRatio(PIXEL_RATIOS[0]);
}
usePixelRatios();
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

// 光: 半球光・主光・縁の光（theme.js）。影は描かない
{
  const { hemi, sun, rim } = THEME.lights;
  scene.add(new THREE.HemisphereLight(hemi.sky, hemi.ground, hemi.intensity));
  for (const l of [sun, rim]) {
    const light = new THREE.DirectionalLight(l.color, l.intensity);
    light.position.set(...l.position);
    scene.add(light);
  }
}
// 艶の映り込み。起動時に1回だけ、小さな空の景色を PMREM に焼いて全部の材質で使う
scene.environment = bakeEnvironment(renderer);

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
  placeGround();
  requestRender();
}

// マットと影（CSS の背景）を立体の真下に置く。立体を包む球の見かけの大きさで決めるので、寄り引きと盤面の大きさに付いてくる。
// 回したときは動かさない（球は回しても同じ。背景を毎フレーム描き直さない）
let boardRadius = 5;
const rootStyle = document.documentElement.style;
function placeGround() {
  camera.updateMatrixWorld();
  const c = screenOfPoint(new THREE.Vector3(0, 0, 0));
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(boardRadius);
  const R = Math.hypot(...screenOfPoint(right).map((v, i) => v - c[i]));
  const g = groundOf(c[1], R);
  rootStyle.setProperty('--mat-y', `${g.matY.toFixed(1)}px`);
  rootStyle.setProperty('--mat-rx', `${g.matRx.toFixed(1)}px`);
  rootStyle.setProperty('--mat-ry', `${g.matRy.toFixed(1)}px`);
  rootStyle.setProperty('--shade-y', `${g.shadeY.toFixed(1)}px`);
  rootStyle.setProperty('--shade-rx', `${g.shadeRx.toFixed(1)}px`);
  rootStyle.setProperty('--shade-ry', `${g.shadeRy.toFixed(1)}px`);
}
window.addEventListener('resize', resize);

const axis = new THREE.Vector3();
const turn = new THREE.Quaternion();
function rotateBy(dx, dy) {
  homing = null;
  revealing = null;
  const { axis: a, angle } = dragRotation(dx, dy, radPerPx(window.innerWidth, window.innerHeight) * SPEEDS[settings.get('speed')].k);
  if (angle === 0) return;
  // カメラから見た軸で回す（いまの向きに関係なく、指の方向へ回る）
  turn.setFromAxisAngle(axis.set(a[0], a[1], a[2]), angle);
  model.quaternion.premultiply(turn);
  requestRender();
}

function zoomBy(scale) {
  distance = zoomDistance(distance, scale, ZOOM.min, ZOOM.max);
  camera.position.set(0, 0, distance);
  placeGround();
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
    placeGround();
  });
  homing = t;
}

// ---- 時間で動くもの（ねじが抜ける、震える、板が落ちる） ----

// 演出の時計。ふだんは実時間で、スクリーンショットのスクリプトが遅くしたり止めたりできる（__app.timeScale）
let timeScale = 1, timeBase = 0, realBase = 0;
const fxClock = () => timeBase + (performance.now() - realBase) * timeScale;
function setTimeScale(k) {
  timeBase = fxClock();
  realBase = performance.now();
  timeScale = k;
}

const tweens = new Set();
function tween(duration, update, done) {
  const t = { start: fxClock(), duration, update, done };
  wake();
  tweens.add(t);
  requestRender();
  return t;
}
// 演出の時計で ms 待つ（ふだんは setTimeout 1回。時計を遅くしたり止めたりしている間は、それに合わせて待つ）
const wait = (ms) => new Promise((r) => {
  const end = fxClock() + ms;
  const tick = () => {
    const left = end - fxClock();
    if (left <= 0) r();
    else setTimeout(tick, timeScale > 0 ? left / timeScale : 50);
  };
  tick();
});

function runTweens() {
  const now = fxClock();
  for (const t of tweens) {
    const k = Math.min(1, (now - t.start) / t.duration);
    t.update(k);
    if (k >= 1) {
      tweens.delete(t);
      t.done?.();
    }
  }
}

// ねじが回りながら抜ける（右ねじなので頭から見て反時計回り、1回転でピッチ1つ分）。抜けきったら resolve する。
// 消すのはここではなく、箱やスロットへ飛ばす直前（launch）。外したねじは画面に1本しか出さない
function unscrew(obj) {
  const p0 = obj.position.clone();
  const out = new THREE.Vector3(0, 1, 0).applyQuaternion(obj.quaternion);
  const q0 = obj.quaternion.clone();
  const spin = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const r = obj.userData.radius;
  return new Promise((done) => tween(FX.unscrew.ms, (k) => {
    const { lift, angle, scale } = unscrewPose(k, r);
    obj.position.copy(p0).addScaledVector(out, lift);
    obj.quaternion.copy(q0).multiply(spin.setFromAxisAngle(yAxis, angle));
    obj.scale.setScalar(scale);
    obj.userData.lift = lift;   // スクリーンショットのスクリプトが抜けた量を見る
  }, done));
}

// 抜けたねじを画面の印へ持ち替える。立体のねじを消し、その位置と見かけの大きさ（印の何倍か）を返す
const FLYER_PX = 30;   // style.css の .flyer の大きさ
function launch(obj, color) {
  const at = screenOf(obj);
  const c = new THREE.Vector3(), w = new THREE.Vector3();
  obj.getWorldPosition(c);
  obj.getWorldScale(w);
  const edge = c.clone().addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), obj.userData.radius * w.x);
  const px = 2 * Math.hypot(...screenOfPoint(edge).map((v, i) => v - at[i]));
  obj.visible = false;
  puff(at, px, color);
  requestRender();
  return { at, scale: Math.min(2, Math.max(0.6, px / FLYER_PX)) };
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

// 最後のねじが抜けた板は、ぷくっと膨らんで白く光る（はじける）。見た目だけで、物理の形や動きは変えない。
// 材質は板ごとに1つ（scene.js）なので、光らせても描く回数は増えない
function burst(obj) {
  const mat = obj.material;
  const glow = mat.emissive.clone().set(0xffffff);
  tween(FX.burst.ms, (k) => {
    const { scale, glow: g } = burstPose(k);
    obj.scale.setScalar(scale);
    mat.emissive.copy(glow).multiplyScalar(g);
  }, () => {
    obj.scale.setScalar(1);
    mat.emissive.setScalar(0);
  });
}

// 親の最後のねじが外せないとき（子の部品がまだ付いている）、付いている子の部品を2回、橙色に染めて知らせる。
// 明るい板は光らせるだけだと白く飛ぶので、色そのものを寄せる。材質は板ごとに1つなので描く回数は増えない
function glowHolders(ids) {
  for (const id of ids) {
    const obj = board.plates.get(id);
    if (!obj || obj.userData.glowing) continue;
    obj.userData.glowing = true;
    const mat = obj.material, base = mat.color.clone(), col = new THREE.Color(THEME.held);
    tween(FX.held.ms, (k) => {
      const w = Math.sin(k * Math.PI * 2) ** 2;
      mat.color.copy(base).lerp(col, FX.held.tint * w);
      mat.emissive.copy(col).multiplyScalar(FX.held.glow * w);
    }, () => {
      mat.color.copy(base);
      mat.emissive.setScalar(0);
      obj.userData.glowing = false;
    });
  }
  requestRender();
}

// 物理で盤面の外まで落ちきった板は、立体から外して画面の下へ回りながら落とし、消す。
// 画面の中心から遠ざかる向きへ流す
function dropPlate(obj) {
  scene.attach(obj);   // 立体の回転から外し、世界の下（画面の下）へ落とす
  const p0 = obj.position.clone(), q0 = obj.quaternion.clone();
  const side = p0.x < 0 ? -1 : 1;
  // 回す軸は画面の奥行き（z）と横（x）の間。板ごとに少しずつ変える
  const axisOf = new THREE.Vector3(0.5, 0.2 * side, 1).normalize();
  const spin = new THREE.Quaternion();
  const mats = [];
  obj.traverse((o) => o.material && mats.push(o.material));
  for (const m of mats) {
    m.transparent = true;   // 板はふだん不透明で描いている（scene.js）。消えるときだけ透明にする
    m.needsUpdate = true;
  }
  tween(FX.drop.ms, (k) => {
    const { down, side: dx, angle, opacity } = dropPose(k, side);
    obj.position.set(p0.x + dx, p0.y - down, p0.z);
    obj.quaternion.copy(q0).premultiply(spin.setFromAxisAngle(axisOf, -angle));
    for (const m of mats) m.opacity = (m.userData.opacity0 ??= m.opacity) * opacity;
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
  d.style.setProperty('--drive', driveIcon(color));   // ねじ穴の形（設定「色ごと」のときだけ CSS が使う）
  return d;
}

function renderHud(hud, spawned = -1) {
  boxesEl.replaceChildren(...hud.boxes.map((b, i) => {
    const el = document.createElement('div');
    el.className = 'box' + (b ? '' : ' empty') + (i === spawned ? ' spawn' : '');
    if (b) {
      el.style.setProperty('--c', cssColor(b.color));
      el.style.setProperty('--drive', driveIcon(b.color));
    }
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

// 画面の from から to へ、ねじの印を回しながら飛ばす
function fly(color, from, to, ms, scale = 1.25) {
  const el = dot(color);
  el.classList.add('flyer');
  $('flyers').append(el);
  const anim = el.animate(flyFrames(from, to, scale), { duration: ms, easing: 'ease-in-out', fill: 'forwards' });
  return anim.finished.then(() => el.remove(), () => el.remove());
}

// 印が入った穴をはずませる（HUD を描き直した後の要素に付ける）
function landAt(ev, before) {
  const el = ev.type === 'toSlot' ? slotsEl.children[ev.slot]
    : ev.type === 'toBox' || ev.type === 'slotToBox' ? boxesEl.children[ev.box]?.children[before.boxes[ev.box].n]
    : null;
  el?.classList.add('land');
}

// 立体のねじが消えた所に、ポンと白い輪を出す（DOM なので 3D の描く回数は増えない）
function puff(at, px, color) {
  const el = document.createElement('div');
  el.className = 'puff';
  if (color) el.style.setProperty('--c', cssColor(color));
  el.style.setProperty('--s', `${Math.max(24, px * 1.6)}px`);
  el.style.left = `${at[0]}px`;
  el.style.top = `${at[1]}px`;
  $('flyers').append(el);
  el.addEventListener('animationend', () => el.remove());
}

// 満杯の箱から星を散らす
function sparkle(el) {
  const [x, y] = centerOf(el);
  for (let i = 0; i < 6; i++) {
    const s = document.createElement('div');
    s.className = 'spark';
    const a = (i / 6) * Math.PI * 2 + 0.3;
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    s.style.setProperty('--dx', `${Math.cos(a) * 46}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * 30}px`);
    $('flyers').append(s);
    s.addEventListener('animationend', () => s.remove());
  }
}

let flashTimer = 0;
function say(text, warn = false, ms = 1200) {
  hint.textContent = text;
  hint.classList.toggle('flash', warn);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    hint.textContent = '1本指で回す・ねじをタップで外す';
    hint.classList.remove('flash');
  }, ms);
}

// ---- 1局 ----

// 外せるかは今の板の姿勢で調べ、詰みは動かない板だけで決める（回せばどけられる板があるうちは詰みにしない）
let game = null;
let colorOf = null;
let snaps = [];      // 戻る用: 外した手ごとに、外す直前の物理の写し（game.history と同じ並び）
let safe = null;     // 戻る先を探す安全側の隠れ判定（盤面ごとに作る。初めて要るときに）
function newGameFor(level) {
  game = createGame(level, (id, st) => physics.blocker()(id, st), fixedBlocker(level));
  colorOf = new Map(level.screws.map((s) => [s.id, s.color]));
  safe = null;
}
newGameFor(LEVEL);

// クリアの評価に使う、この回の記録。時計は盤面を出した瞬間から、クリアか詰みのタップで止める。
// アプリが裏に回っている間は数えない。ヒントと戻るの回数は、それらの機能が countHint / countRewind を呼ぶ
const playClock = createPlayClock(() => performance.now());
const tally = { hints: 0, rewinds: 0 };
const countHint = () => { tally.hints++; };
const countRewind = () => { tally.rewinds++; };
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    playClock.pause();
    saveResume();   // Android は裏に回したアプリを落とすことがあるので、裏へ回る時に保存する
  } else if (game.status === 'playing' && !loading && !screenOpen()) playClock.resume();
});

let hud = hudOf(game.state);   // いま画面に出している箱とスロット（演出の途中の様子）
let queue = [];                // まだ見せていない出来事のまとまり { events, obj（外したねじ）, out（抜けきったら resolve）, status }
let playing = false;
let generation = 0;            // やり直しで古い演出を捨てるための番号

function screenOfPoint(world) {
  const p = world.clone().project(camera);
  return [(p.x + 1) / 2 * window.innerWidth, (1 - p.y) / 2 * window.innerHeight];
}
function screenOf(obj) {
  return screenOfPoint(obj.getWorldPosition(new THREE.Vector3()));
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
        await batch.out;   // 抜けきるまで待ち、立体のねじを消すのと同時に印を飛ばす
        if (gen !== generation) break;
        const { at, scale } = launch(batch.obj, colorOf.get(ev.screw));
        await fly(colorOf.get(ev.screw), at, centerOf(target), FX.fly.ms * fast, scale);
      } else if (ev.type === 'slotToBox') {
        const from = centerOf(slotsEl.children[ev.slot]);
        const to = centerOf(boxesEl.children[ev.box].children[before.boxes[ev.box].n]);
        slotsEl.children[ev.slot].replaceChildren();
        await fly(colorOf.get(ev.screw), from, to, FX.fly.slotMs * fast, 1);
      } else if (ev.type === 'boxFull') {
        // ふたが閉まりきる瞬間に音と振動、星を散らして箱は上へ抜ける
        const el = boxesEl.children[ev.box];
        const tl = boxCloseTimeline(fast);
        await wait(tl.lid);
        el.classList.add('closing');
        await wait(tl.cue - tl.lid);
        if (gen !== generation) break;
        cue('boxFull');
        sparkle(el);
        await wait(tl.leave - tl.cue);
        el.classList.add('done');
        await wait(tl.end - tl.leave);
      }
      if (gen !== generation) break;
      // 板の落ちる音はタップの瞬間に、箱が閉まる音はふたが閉まる瞬間に鳴らしている
      if (ev.type !== 'plate' && ev.type !== 'boxFull') cue(eventCue(ev));
      hud = after;
      renderHud(hud, ev.type === 'boxSpawn' ? ev.box : -1);
      landAt(ev, before);
      if (ev.type === 'boxSpawn') await wait(FX.box.spawn * fast);
    }
    if (gen === generation && batch.obj.visible) launch(batch.obj);   // 箱にもスロットにも飛ばなかったときの念のため
    if (gen === generation && batch.status !== 'playing' && !queue.length) showEnd(batch.status);
  }
  if (gen === generation) playing = false;
}

function tapScrew(id) {
  const obj = board.screws.get(id);
  const r = game.tap(id);
  cue(tapCue(r.reason));
  if (r.reason === 'blocked') {
    shake(obj);
    const by = movableBlockers(id);
    say(by === 'loose' ? '落ちた板に隠れている。回して払い落とそう'
      : by === 'hanging' ? 'ぶら下がった板に隠れている。回して動かそう'
      : 'ほかの板に隠れていて外せない', true);
  } else if (r.reason === 'held') {
    shake(obj);
    glowHolders(r.holders);
    say('付いている部品を先に外そう', true);
  } else if (r.reason === 'full') {
    shake(obj);
    slotsEl.classList.add('warn');
    setTimeout(() => slotsEl.classList.remove('warn'), 400);
    say('待機スロットがいっぱい', true);
  } else if (r.reason === 'ok') {
    snaps.push(physics.snapshot());   // 物理はまだ外す前のまま（syncPlates の前）
    if (hintRing?.parent === obj) clearHintRing();
    const out = unscrew(obj);
    syncPlates(physics, game.state);   // 1本になった板はぶら下がり、0本の板は落ち始める
    const fallen = r.events.filter((ev) => eventCue(ev) === 'plate');
    for (const ev of fallen) burst(board.plates.get(ev.plate));
    // 落ちる板のうち一番大きいものの大きさで、コトンの音程を決める（大きい板ほど低い）
    if (fallen.length) cue('plate', { size: Math.max(...fallen.map((ev) => plateSize(ev.plate))) });
    requestRender();
    if (r.status !== 'playing') playClock.pause();   // 時間は決着のタップまで（演出を待つ間は数えない）
    queue.push({ events: r.events, obj, out, status: r.status });
    play();
    saveResume();
  }
  showUndo();
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

// ---- ヒント ----

// 今の局面から解ける手順を探し（game.hint()）、最初に外すねじに金色の輪を5秒出す（2D 版と同じ）。
// 輪はねじの子なので、ねじと一緒に回り、外せば一緒に消える。板の奥でも見えるよう、奥行きを無視して手前に描く。
// 戻る（解ける所まで戻る）の分かれ目のねじにも、同じ輪を赤で出す。輪は一度に1つ
const HINT_MS = 5000;
let hintRing = null;
function clearHintRing() {
  hintRing?.removeFromParent();
  hintRing = null;
}

function ringScrew(id, color, ms) {
  const obj = board.screws.get(id);
  clearHintRing();
  const rad = obj.userData.radius;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(rad * 1.6, rad * 0.24, 8, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false }),
  );
  ring.rotation.x = Math.PI / 2;   // 輪の面をねじの軸（+Y）に垂直に
  ring.position.y = rad * 0.6;     // 頭の高さ
  ring.renderOrder = 10;
  ring.userData.hint = true;
  ring.userData.color = color;
  obj.add(ring);
  hintRing = ring;
  tween(ms, (k) => {
    if (hintRing !== ring) return;
    const pulse = 0.5 + 0.5 * Math.sin(k * ms / 1000 * 9);
    ring.scale.setScalar(1 + 0.18 * pulse);
    ring.material.opacity = (0.65 + 0.35 * pulse) * Math.min(1, (1 - k) * 6);
  }, () => {
    if (hintRing === ring) clearHintRing();
    ring.geometry.dispose();
    ring.material.dispose();
  });
  return obj;
}

function showHint() {
  if (!$('overlay').hidden || loading) return;
  // 見えているねじ（こちら向きで、手前の板に隠れていない）から選べればそちらを指す
  const r = game.hint(visibleScrews().map((s) => s.id));
  if (!r.screw) {
    if (r.reason === 'none') showDeadEnd();
    else if (r.reason === 'budget') say('手順を探しきれなかった', true, 3000);
    return;
  }
  countHint();   // クリアの評価で星を1つ減らす
  saveResume();
  const id = r.screw;
  const obj = ringScrew(id, THEME.hint, HINT_MS);
  cue('hint');
  // 今は回して払える板に隠れているなら、先にそれを知らせる。ねじが向こう向きなら回して探すよう添える
  const by = physics.blocker()(id, game.state) ? movableBlockers(id) : null;
  const toward = new THREE.Vector3(0, 1, 0).transformDirection(obj.matrixWorld);
  const facing = toward.dot(camera.position.clone().sub(obj.getWorldPosition(new THREE.Vector3()))) > 0;
  say(by === 'loose' ? '金色の輪のねじ。先に回して落ちた板を払い落とそう'
    : by === 'hanging' ? '金色の輪のねじ。先に回してぶら下がった板をどけよう'
    : facing ? '金色の輪のねじを外そう' : '金色の輪のねじは向こう側。回して探そう', false, HINT_MS);
}

function showEnd(status) {
  const ov = $('overlay');
  ov.className = status;
  const cleared = status === 'cleared';
  seatMascot(true);
  cue(endCue(status));
  // クリアしたらその場で次のステージを保存する（ボタンを押す前に閉じても、次は続きから）
  const before = progress.stage;
  if (cleared && mode.type === 'stage') progress.cleared(stage);
  $('end-title').textContent = !cleared ? '詰み'
    : mode.type === 'stage' ? `ステージ ${stage} クリア！`
    : mode.type === 'daily' ? '今日の1問 クリア！'
    : 'クリア！';
  $('end-text').textContent = cleared ? 'すべての箱を埋めた' : '外せるねじが無くなった';
  showRating(cleared);
  // 章の 10 番目を初めてクリアしたら、章の星の合計と次の章の予告（E9）。「次へ」で次の章の頭をお披露目して開く
  const chapterDone = cleared && mode.type === 'stage' && !freePlay && finishesChapter(stage, before);
  showChapterEnd(chapterDone);
  const next = cleared && !freePlay;
  $('next').hidden = !next;
  // ステージは次のステージへ、おまかせは同じ難しさの次の1問へ、今日の1問はステージの続きへ
  $('next').textContent = mode.type === 'random' ? '次のおまかせ' : mode.type === 'daily' ? 'ステージの続きへ'
    : chapterDone ? `第${chapterOf(stage + 1).no}章へ` : '次のステージへ';
  // 詰みからは、解ける所まで一気に戻すか、1手戻す
  showRewindButtons(!cleared);
  $('resume').hidden = true;
  $('again').textContent = cleared ? 'もう一度' : 'やり直す';
  $('again').classList.toggle('sub', next || !cleared);
  ov.hidden = false;
  showUndo();
}

// クリアの星と時間、自己ベスト。詰みでは出さない
let lastRating = null;
function showRating(cleared) {
  const starsEl = $('end-stars');
  const scoreEl = $('end-score');
  starsEl.hidden = !cleared;
  scoreEl.hidden = !cleared;
  if (!cleared) return;
  const seconds = playClock.seconds;
  const r = rate({ screws: LEVEL.screws.length, seconds, hints: tally.hints, rewinds: tally.rewinds });
  lastRating = { ...r, seconds, hints: tally.hints, rewinds: tally.rewinds, best: null };
  starsEl.setAttribute('aria-label', `星 ${r.stars} つ`);
  starsEl.replaceChildren(...Array.from({ length: MAX_STARS }, (_, i) => {
    const el = document.createElement('span');
    el.textContent = '★';
    if (i < r.stars) {
      el.className = 'on';
      el.style.animationDelay = `${0.35 + i * 0.18}s`;
    }
    return el;
  }));
  const lines = [`時間 ${clock(seconds)}（目安 ${clock(r.par)}）`];
  const used = [tally.hints && `ヒント ${tally.hints} 回`, tally.rewinds && `戻る ${tally.rewinds} 回`].filter(Boolean);
  if (used.length) lines.push(used.join('・'));
  if (bestKey() !== null) {
    const b = bests.record(bestKey(), { stars: r.stars, seconds });
    lastRating.best = b;
    lines.push(b.improved
      ? (b.old ? '自己ベスト更新！' : '')
      : `自己ベスト ${'★'.repeat(b.old.stars)}${'☆'.repeat(MAX_STARS - b.old.stars)} ${clock(b.old.seconds)}`);
  }
  scoreEl.replaceChildren(...lines.filter(Boolean).map((t) => {
    const el = document.createElement('span');
    el.textContent = t;
    if (t.startsWith('自己ベスト更新')) el.className = 'new-best';
    return el;
  }));
}

// 章の終わり（E9）: 章の星の合計と、次の章の名前と新しい題材。ネジまるはもう1回跳んで大喜び、カードの周りに星を散らす
let introChapter = null;   // 「次へ」で開く章の頭をお披露目するか（章の番号）
function showChapterEnd(on) {
  const el = $('end-chapter');
  el.hidden = !on;
  introChapter = null;
  if (!on) return;
  const done = chapterView(chapterOf(stage).no, progress.stage, bests);
  const coming = chapterView(done.no + 1, progress.stage, bests);
  const fresh = newKinds(coming.no).map((k) => KIND_NAMES[k]);
  introChapter = coming.no;
  const row = (cls, text) => {
    const e = document.createElement('span');
    e.className = cls;
    e.textContent = text;
    return e;
  };
  el.classList.toggle('perfect', done.perfect);
  el.replaceChildren(
    row('ce-head', `第${done.no}章「${done.title}」 クリア！`),
    row('ce-stars', `章の星 ★ ${done.stars} / ${done.max}`),
    row('ce-next', `次は 第${coming.no}章「${coming.title}」`),
    row('ce-kinds', fresh.length ? `新しい題材: ${fresh.join('・')}` : `${coming.kinds.map((k) => KIND_NAMES[k]).join('・')} の総まとめ`),
  );
  if (done.perfect) el.querySelector('.ce-stars').insertAdjacentHTML('afterbegin', CROWN_SVG);
  const g = generation;
  wait(ACTIONS_WIN_MS).then(() => {
    if (g === generation && !$('overlay').hidden) mascot.react('cleared');
  });
  confetti($('overlay').querySelector('.card'));
}
// 成功の跳び（mascot-motion.js の win、3.3 秒）が終わる頃にもう1回跳ばせる
const ACTIONS_WIN_MS = 3300;
// カードの周りから星を散らす（満杯の箱の sparkle を大きく、色を回して）
function confetti(card) {
  const r = card.getBoundingClientRect();
  const colors = Object.values(THEME.screwColors);
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('div');
    s.className = 'spark confetti';
    const a = (i / 18) * Math.PI * 2;
    s.style.left = `${r.left + r.width / 2 + Math.cos(a) * r.width * 0.42}px`;
    s.style.top = `${r.top + r.height * 0.45 + Math.sin(a) * r.height * 0.42}px`;
    s.style.setProperty('--dx', `${Math.cos(a) * 70}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * 70 - 20}px`);
    s.style.setProperty('--c', colors[i % colors.length]);
    s.style.animationDelay = `${(i % 6) * 0.12}s`;
    $('overlay').append(s);   // 暗い幕（#overlay）より手前に出す
    s.addEventListener('animationend', () => s.remove());
  }
}

// 章の頭を開いたとき: 立体を1回転させながら出し、章の名前の帯を出す（新しい題材のお披露目）
let revealing = null;
function revealChapter(no) {
  const ch = chapterView(no, progress.stage, bests);
  const banner = document.createElement('div');
  banner.className = 'ch-banner';
  const small = document.createElement('small');
  small.textContent = `第${no}章`;
  const big = document.createElement('b');
  big.textContent = ch.title;
  banner.append(small, big);
  $('flyers').append(banner);
  banner.addEventListener('animationend', () => banner.remove());
  const to = model.quaternion.clone(), spin = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const t = tween(1400, (k) => {
    if (revealing !== t) return;
    const e = 1 - (1 - k) ** 3;
    model.quaternion.copy(to).premultiply(spin.setFromAxisAngle(up, -2 * Math.PI * (1 - e)));
  });
  revealing = t;
}

// 題名（押すと遊び方を選ぶ画面）と、その下の小さな行
function modeTitle(m = mode) {
  if (fixedBox) return ['固定の箱', ''];
  if (freePlay) return [`シード ${freeSeed}`, ''];
  if (m.type === 'daily') return ['今日の1問', dateLabel(m.key)];
  if (m.type === 'random') return [`おまかせ・${DIFFICULTIES[m.difficulty].label}`, `#${m.no}`];
  // 章（E8）と、章の中の何番目か
  const ch = chapterOf(stage);
  return [`ステージ ${stage}`, `第${ch.no}章「${ch.title}」 ${ch.pos}/${ch.last - ch.first + 1}`];
}
function showStage() {
  const [title, sub] = modeTitle();
  $('title').textContent = title;
  $('subtitle').textContent = sub;
  $('subtitle').hidden = !sub;
  $('mode-btn').disabled = freePlay;
}

// 遊び方を切り替えて盤面を作る。盤面の生成に少しかかるので、先に表示を切り替えてから作る
let loading = false;
async function loadMode(next) {
  if (loading) return;
  loading = true;
  mode = next;
  const intro = mode.type === 'stage' ? introChapter : null;
  introChapter = null;
  $('overlay').hidden = true;
  $('menu').hidden = true;
  $('stages').hidden = true;
  showStage();
  playClock.pause();
  hint.textContent = `${mode.type === 'stage' ? modeTitle()[0] : modeTitle().join(' ').trim()} を組み立て中…`;
  await wait(30);
  LEVEL = levelFor();
  levelSig = null;
  newGameFor(LEVEL);
  homing = null;
  model.quaternion.setFromEuler(START_VIEW);
  zoomBy(distance / START_DISTANCE);
  restart();
  hint.textContent = '1本指で回す・ねじをタップで外す';
  loading = false;
  if (intro && chapterOf(stage).first === stage) revealChapter(intro);
  showUndo();
  saveResume();
}

// クリアの画面の「次へ」
function nextStage() {
  if (mode.type === 'random') return loadMode({ type: 'random', no: freshRandomNo(), difficulty: mode.difficulty });
  if (mode.type === 'stage') stage++;
  else stage = progress.stage;
  return loadMode({ type: 'stage' });
}

// ---- 遊び方を選ぶ画面（D6） ----

function openMenu() {
  if (freePlay || loading) return;
  $('m-stage-sub').textContent = `ステージ ${progress.stage} まで・★ ${totalStars(progress.stage, bests)}`;
  const key = today();
  const best = bests.get(dailyBestKey(key));
  $('m-daily-sub').textContent = best
    ? `${dateLabel(key)}・クリア ${'★'.repeat(best.stars)}${'☆'.repeat(MAX_STARS - best.stars)} ${clock(best.seconds)}`
    : `${dateLabel(key)}・まだ`;
  playClock.pause();
  $('menu').hidden = false;
}
function closeMenu() {
  $('menu').hidden = true;
  if (game.status === 'playing' && !document.hidden) playClock.resume();
}
function pickMode(next) {
  // 今遊んでいるものを選んだら、そのまま続ける
  const same = next.type === mode.type && (next.type === 'stage' ? stage === progress.stage : next.type === 'daily' && next.key === mode.key);
  if (same) return closeMenu();
  if (next.type === 'stage') stage = progress.stage;
  return loadMode(next);
}
// 遊び方・ステージ一覧・設定のどれかが開いているか（開いている間は遊んだ時間を数えない）
const screenOpen = () => !$('menu').hidden || !$('stages').hidden || !$('settings').hidden;

// ---- ステージ一覧（E9）: 遊び方の画面の「ステージ」から。章ごとにステージの番号と自己ベストの星を並べる ----
// クリア済みのステージは選んで遊び直せる（到達は戻らない。progress.cleared は先へしか進めない）。まだのステージは鍵

const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';
const CROWN_SVG = '<svg class="crown" viewBox="0 0 24 24" aria-label="全部 ★3"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/></svg>';
function openStages() {
  if (freePlay || loading) return;
  const reached = progress.stage;
  $('st-total').textContent = `星の合計 ★ ${totalStars(reached, bests)}`;
  $('st-continue-sub').textContent = `ステージ ${reached}`;
  const playingNow = mode.type === 'stage' ? stage : null;
  const list = $('st-list');
  list.replaceChildren(...chapterList(reached, bests).map((ch) => {
    const sec = document.createElement('section');
    sec.className = `chap${ch.open ? '' : ' locked'}${ch.done ? ' done' : ''}${ch.perfect ? ' perfect' : ''}`;
    sec.dataset.chapter = ch.no;
    const head = document.createElement('header');
    const no = document.createElement('small');
    no.textContent = `第${ch.no}章`;
    const name = document.createElement('b');
    name.textContent = ch.open ? ch.title : '？？？';
    const sum = document.createElement('span');
    sum.className = 'ch-sum';
    sum.textContent = ch.open ? `★ ${ch.stars}/${ch.max}` : '';
    if (!ch.open) sum.innerHTML = LOCK_SVG;
    // 全部 ★3 の章には王冠
    else if (ch.perfect) sum.insertAdjacentHTML('afterbegin', CROWN_SVG);
    head.append(no, name, sum);
    const grid = document.createElement('div');
    grid.className = 'ch-grid';
    grid.append(...ch.stages.map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `st ${s.state}${s.n === playingNow ? ' playing' : ''}`;
      b.dataset.n = s.n;
      if (s.state === 'locked') {
        b.disabled = true;
        b.setAttribute('aria-label', `ステージ ${s.n}（まだ）`);
        b.innerHTML = LOCK_SVG;
        return b;
      }
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = s.n;
      const st = document.createElement('span');
      st.className = 'ss';
      st.textContent = s.state === 'next' ? 'つぎ' : '★'.repeat(s.stars) + '☆'.repeat(MAX_STARS - s.stars);
      b.setAttribute('aria-label', s.state === 'next' ? `ステージ ${s.n}（次に遊ぶ）` : `ステージ ${s.n}（星 ${s.stars}）`);
      b.append(n, st);
      return b;
    }));
    sec.append(head, grid);
    return sec;
  }));
  $('menu').hidden = true;
  $('stages').hidden = false;
  // 今遊んでいる（無ければ到達した）ステージの章を見せる
  const focus = list.querySelector('.st.playing') ?? list.querySelector('.st.next');
  focus?.closest('.chap')?.scrollIntoView({ block: 'start' });
}
function closeStages() {
  $('stages').hidden = true;
  openMenu();
}
// ステージ n を遊ぶ。今遊んでいる途中のステージなら、そのまま続ける
function playStage(n) {
  if (mode.type === 'stage' && stage === n && game.status === 'playing') {
    $('stages').hidden = true;
    if (!document.hidden) playClock.resume();
    return;
  }
  stage = n;
  return loadMode({ type: 'stage' });
}

// 演出を捨てて盤面を作り直す
function rebuildBoard() {
  generation++;
  clearHintRing();
  queue = [];
  playing = false;
  for (const t of tweens) tweens.delete(t);
  $('flyers').replaceChildren();
  if (board) {
    model.remove(board.root);
    for (const p of board.plates.values()) if (p.parent === scene) scene.remove(p);
  }
  board = buildBoard(LEVEL, { knurl: quality().knurl, contact: quality().contact, drives: settings.get('drives') });
  model.add(board.root);
  // 空とマットの色は盤面の種類で変える（E2。theme.js の skies）
  for (const [name, value] of Object.entries(skyVariables(LEVEL.meta?.kind))) rootStyle.setProperty(name, value);
  stepClock = 0;
}

function restart() {
  rebuildBoard();
  boardRadius = new THREE.Box3().setFromObject(board.root).getBoundingSphere(new THREE.Sphere()).radius;
  placeGround();
  physics?.free();
  physics = createPhysics(LEVEL);
  game.restart();
  snaps = [];
  tally.hints = 0;
  tally.rewinds = 0;
  playClock.reset();
  if (!document.hidden) playClock.resume();
  mascot.reset();
  seatMascot(false);
  syncPlates(physics, game.state);
  showState();
  saveResume();
}

// 今の局面（game と physics）を画面に出す。外したねじは隠し、消えた板は外し、動ける板は今の姿勢に置く
function showState() {
  for (const [id, s] of board.screws) s.visible = game.state.where[id] === 'board';
  for (const [id, obj] of board.plates) if (physics.mode(id) === 'gone') board.root.remove(obj);
  for (const [id, pose] of Object.entries(physics.poses())) {
    const obj = board.plates.get(id);
    obj.position.set(...pose.position);
    obj.quaternion.set(...pose.quaternion);
  }
  hud = hudOf(game.state);
  renderHud(hud);
  $('overlay').hidden = true;
  showStage();
  showUndo();
  requestRender();
}

// ---- 戻る ----

// k 手目を外す直前へ戻す（ルールの状態と物理の写しを一緒に）。戻した局面は、そのとき揺れていた板は揺れの途中から続く
// 戻すたびにクリアの評価の「戻る」を1回数える。詰みから戻したときは、止めていた時計を動かし、ネジまるを左下へ戻す
function rewindTo(k) {
  const ended = game.status !== 'playing';
  if (!game.rewind(k)) return false;
  // 続きから戻した局面より前の手は、物理の写しを保存していないので、ルールの状態から姿勢を作り直す
  if (snaps[k]) physics.restore(snaps[k]);
  else resettle(game.state);
  snaps.length = k;
  countRewind();
  if (ended) {
    if (!document.hidden) playClock.resume();
    mascot.reset();
    seatMascot(false);
  }
  rebuildBoard();
  showState();
  cue('undo');
  saveResume();
  return true;
}

// ---- 続きから遊ぶ（E10） ----

// 今の局面を保存する。外す手・戻す・ヒント・物理が落ち着いた時・裏へ回る時に呼ぶ。
// クリアしたら消す（次に開くとステージの続きから。おまかせ・今日の1問の後もステージへ）
let levelSig = null;
function saveResume() {
  if (!started || loading || freePlay || pending) return;
  if (game.status === 'cleared') {
    resumeStore.clear();
    return;
  }
  levelSig ??= levelSignature(LEVEL);
  let snap = null;
  try {
    snap = encodeSnapshot(physics.snapshot());
  } catch {
    snap = null;   // 写せなければ、戻すときにルールの状態から姿勢を作る
  }
  resumeStore.save({
    mode: { ...mode },
    stage,
    sig: levelSig,
    path: game.path,
    seconds: playClock.seconds,
    hints: tally.hints,
    rewinds: tally.rewinds,
    view: { q: model.quaternion.toArray(), d: distance },
    physics: snap,
  });
}
addEventListener('pagehide', saveResume);

// 物理をルールの状態から作り直し、今の重力の向きで落ち着くまで進める（写しが無い・使えないとき）
function resettle(state) {
  try {
    physics?.free();
  } catch {
    // 写しから戻すのに失敗した物理は、すでに壊れていることがある
  }
  physics = createPhysics(LEVEL);
  syncPlates(physics, state);
  applyDown();
  settle(physics);
}

// 保存した局面へ戻す。戻せなければ false（盤面は restart() の最初の局面のまま）
function resumeFrom(record) {
  const r = restoreRecord(record, LEVEL);
  if (!r) return false;
  game.resume(r, r.path);
  const q = r.view?.q;
  if (Array.isArray(q) && q.length === 4 && q.every(Number.isFinite) && Math.hypot(...q) > 0.5) model.quaternion.fromArray(q).normalize();
  if (Number.isFinite(r.view?.d) && r.view.d > 0) zoomBy(distance / r.view.d);
  let restored = false;
  const snap = decodeSnapshot(r.physics);
  if (snap) {
    try {
      physics.restore(snap);
      restored = physicsAgrees(game.state, (id) => physics.mode(id));
    } catch {
      restored = false;
    }
  }
  if (!restored) resettle(game.state);
  snaps = r.path.map(() => null);
  tally.hints = r.hints;
  tally.rewinds = r.rewinds;
  playClock.set(r.seconds);
  if (game.status === 'playing' && !document.hidden) playClock.resume();
  rebuildBoard();
  showState();
  if (game.status !== 'playing') showEnd(game.status);
  else if (r.path.length) say('続きから', false, 2000);
  resumed = { moves: r.path.length, physics: restored ? 'snapshot' : 'settled' };
  return true;
}
let resumed = null;   // 続きから戻したときの様子（スクリーンショットのスクリプトが見る）

function showRewindButtons(on) {
  $('rewind').hidden = !on;
  $('rewind').disabled = false;
  $('rewind').textContent = '解ける所まで戻る';
  $('back1').hidden = !on;
}

function showUndo() {
  $('undo').disabled = loading || !game.canUndo || !$('overlay').hidden;
}

function undoOne() {
  if (loading || !game.canUndo) return;
  if (rewindTo(game.moves - 1)) say('1手戻した');
}

const MARK_MS = 4000;   // 分かれ目の赤い輪を出しておく時間

// 詰みや行き止まりから、解ける手順が残っている一番新しい局面へ一気に戻す。分かれ目のねじ（そこで外したために解けなくなった）に赤い輪を出す
async function rewindToSolvable() {
  if (loading || !game.canUndo) return;
  const btn = $('rewind');
  btn.disabled = true;
  btn.textContent = '戻る先を探しています…';
  await wait(30);   // 文字を描いてから探す
  safe ??= safeBlocker(LEVEL);
  const before = game.moves;
  const { k } = rewindPoint(LEVEL, [...game.history, game.state], safe);
  const screw = game.path[k];
  if (!rewindTo(k)) return;
  ringScrew(screw, THEME.undo, MARK_MS);
  say(k ? `${before - k}手戻した。赤い輪のねじが分かれ目` : '最初まで戻した。赤い輪のねじが分かれ目', false, MARK_MS);
}

// ヒントで解ける手順が見つからなかったとき（行き止まり）。解ける所まで戻すか、このまま続けるかを選ぶ。
// このゲームの詰み（スロットが満杯で、出ている箱の色のねじが全部、動かない板に隠れている）はめったに起きないので、
// 戻る先へ案内する入口はここが主になる
function showDeadEnd() {
  if (!game.canUndo) {
    say('ここから解ける手順が見つからない。やり直そう', true, 3000);
    return;
  }
  const ov = $('overlay');
  ov.className = 'deadend';
  $('end-title').textContent = '行き止まり';
  $('end-text').textContent = 'ここから解ける手順が見つからない';
  $('end-stars').hidden = true;
  $('end-score').hidden = true;
  $('next').hidden = true;
  showRewindButtons(true);
  $('resume').hidden = false;
  $('again').textContent = 'やり直す';
  $('again').classList.add('sub');
  ov.hidden = false;
  showUndo();
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
$('hint-btn').addEventListener('click', showHint);
$('home').addEventListener('click', goHome);

// 音・BGM・振動（入り切りは設定が持つ。BGM は最初のタッチで始まり、裏に回ると止まる）
const feedback = createFeedback(settings);
// 板の大きさ（面の面積の平方根）。落ちる音の音程に使う
function plateSize(id) {
  const p = LEVEL.plates.find((q) => q.id === id);
  if (!p) return undefined;
  // 円柱（D4 の車輪など）は size を持たないので、円の面積から。家の屋根（三角）のように outline で形を決めた板は、多角形の面積から
  if (p.shape === 'cylinder') return Math.sqrt(Math.PI) * p.radius;
  const ol = outlineOf(p);
  const area = Math.abs(ol.reduce((a, [x, y], i) => a + x * ol[(i + 1) % ol.length][1] - ol[(i + 1) % ol.length][0] * y, 0)) / 2;
  return Math.sqrt(area);
}

// マスコット「ネジまる」（D3）。左下の小さなキャンバスに別の描き手で描き、演出の時計で動く。
// 合図（cue）を音と振動と同じ名前で受けて、成功・失敗・箱が満杯・外せないねじに反応する（音を切っていても動く）
const mascot = createMascot($('mascot'), {
  clock: fxClock, environment: bakeEnvironment, maxRatio: quality().mascotRatio, idleEvery: quality().idleEvery,
});
function cue(name, opts) {
  feedback.cue(name, opts);
  if (name) mascot.react(name);
}
// 終わりの画面では、ネジまるをカードの上に大きく乗せる（成功・失敗の動きを見せる）。やり直すと左下へ戻す
function seatMascot(onCard) {
  const c = $('mascot');
  if (onCard) $('overlay').querySelector('.card').prepend(c);
  else document.body.insertBefore(c, $('flyers'));
}
// 右下の音のボタン: 音だけを入り切りする（振動は設定の画面で）
const soundButton = $('sound');
function showSound() {
  const on = settings.get('sound');
  soundButton.classList.toggle('off', !on);
  soundButton.setAttribute('aria-pressed', String(on));
  soundButton.setAttribute('aria-label', on ? '音を切る' : '音を入れる');
}
soundButton.addEventListener('click', () => {
  settings.set('sound', !settings.get('sound'));   // 入れたら確かめの音を鳴らす（applySetting。マスコットは動かさない）
});
showSound();

// ---- 設定の画面（遊び方の画面の「設定」から） ----
// 並んだボタン（.seg）の data-key が設定の名前、各ボタンの data-v が値（'true' / 'false' は真偽値）
const settingsEl = $('settings');
const segValue = (b) => (b.dataset.v === 'true' ? true : b.dataset.v === 'false' ? false : b.dataset.v);
function showSettings() {
  for (const seg of settingsEl.querySelectorAll('.seg')) {
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(segValue(b) === settings.get(seg.dataset.key)));
  }
}
for (const seg of settingsEl.querySelectorAll('.seg')) {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) settings.set(seg.dataset.key, segValue(b));
  });
}
// 設定が変わったら、すぐ画面に効かせる
function applySetting(name, value) {
  if (name === 'sound') {
    showSound();
    feedback.sample('sound');
  } else if (name === 'vibrate') {
    feedback.sample('vibrate');
  } else if (name === 'quality') {
    usePixelRatios();
    resize();
    if (board) {
      setKnurl(board, quality().knurl);
      setContact(board, quality().contact);
    }
    mascot.setQuality({ maxRatio: quality().mascotRatio, idleEvery: quality().idleEvery });
    requestRender();
  } else if (name === 'mascot') {
    mascot.enabled = value;
    document.body.classList.toggle('no-mascot', !value);
  } else if (name === 'drives') {
    document.body.classList.toggle('drives', value);
    if (board) setDrives(board, value);
    requestRender();
  }
  showSettings();
}
settings.onChange(applySetting);
applySetting('mascot', settings.get('mascot'));
applySetting('drives', settings.get('drives'));

function openSettings() {
  disarmClear();
  showSettings();
  $('menu').hidden = true;
  settingsEl.hidden = false;
}
function closeSettings() {
  settingsEl.hidden = true;
  openMenu();
}
// 記録を消す: 1回目の押しで確かめの文字に変え、4 秒以内にもう一度押したら消して最初から開き直す
let clearArmed = null;
function disarmClear() {
  clearTimeout(clearArmed);
  clearArmed = null;
  $('s-clear').classList.remove('armed');
  $('s-clear').textContent = '記録を消す';
}
$('s-clear').addEventListener('click', () => {
  if (!clearArmed) {
    $('s-clear').classList.add('armed');
    $('s-clear').textContent = 'もう一度押すと消えます';
    clearArmed = setTimeout(disarmClear, 4000);
    return;
  }
  disarmClear();
  clearRecords(deviceStorage());
  window.location.replace(window.location.pathname);
});
$('s-close').addEventListener('click', closeSettings);
$('again').addEventListener('click', restart);
$('next').addEventListener('click', nextStage);
$('mode-btn').addEventListener('click', openMenu);
$('m-close').addEventListener('click', closeMenu);
$('m-settings').addEventListener('click', openSettings);
$('m-stage').addEventListener('click', openStages);
$('st-continue').addEventListener('click', () => playStage(progress.stage));
$('st-close').addEventListener('click', closeStages);
$('st-list').addEventListener('click', (e) => {
  const b = e.target.closest('button.st');
  if (b && !b.disabled) playStage(Number(b.dataset.n));
});
$('m-daily').addEventListener('click', () => pickMode({ type: 'daily', key: today() }));
for (const d of DIFFICULTY_IDS) $(`m-${d}`).addEventListener('click', () => pickMode({ type: 'random', no: freshRandomNo(), difficulty: d }));
$('undo').addEventListener('click', undoOne);
$('back1').addEventListener('click', undoOne);
$('rewind').addEventListener('click', rewindToSolvable);
$('resume').addEventListener('click', () => {
  $('overlay').hidden = true;
  showUndo();
});

// ---- 物理を進める ----

const qInv = new THREE.Quaternion();
const down = new THREE.Vector3();
let stepClock = 0;      // 物理に渡していない時間（秒）
let lastFrame = 0;
const MAX_STEPS = 4;    // 1フレームで進める刻みの上限（遅い端末ではゆっくり動く。結果は刻みの数で決まる）

// 画面の下（世界の -y）を、盤面の座標に直して重力の向きにする
function applyDown() {
  qInv.copy(model.quaternion).invert();
  down.set(0, -1, 0).applyQuaternion(qInv);
  physics.setDown([down.x, down.y, down.z]);
}

function stepPhysics(now) {
  applyDown();
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
    runTweens();
    needsRender = true;
  }
  if (needsRender) {
    needsRender = false;
    renderer.render(scene, camera);
    watchFrameTime(now, lastDraw);
    lastDraw = now;
  }
  // 物理が動いているか演出の途中なら次のフレームも。止まっていればここで止め、次の操作（requestRender）で再開する
  const moving = physics.moving();
  if (wasMoving && !moving) saveResume();   // 板が落ち着いた姿勢を保存する
  wasMoving = moving;
  if (moving || tweens.size || needsRender) wake();
  else lastFrame = 0;
}
let wasMoving = false;

async function start() {
  await initPhysics();
  started = true;
  const record = pending;
  restart();
  pending = null;
  if (record) resumeFrom(record);
  saveResume();
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
  get stage() { return mode.type === 'stage' ? stage : null; },
  get mode() { return { ...mode }; },
  openMenu,
  openSettings,
  openStages,
  get reached() { return progress.stage; },
  settings: { get: (k) => settings.get(k), all: () => settings.all() },
  get pixelRatio() { return renderer.getPixelRatio(); },
  get mascotDrawing() { return mascot.enabled; },
  loadMode,
  get rendered() { return !loading && !needsRender && !tweens.size && !playing && !physics?.moving(); },
  // rendered が false の理由（スクリーンショットのスクリプトが待ちきれなかったとき用）
  why: () => ({ loading, needsRender, tweens: tweens.size, playing, moving: physics?.moving(), modes: window.__app.plateModes() }),
  // 立体の向きを Euler で直接決める（スクリーンショットで同じ向きから撮るため）
  view(x, y, z, d = distance) {
    model.rotation.set(x, y, z);
    zoomBy(distance / d);
  },
  plateModes: () => Object.fromEntries(LEVEL.plates.map((p) => [p.id, physics.mode(p.id)])),
  platePoses: () => physics.poses(),
  tapScrew,
  undo: undoOne,
  rewind: rewindToSolvable,
  get moves() { return game.moves; },
  // 続きから戻したか（{ moves: 戻した手の数, physics: 'snapshot' | 'settled' }）。戻していなければ null
  get resumed() { return resumed; },
  saveResume,
  // 戻した後の分かれ目の赤い輪が付いているねじ
  marked: () => (hintRing?.userData.color === THEME.undo ? hintRing.parent.userData.screwId : null),
  deadEnd: showDeadEnd,
  screenOf: (id) => screenOf(board.screws.get(id)),
  screwShown: (id) => board.screws.get(id).visible,
  screw: (id) => board.screws.get(id),
  // 演出の途中を撮るため: 演出の時計を遅くする（0 で止める）。CSS のアニメーションも止める・戻す
  timeScale(k) {
    setTimeScale(k);
    for (const a of document.getAnimations()) {
      if (k === 0) a.pause();
      else {
        a.playbackRate = k;
        a.play();
      }
    }
    requestRender();
  },
  visibleScrews,
  // マスコット: 今の動き、合図を送る、姿勢を決め打ちする（動きの名前と秒。null で戻す）
  mascot: {
    get action() { return mascot.action; },
    history: mascot.history,
    react: (name) => mascot.react(name),
    force: (action, t) => mascot.force(action, t),
  },
  legal: () => game.legal(),
  showHint,
  get hintScrew() { return hintRing?.parent?.userData.screwId ?? null; },
  // 生成した盤面の、解ける手順
  get solution() { return LEVEL.meta?.solution ?? null; },
  get level() { return LEVEL.meta; },
  // クリアの評価: 遊んだ時間（秒）と、最後に出した評価。countHint / countRewind はヒントと戻るの回数を数える
  get playSeconds() { return playClock.seconds; },
  get rating() { return lastRating; },
  countHint,
  countRewind,
};
