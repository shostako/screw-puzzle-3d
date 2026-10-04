import * as THREE from 'three';
import { createBoot, wantsTitle } from './boot.js';
import { createGesture } from './gesture.js';
import { dragRotation, zoomDistance, radPerPx, fitRegion, fitDistance, fitPoints, spreadPx, focalPx, ZOOM_RANGE, createInertia } from './view.js';
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
import { stageLevel, chapterOf, nextVariant, MAX_VARIANT, START_VIEW as START_EULER } from './stages.js';
import { createProgress, deviceStorage } from './progress.js';
import { chapterView, chapterList, totalStars, finishesChapter, newKinds, KIND_NAMES } from './chapters.js';
import { createResume, restoreRecord, levelSignature, encodeSnapshot, decodeSnapshot, physicsAgrees } from './resume.js';
import { createSettings, clearRecords, SPEEDS, QUALITIES } from './settings.js';
import { randomLevel, dailyLevel, DIFFICULTIES, DIFFICULTY_IDS, DAILY_DIFFICULTY, MAX_RANDOM, isRandomNo, dateKey, isDateKey, dateLabel, dailyBestKey } from './random.js';
import { rate, clock, createPlayClock, createBests, MAX_STARS } from './rating.js';
import { createFeedback, tapCue, eventCue, endCue, BGM_TRACKS } from './feedback.js';
import { FX, unscrewPose, burstPose, dropPose, flyFrames, boxCloseTimeline, groundOf, pressDepth, releaseDepth, blockerFlash, chainStep, lidMark, sparkOf, rainDrops } from './effects.js';
import { createPerf, mountPerfPanel, slowFrames } from './perf.js';
import { TIPS, MIN_MS, MAX_MS, TURN_RAD, startTips, tapTips, labelScrews, createTutorialStore, tutorialEnabled } from './tutorial.js';

// 起動の画面（E3）。物理の wasm を読む fetch を見張るので、物理の準備（start）より先に作る
const boot = createBoot();
performance.mark('e11:main');
// 物理の wasm は、3D の準備より先に読み始める（E11。index.html の preload で読み始めている分をそのまま受け取る）。
// 読む間に描き手を作り、景色を焼く。start() はこの読み込みの終わりを待つだけ
initPhysics();

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
// ステージの別の盤面（F）の番号が壊れていれば捨てる
if (pending?.mode.variant !== undefined && !(Number.isInteger(pending.mode.variant) && pending.mode.variant >= 1 && pending.mode.variant <= MAX_VARIANT)) pending = null;
// ステージをまだ1本も外していなければ、続きではなく到達したステージから（おまかせ・今日の1問・ステージの別の盤面は外す前でも遊び方を続ける）
if (pending?.mode.type === 'stage' && !pending.path.length && !pending.mode.variant) pending = null;
const askedStage = Number.parseInt(query.get('stage') ?? '', 10);
let stage = Number.isInteger(askedStage) && askedStage >= 1 ? askedStage
  : pending?.mode.type === 'stage' ? pending.stage : progress.stage;

// 今の遊び方: { type: 'stage', variant?: 別の盤面の番号（F） } / { type: 'daily', key: 日付の数 } / { type: 'random', no: 番号, difficulty } / { type: 'free' }
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
  return stageLevel(stage, mode.variant ?? 0);
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
// ?perf なら速さの計器を出す（E11。scripts/perf.mjs もこれを読む）
const perf = query.has('perf') ? createPerf({ renderer }) : null;
if (perf) mountPerfPanel(perf);

// 描く解像度。DPR は 2 まで。動かしている間の1フレームが重ければ段階的に下げる（中級機で滑らかに動かすため）。
// 下げた解像度はその回のあいだ保つ（上げ下げを繰り返すと画面がちらつく）。設定の画質「軽い」なら初めから 1
let PIXEL_RATIOS = [];
let pixelLevel = 0;
let contactCut = false;   // 解像度を下げきってもまだ遅く、板の接する所の暗さを切った（E11）
function usePixelRatios() {
  PIXEL_RATIOS = quality().pixelRatios.filter((r) => r <= Math.max(1, DPR));
  pixelLevel = 0;
  contactCut = false;
  renderer.setPixelRatio(PIXEL_RATIOS[0]);
  useBlur();
}
// 終わりのカードの幕のぼかし（E5）は、画質「軽い」か、自動で解像度を下げた（遅い端末と分かった）時は切る（E11）。
// ぼかしは幕の後ろが変わるたび（雨・ネジまるの跳び・落ちる板）画面全体に掛け直すので、クリアの直後のフレームが倍ほど重くなる
function useBlur() {
  document.body.classList.toggle('no-blur', !quality().blur || pixelLevel > 0);
}
usePixelRatios();
const frameTimes = [];
function watchFrameTime(now, last) {
  if (!slowFrames(frameTimes, last ? now - last : null)) return;
  if (pixelLevel < PIXEL_RATIOS.length - 1) {
    renderer.setPixelRatio(PIXEL_RATIOS[++pixelLevel]);
    useBlur();
    resize();
  } else if (contactOn()) {
    // 解像度を 1 まで下げてもまだ遅ければ、最後に板の接する所の暗さ（E2。1 画素ごとに近くの板を調べる）を切る（E11）
    contactCut = true;
    if (board) setContact(board, false);
    requestRender();
  }
}
// 板の接する所の暗さを描くか: 画質の設定で入っていて、遅い端末として切っていない
const contactOn = () => quality().contact && !contactCut;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
// カメラの距離は盤面ごとに決める（E1）。立体を包む球が、HUD と右下のボタン列の間の空きにちょうど収まる距離（fitDist）に、
// ピンチの寄り引きの比（zoomK、1 で収まった状態）を掛ける。盤面が変わる・画面の大きさが変わるたびに fitDist を測り直す
let fitDist = 19;
let zoomK = 1;
let distance = fitDist;
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
performance.mark('e11:env');

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

// 縦長の画面では、横の画角がこの角度になるよう縦の画角を決める（横の画角が広いほど遠近が強く、端の板がゆがむ）
const PORTRAIT_HFOV = 28;
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? (2 * Math.atan(Math.tan((PORTRAIT_HFOV * Math.PI) / 360) * (h / w)) * 180) / Math.PI : 40;
  frameBoard();
}

// 立体を置く空き: HUD の下端から、右下のボタン列の上端まで。立体の中心（原点）をその真ん中に描く
let region = null;
function frameBoard() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  region = fitRegion(w, h, $('hud').getBoundingClientRect().bottom + 6, $('tools').getBoundingClientRect().top - 6);
  camera.setViewOffset(w, h, w / 2 - region.x, h / 2 - region.y, w, h);
  camera.updateProjectionMatrix();
  // 最初の向きの立体が空きの FIT_FILL に収まる距離。ただし、どの向きでも大きくはみ出さないよう、包む球でも下限を決める
  fitDist = Math.max(fitPoints(boardPoints, region, h, camera.fov), fitDistance(boardRadius, region, h, camera.fov));
  // マットと影の大きさの元: 収めた距離で見た立体の広がりを、原点の深さの長さに直したもの
  groundRadius = (spreadPx(boardPoints, fitDist, h, camera.fov) * fitDist) / focalPx(h, camera.fov);
  setDistance();
}
function setDistance() {
  distance = fitDist * zoomK;
  camera.position.set(0, 0, distance);
  placeGround();
  requestRender();
}

// マットと影（CSS の背景）を立体の真下に置く。立体を包む球の見かけの大きさで決めるので、寄り引きと盤面の大きさに付いてくる。
// 回したときは動かさない（球は回しても同じ。背景を毎フレーム描き直さない）
let boardRadius = 5;
let groundRadius = 4;
// 盤面の形を測る（盤面を作り直すたび）。点は盤面の頂点（ねじは1本ごとの外接の箱の隅）を、最初の向きに回したもの。
// radius は原点（回す中心）を中心に盤面を包む球の半径。どちらも立体の向きに関係なく、盤面の座標で測る
let boardPoints = new Float32Array(0);
function measureBoard(root) {
  model.updateWorldMatrix(true, true);
  const toModel = model.matrixWorld.clone().invert();
  const startQ = new THREE.Quaternion().setFromEuler(START_VIEW);
  const m = new THREE.Matrix4(), im = new THREE.Matrix4(), v = new THREE.Vector3();
  const out = [];
  let r = 0;
  const put = (mat, x, y, z) => {
    v.set(x, y, z).applyMatrix4(mat);
    r = Math.max(r, v.length());
    v.applyQuaternion(startQ);
    out.push(v.x, v.y, v.z);
  };
  root.traverse((o) => {
    if (!o.isMesh) return;
    m.multiplyMatrices(toModel, o.matrixWorld);
    if (o.isInstancedMesh) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const { min, max } = o.geometry.boundingBox;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, im);
        im.premultiply(m);
        for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) put(im, x, y, z);
      }
    } else {
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) put(m, pos.getX(i), pos.getY(i), pos.getZ(i));
    }
  });
  boardPoints = new Float32Array(out);
  return r || 5;
}
const rootStyle = document.documentElement.style;
function placeGround() {
  camera.updateMatrixWorld();
  const c = screenOfPoint(new THREE.Vector3(0, 0, 0));
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(groundRadius);
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
  coachTurned(angle);
  // カメラから見た軸で回す（いまの向きに関係なく、指の方向へ回る）
  turn.setFromAxisAngle(axis.set(a[0], a[1], a[2]), angle);
  model.quaternion.premultiply(turn);
  requestRender();
}

function zoomBy(scale) {
  zoomK = zoomDistance(zoomK, scale, ZOOM_RANGE.min, ZOOM_RANGE.max);
  setDistance();
}

// 慣性（E1）: 指を離したときの速さで回り続け、なめらかに止まる。進めるのは frame()
const inertia = createInertia();
let lastSpin = 0;
function spinStep(now) {
  if (!inertia.active) return;
  const m = inertia.step(lastSpin ? now - lastSpin : 16);
  lastSpin = now;
  if (m) rotateBy(m.dx, m.dy);
  if (!inertia.active) lastSpin = 0;
}
function stopSpin() {
  lastSpin = 0;
  return inertia.stop();
}

// 向きと距離を最初に戻す（見失ったとき用のボタン）。0.35 秒かけて回して戻す
let homing = null;
function goHome() {
  stopSpin();
  const from = model.quaternion.clone(), to = new THREE.Quaternion().setFromEuler(START_VIEW);
  const k0 = zoomK;
  const t = tween(350, (k) => {
    if (homing !== t) return;
    const e = k * k * (3 - 2 * k);
    model.quaternion.slerpQuaternions(from, to, e);
    zoomK = k0 + (1 - k0) * e;
    setDistance();
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
  settleScrew(obj);
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
  settleScrew(obj);
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

// 押し込み（E5）: 指が触れた瞬間に、指の下のねじ頭をわずかに沈める。離すか回し始めたら、少し行き過ぎて戻る。
// タップで外れるねじや震えるねじは、その演出の前に元の位置へ戻す（settleScrew）
let pressedObj = null;
function settleScrew(obj) {
  const p = obj.userData.press;
  if (!p) return;
  tweens.delete(p.t);
  obj.position.copy(p.home);
  obj.userData.press = null;
  requestRender();
}
function pressScrew(obj) {
  if (pressedObj && pressedObj !== obj) releaseScrew();
  if (obj.userData.shaking) return;
  settleScrew(obj);
  const p = { home: obj.position.clone(), out: new THREE.Vector3(0, 1, 0).applyQuaternion(obj.quaternion), r: obj.userData.radius, depth: 0 };
  p.t = tween(FX.press.ms, (k) => {
    p.depth = pressDepth(k);
    obj.position.copy(p.home).addScaledVector(p.out, -p.depth * p.r);
  });
  obj.userData.press = p;
  pressedObj = obj;
}
function releaseScrew() {
  const obj = pressedObj;
  pressedObj = null;
  const p = obj?.userData.press;
  if (!p) return;
  tweens.delete(p.t);
  const from = p.depth;
  p.t = tween(FX.press.back, (k) => {
    obj.position.copy(p.home).addScaledVector(p.out, -releaseDepth(k, from) * p.r);
  }, () => {
    if (obj.userData.press === p) settleScrew(obj);
  });
}

// 外せないねじ（隠れている）をタップしたとき、塞いでいる板を一瞬だけ水色に光らせて理由を見せる（E5）。
// 子の部品が付いている（held）ときの橙（glowHolders）とは別の色。材質は板ごとに1つなので描く回数は増えない
function flashBlockers(ids) {
  for (const id of ids) {
    const obj = board.plates.get(id);
    if (!obj || obj.userData.glowing || obj.parent !== board.root) continue;
    obj.userData.glowing = true;
    const mat = obj.material, base = mat.color.clone(), col = new THREE.Color(THEME.blocker);
    tween(FX.blocker.ms, (k) => {
      const w = blockerFlash(k);
      mat.color.copy(base).lerp(col, FX.blocker.tint * w);
      mat.emissive.copy(col).multiplyScalar(FX.blocker.glow * w);
    }, () => {
      mat.color.copy(base);
      mat.emissive.setScalar(0);
      obj.userData.glowing = false;
    });
  }
  requestRender();
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

// 満杯の箱から星を散らす。連鎖（E5）が増えるほど多く、遠くへ
function sparkle(el, chain = 1) {
  const [x, y] = centerOf(el);
  const { count, reach } = sparkOf(chain);
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'spark';
    const a = (i / count) * Math.PI * 2 + 0.3;
    const far = reach * (i % 2 ? 1 : 0.8);
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    s.style.setProperty('--dx', `${Math.cos(a) * 46 * far}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * 30 * far}px`);
    $('flyers').append(s);
    s.addEventListener('animationend', () => s.remove());
  }
}

// クリアのねじの雨（E5）: このステージのねじの色の印を、画面の上から回しながら降らせる。星が多いほど多く
function rain(stars) {
  const colors = [...new Set(LEVEL.screws.map((s) => s.color))];
  const W = window.innerWidth, H = window.innerHeight;
  for (const d of rainDrops(stars, colors.length)) {
    const el = dot(colors[d.color]);
    el.classList.add('flyer', 'drop');
    $('rain').append(el);
    const x = d.x * W, t = (y, x, a) => ({ transform: `translate(${x}px, ${y}px) rotate(${a}deg) scale(${d.size})` });
    el.animate([t(-40, x, 0), t(H + 40, x + d.drift * W, d.turns * 360)],
      { duration: d.ms, delay: d.delay, easing: 'cubic-bezier(0.35, 0, 0.75, 0.9)', fill: 'both' })
      .finished.then(() => el.remove(), () => el.remove());
  }
}

let flashTimer = 0;
// 案内の行（#hint）は、文がある時だけ出る（E1）。遊び方の一言（「1本指で回す・ねじをタップで外す」）は、
// ステージ 1 の導入（E4。ネジまるの吹き出しと手本の手）に移したので、ふだんは何も出さない
function say(text, warn = false, ms = 1200) {
  hint.textContent = text;
  hint.classList.toggle('flash', warn);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(clearHint, ms);
}
function clearHint() {
  clearTimeout(flashTimer);
  hint.textContent = '';
  hint.classList.remove('flash');
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
let chain = 0, lastBoxAt = null;   // 箱の連鎖（E5）: 何連鎖目か・前の箱が閉まった時刻（演出の時計）
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
        // 前の箱が閉まってから間もなく閉まったら連鎖（E5）: ふたの星を増やし、音程を上げ、星を多く散らす
        const el = boxesEl.children[ev.box];
        const tl = boxCloseTimeline(fast);
        chain = chainStep(chain, lastBoxAt, fxClock() + tl.cue);
        lastBoxAt = fxClock() + tl.cue;
        el.dataset.lid = lidMark(chain);
        el.classList.toggle('chain', chain >= 2);
        await wait(tl.lid);
        el.classList.add('closing');
        await wait(tl.cue - tl.lid);
        if (gen !== generation) break;
        cue('boxFull', { chain });
        sparkle(el, chain);
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
    if (gen === generation && batch.status !== 'playing' && !queue.length) await finish(batch.status, gen);
  }
  if (gen === generation) playing = false;
}

// 決着の後: クリアなら、ねじの雨を降らせて少し間を置いてからカードを出す（E5）。詰みはすぐに出す
async function finish(status, gen) {
  if (status === 'cleared') {
    rain(ratingNow().stars);
    await wait(FX.clear.pause);
    if (gen !== generation) return;
  }
  showEnd(status);
}

function tapScrew(id) {
  const obj = board.screws.get(id);
  const r = game.tap(id);
  cue(tapCue(r.reason));
  coachAfterTap(r);
  if (r.reason === 'blocked') {
    shake(obj);
    flashBlockers(blockersOf(id));
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

// ねじの抜ける道を塞いでいる板（今の姿勢で）
function blockersOf(id) {
  const present = new Set(physics.present());
  return sweepHits(LEVEL, id, { plates: LEVEL.plates.filter((p) => present.has(p.id)), poses: physics.poses() });
}

// ねじを隠しているのが動ける板だけなら、その種類（落ちた板があれば 'loose'、ぶら下がりだけなら 'hanging'）。
// 固定の板にも隠れていれば null（回しても外せない）
function movableBlockers(id) {
  const hits = blockersOf(id);
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
  hideCoach();
  const ov = $('overlay');
  ov.className = status;
  const cleared = status === 'cleared';
  seatMascot(true);
  // クリアの合図は星の数を添える（ネジまるが ★ごとに喜び方を変える。E5）
  const rating = cleared ? ratingNow() : null;
  cue(endCue(status), rating ? { stars: rating.stars } : undefined);
  // クリアしたらその場で次のステージを保存する（ボタンを押す前に閉じても、次は続きから）
  const before = progress.stage;
  if (cleared && mode.type === 'stage') progress.cleared(stage);
  $('end-title').textContent = !cleared ? '詰み'
    : mode.type === 'stage' ? `ステージ ${stage} クリア！`
    : mode.type === 'daily' ? '今日の1問 クリア！'
    : 'クリア！';
  $('end-text').textContent = cleared ? 'すべての箱を埋めた' : '外せるねじが無くなった。戻ってやり直そう';
  showRating(cleared, rating);
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
  $('end-other').hidden = cleared || freePlay;
  $('resume').hidden = true;
  $('again').textContent = cleared ? 'もう一度' : 'やり直す';
  $('again').classList.toggle('sub', next || !cleared);
  ov.hidden = false;
  showUndo();
}

// いまクリアしたら付く星（記録はしない）
function ratingNow() {
  return rate({ screws: LEVEL.screws.length, seconds: playClock.seconds, hints: tally.hints, rewinds: tally.rewinds });
}

// クリアの星と時間、自己ベスト。詰みでは出さない
let lastRating = null;
function showRating(cleared, rated = null) {
  const starsEl = $('end-stars');
  const scoreEl = $('end-score');
  starsEl.hidden = !cleared;
  scoreEl.hidden = !cleared;
  if (!cleared) return;
  const seconds = playClock.seconds;
  const r = rated ?? ratingNow();
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
    if (g === generation && !$('overlay').hidden) mascot.react('cleared', { stars: lastRating?.stars });
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
  const pos = `${ch.pos}/${ch.last - ch.first + 1}`;
  // 別の盤面（F）は章の名前を省いて「別の問題」と添える（1 行に収める）
  return [`ステージ ${stage}`, m.variant ? `第${ch.no}章 ${pos}・別の問題` : `第${ch.no}章「${ch.title}」 ${pos}`];
}
function showStage() {
  const [title, sub] = modeTitle();
  $('title').textContent = title;
  $('subtitle').textContent = sub;
  $('subtitle').hidden = !sub;
  $('mode-btn').disabled = freePlay;
  $('other-btn').hidden = freePlay;
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
  $('other').hidden = true;
  showStage();
  playClock.pause();
  hint.textContent = `${mode.type === 'stage' ? modeTitle()[0] : modeTitle().join(' ').trim()} を組み立て中…`;
  await wait(30);
  LEVEL = levelFor();
  levelSig = null;
  newGameFor(LEVEL);
  homing = null;
  stopSpin();
  model.quaternion.setFromEuler(START_VIEW);
  zoomK = 1;
  restart();
  clearHint();
  loading = false;
  if (intro && chapterOf(stage).first === stage) revealChapter(intro);
  showUndo();
  saveResume();
  offerStartTips();
}

// クリアの画面の「次へ」
function nextStage() {
  if (mode.type === 'random') return loadMode({ type: 'random', no: freshRandomNo(), difficulty: mode.difficulty });
  if (mode.type === 'stage') stage++;
  else stage = progress.stage;
  return loadMode({ type: 'stage' });
}

// ---- 別の問題（F、2026-10-04 実機での指摘） ----
// 遊んでいる最中でも始めでも、今と同じ難しさの別の盤面へ替える。ステージは同じ設定（形・段・条件）の別のシードの盤面で、
// クリアすればそのステージのクリア（星と自己ベストもそのステージに付く）。おまかせは同じ難しさの次の番号、
// 今日の1問は 1 日 1 問なので、同じ難しさ（ふつう）のおまかせへ
function otherMode() {
  if (mode.type === 'stage') return { type: 'stage', variant: nextVariant(mode.variant) };
  if (mode.type === 'random') return { type: 'random', no: freshRandomNo(), difficulty: mode.difficulty };
  if (mode.type === 'daily') return { type: 'random', no: freshRandomNo(), difficulty: DAILY_DIFFICULTY };
  return null;
}
function switchOther() {
  const next = otherMode();
  if (next) loadMode(next);
}
// ねじを 1 本でも外していれば、進みが消えるので確かめる（始めと、詰み・行き止まりのカードからはすぐ替える）
function askOther() {
  if (freePlay || loading || screenOpen()) return;
  if (game.status === 'playing' && game.path.length && $('overlay').hidden) {
    playClock.pause();
    $('other').hidden = false;
    return;
  }
  switchOther();
}
function closeOther() {
  $('other').hidden = true;
  if (game.status === 'playing' && !document.hidden) playClock.resume();
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
const screenOpen = () => boot.open || !$('menu').hidden || !$('stages').hidden || !$('settings').hidden || !$('other').hidden;

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
  hideCoach();
  queue = [];
  playing = false;
  pressedObj = null;
  chain = 0;
  lastBoxAt = null;
  for (const t of tweens) tweens.delete(t);
  $('flyers').replaceChildren();
  $('rain').replaceChildren();
  if (board) {
    model.remove(board.root);
    for (const p of board.plates.values()) if (p.parent === scene) scene.remove(p);
  }
  board = buildBoard(LEVEL, { knurl: quality().knurl, contact: contactOn(), drives: settings.get('drives') });
  model.add(board.root);
  // 空とマットの色は盤面の種類で変え、ステージなら章の色みを重ねる（E2・E3。theme.js の skies と chapterTints）
  const sky = skyVariables(LEVEL.meta?.kind, LEVEL.meta?.sky);
  for (const [name, value] of Object.entries(sky)) rootStyle.setProperty(name, value);
  // ブラウザの上の帯（theme-color）も空の上の色に合わせる
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', sky['--sky-top']);
  stepClock = 0;
}

function restart() {
  rebuildBoard();
  boardRadius = measureBoard(board.root);
  frameBoard();
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
    view: { q: model.quaternion.toArray(), k: zoomK },   // k は寄り引きの比（E1。距離は画面と盤面で決め直す）
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
  // 寄り引きは比で戻す（E1 より前の保存の d は、距離の決め方が変わったので使わず、収めた距離のまま）
  if (Number.isFinite(r.view?.k) && r.view.k > 0) zoomBy(zoomK / r.view.k);
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

// 詰み・行き止まりのカード（E5）: 「戻る」（解ける所まで）と「ヒント」（戻ってから次の一手）を大きく並べ、1手戻すとやり直すは控えめに
const rewindNote = (text) => { $('rewind').querySelector('small').textContent = text; };
function showRewindButtons(on) {
  $('rewind').hidden = !on;
  $('rewind').disabled = false;
  rewindNote('解ける所まで');
  $('end-hint').hidden = !on;
  $('end-hint').disabled = false;
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
  $('end-hint').disabled = true;
  rewindNote('探しています…');
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
  offerTips(['rescue']);
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
  $('end-other').hidden = freePlay;
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

// 指の位置のねじ（当たったねじか、近くに見えているねじ）
function screwAt(x, y) {
  const hit = castAt(x, y);
  return (hit && screwIdOf(hit.object)) || nearestScrew(visibleScrews(), x, y);
}

// 離した所ではなく、指を置いたときに選んだ（沈めた）ねじを外す（F1）。沈んだねじは光線から外れたり、
// 隣のねじの方が近くなったりして、離した所で選び直すと沈めたねじと違う答えになることがある
function onTap(x, y) {
  if (!$('overlay').hidden) return;
  const id = aimedId && game.state.where[aimedId] === 'board' ? aimedId : screwAt(x, y);
  if (id) tapScrew(id);
}

// 指が触れた瞬間に、指の下のねじを沈める（押し込み、E5）。外せるかどうかに関わらず沈める（タップで外すかはまだ分からない）。
// 選んだねじの id を返す。この操作は、少し長く押しても少しぶれてもタップのまま（gesture.aim()、F1）
function pressAt(x, y) {
  if (!$('overlay').hidden || loading || game.status !== 'playing') return null;
  const id = screwAt(x, y);
  if (!id || game.state.where[id] !== 'board') return null;
  pressScrew(board.screws.get(id));
  return id;
}

// ---- 指の操作 ----

const gesture = createGesture();
// 惰性で速く回っている所へ指を置いたら、それは「止める」操作で、離してもタップにしない（狙っていないねじが外れないように）
const CATCH_SPEED = 0.3;   // ピクセル毎ミリ秒
let caught = false;
let pinched = false;
let aimedId = null;   // 最初の指を置いたときに選んだねじ（F1）
function handle(events, t) {
  for (const e of events) {
    if (e.type === 'rotate') {
      if (pressedObj) releaseScrew();   // 回し始めたら、沈めたねじを戻す
      rotateBy(e.dx, e.dy);
      if (!pinched) inertia.push(e.dx, e.dy, t);
    } else if (e.type === 'zoom') {
      if (pressedObj) releaseScrew();
      pinched = true;
      zoomBy(e.scale);
    } else if (e.type === 'tap') {
      coachTapped();
      if (!caught) onTap(e.x, e.y);
    }
  }
}

canvas.addEventListener('pointerdown', (e) => {
  feedback.unlock();   // 音は利用者の操作の中でしか鳴らし始められない
  try { canvas.setPointerCapture(e.pointerId); } catch { /* 合成した指（スクリーンショットのスクリプト）は捕まえられない */ }
  if (gesture.activePointers === 0) {
    caught = stopSpin() > CATCH_SPEED;
    pinched = false;
    aimedId = null;
  }
  handle(gesture.down(e.pointerId, e.clientX, e.clientY, e.timeStamp), e.timeStamp);
  if (gesture.activePointers === 1 && !caught) {
    aimedId = pressAt(e.clientX, e.clientY);
    if (aimedId) gesture.aim();
  } else if (pressedObj) releaseScrew();
});
canvas.addEventListener('pointermove', (e) => {
  handle(gesture.move(e.pointerId, e.clientX, e.clientY, e.timeStamp), e.timeStamp);
});
canvas.addEventListener('pointerup', (e) => {
  handle(gesture.up(e.pointerId, e.clientX, e.clientY, e.timeStamp), e.timeStamp);
  if (pressedObj) releaseScrew();   // タップで外れたねじは、外す演出の前に元へ戻している
  // 全部の指が離れたら、離す直前の速さで惰性を付ける（ピンチを含んだ操作では付けない）
  if (gesture.activePointers === 0) {
    if (!pinched && inertia.release(e.timeStamp)) {
      lastSpin = 0;
      wake();
    } else inertia.stop();
  }
});
canvas.addEventListener('pointercancel', (e) => {
  handle(gesture.cancel(e.pointerId), e.timeStamp);
  if (pressedObj) releaseScrew();
  if (gesture.activePointers === 0) inertia.stop();
});
// PC で試すとき用: ホイールで寄り引き
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomBy(Math.exp(-e.deltaY * 0.001));
}, { passive: false });

$('restart').addEventListener('click', restart);
$('other-btn').addEventListener('click', askOther);
$('o-yes').addEventListener('click', switchOther);
$('o-no').addEventListener('click', closeOther);
$('end-other').addEventListener('click', switchOther);
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
  clock: fxClock, environment: bakeEnvironment, onDraw: perf ? () => perf.mascot() : null, maxRatio: quality().mascotRatio, idleFps: quality().idleFps,
});
function cue(name, opts) {
  feedback.cue(name, opts);
  if (name) mascot.react(name, opts);
}
// 終わりの画面では、ネジまるをカードの上に大きく乗せる（成功・失敗の動きを見せる）。やり直すと左下へ戻す
function seatMascot(onCard) {
  const c = $('mascot');
  if (onCard) $('overlay').querySelector('.card').prepend(c);
  else document.body.insertBefore(c, $('flyers'));
}
// ---- 初めての導入（E4） ----
// 何をいつ出すかは tutorial.js が決め、ここはネジまるの吹き出し（#coach）と手本の手（#coach-hand）を出し入れする。
// 導入は1つずつ出し、重なったら順に待たせる。出した導入は覚えて二度と出さない（記録を消すと、また出る）
const tutorial = createTutorialStore(deviceStorage());
const tutorialOn = tutorialEnabled({ query, webdriver: navigator.webdriver, freePlay });
const coachEl = $('coach');
const handEl = $('coach-hand');
let coachTip = null;    // 今出している導入 { id, shownAt, turned（回した角度）, screw（手を置くねじ） }
let coachQueue = [];    // 出す順を待っている導入の名前
let coachTimer = 0;
let coachLater = 0;

// 導入を出す（まだ見せていないものだけ）。delay ミリ秒後に出す（ねじが飛ぶ演出などを先に見せる）
function offerTips(ids, delay = 0) {
  if (!tutorialOn || !ids.length) return;
  for (const id of tutorial.fresh(ids)) if (!coachQueue.includes(id) && coachTip?.id !== id) coachQueue.push(id);
  if (coachTip || !coachQueue.length) return;
  clearTimeout(coachLater);
  coachLater = setTimeout(nextTip, delay);
}
function offerStartTips() {
  offerTips(startTips({ mode, stage, level: LEVEL }), 500);
}

function nextTip() {
  if (coachTip) return;
  // 終わりの画面や遊び方の画面が開いている間は出さない（閉じた後の合図で出す）
  if (!$('overlay').hidden || screenOpen() || loading) return;
  const id = coachQueue.shift();
  if (!id) return;
  if (tutorial.has(id)) return nextTip();
  tutorial.mark(id);
  coachTip = { id, shownAt: performance.now(), turned: 0, screw: null };
  coachEl.textContent = TIPS[id].text;
  coachEl.classList.remove('leaving');
  coachEl.hidden = false;
  placeHand();
  if (mascot.enabled) mascot.play('joy');   // ネジまるが手を上げて知らせる
  clearTimeout(coachTimer);
  if (TIPS[id].until === 'any') coachTimer = setTimeout(endTip, MAX_MS);
  requestRender();
}

// 今の導入を閉じて、待っている次の導入へ
function endTip() {
  if (!coachTip) return;
  clearTimeout(coachTimer);
  coachTip = null;
  handEl.hidden = true;
  coachEl.classList.add('leaving');
  coachLater = setTimeout(() => {
    if (!coachTip) coachEl.hidden = true;
    coachEl.classList.remove('leaving');
    nextTip();
  }, 220);
}

// 盤面を作り直す・終わりの画面を出す時は、出している導入も待っている導入も片付ける
function hideCoach() {
  clearTimeout(coachTimer);
  clearTimeout(coachLater);
  coachTip = null;
  coachQueue = [];
  coachEl.hidden = true;
  coachEl.classList.remove('leaving');
  handEl.hidden = true;
}

const tipAge = () => performance.now() - coachTip.shownAt;
// 画面をタップした（ねじに当たったかに関係なく）。'any' の導入は読む間を置いてから閉じる
function coachTapped() {
  if (coachTip && TIPS[coachTip.id].until === 'any' && tipAge() >= MIN_MS) endTip();
}
// 立体を回した。'turn' の導入は、十分に回したら閉じる
function coachTurned(angle) {
  if (coachTip?.id && TIPS[coachTip.id].until === 'turn' && (coachTip.turned += Math.abs(angle)) >= TURN_RAD) endTip();
}
// ねじをタップした結果から、閉じる導入と次に出す導入を決める
function coachAfterTap(r) {
  if (!tutorialOn) return;
  if (r.reason === 'ok' && coachTip && TIPS[coachTip.id].until === 'tap') endTip();
  const stage1 = mode.type === 'stage' && stage === 1;
  const visibleLegal = stage1 && r.reason === 'ok' && !tutorial.has('turn') ? visibleLegalScrews().length : null;
  offerTips(tapTips({
    reason: r.reason,
    events: r.events,
    slotsFree: game.state.slots.filter((x) => x === null).length,
    visibleLegal,
    stage: mode.type === 'stage' ? stage : null,
    status: r.status ?? game.status,
  }), r.reason === 'ok' ? 700 : 300);
}

// 今の向きで見えている、外せるねじ
function visibleLegalScrews() {
  const legal = new Set(game.legal());
  return visibleScrews().filter((s) => legal.has(s.id));
}

// 手本の手を、導入が指す所へ置く（立体のねじを指すときは、回すたびに付いていく）
function placeHand() {
  const tip = TIPS[coachTip.id];
  let at = null;
  if (tip.at === 'screw' || tip.at === 'label') {
    const seen = visibleLegalScrews();
    const ids = seen.map((s) => s.id);
    const ok = tip.at === 'label' ? labelScrews(LEVEL, ids) : ids;
    if (!ok.includes(coachTip.screw)) coachTip.screw = ok[0] ?? null;
    if (coachTip.screw) at = screenOf(board.screws.get(coachTip.screw));
  } else if (tip.at === 'board' && region) {
    at = [region.x, region.y + 40];
  } else if (tip.at === 'slots') {
    const r = slotsEl.getBoundingClientRect();
    at = [r.left + r.width / 2, r.bottom - 4];
  } else if (tip.at === 'tools') {
    const r = $('hint-btn').getBoundingClientRect();
    at = [r.left + r.width / 2, r.bottom - 6];
  }
  if (!tip.hand || !at) {
    handEl.hidden = true;
    return;
  }
  handEl.className = tip.hand;
  handEl.style.setProperty('--x', `${at[0].toFixed(1)}px`);
  handEl.style.setProperty('--y', `${at[1].toFixed(1)}px`);
  handEl.hidden = false;
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
// BGM の曲（F）のボタンは曲の表から作る
for (const t of BGM_TRACKS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.v = t.id;
  b.textContent = t.label;
  settingsEl.querySelector('[data-key="bgmTrack"]').append(b);
}
function showSettings() {
  for (const seg of settingsEl.querySelectorAll('.seg')) {
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(segValue(b) === settings.get(seg.dataset.key)));
  }
}
for (const seg of settingsEl.querySelectorAll('.seg')) {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.set(seg.dataset.key, segValue(b));
    if (seg.dataset.key === 'bgmTrack') settings.set('bgm', true);   // 曲を選んだら聞かせる（BGM が切りなら入れる）
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
      setContact(board, contactOn());
    }
    mascot.setQuality({ maxRatio: quality().mascotRatio, idleFps: quality().idleFps });
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
// 戻ってからヒント: 解ける所まで戻し、そこから次に外すねじに金色の輪を出す（分かれ目の赤い輪の代わりに）
$('end-hint').addEventListener('click', async () => {
  await rewindToSolvable();
  if (game.status === 'playing' && $('overlay').hidden) showHint();
});
$('resume').addEventListener('click', () => {
  $('overlay').hidden = true;
  showUndo();
  nextTip();   // 行き止まりで待たせていた導入（ヒントと戻る）
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
  spinStep(now);
  if (tweens.size) {
    runTweens();
    needsRender = true;
  }
  if (needsRender) {
    needsRender = false;
    const t0 = perf ? performance.now() : 0;
    renderer.render(scene, camera);
    perf?.frame(now, performance.now() - t0);
    if (coachTip) placeHand();
    watchFrameTime(now, lastDraw);
    lastDraw = now;
  }
  // 物理が動いているか演出の途中なら次のフレームも。止まっていればここで止め、次の操作（requestRender）で再開する
  const moving = physics.moving();
  if (wasMoving && !moving) saveResume();   // 板が落ち着いた姿勢を保存する
  wasMoving = moving;
  if (moving || tweens.size || needsRender || inertia.active) wake();
  else lastFrame = 0;
}
let wasMoving = false;

async function start() {
  performance.mark('e11:physics-start');
  await initPhysics();
  performance.mark('e11:physics');
  boot.step('physics');
  started = true;
  const record = pending;
  // 初めて開いた端末ならタイトルを挟む（E3）。続きの局面があれば、ここで消える前に見ておく
  const title = wantsTitle({ query, webdriver: navigator.webdriver, reached: progress.stage, resuming: !!record, chosen: freePlay || askedByUrl });
  restart();
  pending = null;
  if (record) resumeFrom(record);
  saveResume();
  resize();
  wake();
  // 最初の盤面を描いてから起動の画面を閉じる（タイトルなら「はじめる」を待つ。その間は遊んだ時間を数えない）
  if (title) playClock.pause();
  performance.mark('e11:board');
  requestAnimationFrame(() => requestAnimationFrame(() => boot.ready({
    title,
    onStart() {
      feedback.unlock?.();
      playClock.reset();
      if (!document.hidden) playClock.resume();
      offerStartTips();
    },
  })));
  // ネジまるの描き手は、最初の盤面を出してから作る（E11。WebGL の文脈と景色の焼き込みは重く、最初の描画を遅らせていた）
  // 起動の画面が閉じる動き（0.45 秒）を見せ終えてから作る（作る間は 1 フレームが止まるので、閉じる前の画面のまま待たせない）
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
    mascot.begin();
    performance.mark('e11:mascot');
  }, 700)));
  if (!title) offerStartTips();
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
  get bgmTrack() { return feedback.bgmTrack; },   // 鳴っている BGM の曲（鳴っていなければ null）
  get pixelRatio() { return renderer.getPixelRatio(); },
  perf,
  get mascotDrawing() { return mascot.enabled; },
  loadMode,
  get booting() { return boot.open; },
  // 初めての導入（E4）: 今出している導入の名前（無ければ null）と、見せた導入の一覧
  get tip() { return coachTip?.id ?? null; },
  get tipsSeen() { return tutorial.seen; },
  get rendered() { return mascot.begun && !boot.busy && !loading && !needsRender && !tweens.size && !playing && !physics?.moving() && !inertia.active; },
  // rendered が false の理由（スクリーンショットのスクリプトが待ちきれなかったとき用）
  why: () => ({ mascot: mascot.begun, boot: boot.busy, loading, needsRender, tweens: tweens.size, playing, moving: physics?.moving(), modes: window.__app.plateModes() }),
  // 立体の向きを Euler で直接決める（スクリーンショットで同じ向きから撮るため）
  // k は寄り引きの比（1 で空きに収まった距離）
  view(x, y, z, k = zoomK) {
    stopSpin();
    model.rotation.set(x, y, z);
    zoomBy(zoomK / k);
  },
  // 構図: 立体を置く空き（CSS ピクセルの四角）と、収めた距離・今の距離
  get framing() { return { region, fitDist, distance, zoomK, radius: boardRadius, groundRadius }; },
  get spinning() { return inertia.active; },
  // 立体（盤面に残っている板とねじ）を画面に写した外接の四角（CSS ピクセル）
  boardRect() {
    const v = new THREE.Vector3(), m = new THREE.Matrix4(), w = window.innerWidth, h = window.innerHeight;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    camera.updateMatrixWorld();
    const add = (mat, pos) => {
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mat).project(camera);
        const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    };
    board.root.updateWorldMatrix(true, true);
    board.root.traverseVisible((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      if (!o.isInstancedMesh) return add(o.matrixWorld, pos);
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        if (m.elements[0] === 0 && m.elements[5] === 0 && m.elements[10] === 0) continue;   // 外したねじ（大きさ 0）
        add(m.premultiply(o.matrixWorld), pos);
      }
    });
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
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
  // 押し込み（E5）: 沈めているねじと深さ（× r）。無ければ null
  get pressed() {
    const p = pressedObj?.userData.press;
    return p ? { id: pressedObj.userData.screwId, depth: p.depth } : null;
  },
  // 箱の連鎖（E5）: 最後に閉まった箱が何連鎖目か
  get chain() { return chain; },
  // ねじの抜ける道を塞いでいる板（E5 の理由の光）
  blockersOf,
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
  screwAt,
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
