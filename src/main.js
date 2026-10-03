import * as THREE from 'three';
import { createGesture } from './gesture.js';
import { dragRotation, zoomDistance } from './view.js';
import { createPlaceholderBox } from './placeholder.js';

const canvas = document.getElementById('stage');
const hint = document.getElementById('hint');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0xf4ead9);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
let distance = 9;
camera.position.set(0, 0, distance);

scene.add(new THREE.HemisphereLight(0xfff8ee, 0x8a7a66, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(3, 5, 6);
scene.add(sun);

const model = createPlaceholderBox();
// 最初は斜め上から見た向きにして、立体だと分かるようにする
model.quaternion.setFromEuler(new THREE.Euler(0.45, -0.6, 0));
scene.add(model);

let needsRender = true;
function requestRender() {
  needsRender = true;
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 縦長の画面では横幅に合わせて立体が収まるよう、縦の画角を広げる
  camera.fov = w < h ? 40 * Math.min(1.6, h / w / 1.2) : 40;
  camera.updateProjectionMatrix();
  requestRender();
}
window.addEventListener('resize', resize);
resize();

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
  distance = zoomDistance(distance, scale);
  camera.position.set(0, 0, distance);
  requestRender();
}

let flashTimer = 0;
function onTap() {
  // M1 ではタップと判定されたことだけ見せる。ねじを外すのは M4
  hint.textContent = 'タップ';
  hint.classList.add('flash');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    hint.textContent = '1本指で回す・2本指で拡大';
    hint.classList.remove('flash');
  }, 600);
}

const gesture = createGesture();
function handle(events) {
  for (const e of events) {
    if (e.type === 'rotate') rotateBy(e.dx, e.dy);
    else if (e.type === 'zoom') zoomBy(e.scale);
    else if (e.type === 'tap') onTap(e);
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

function frame() {
  if (needsRender) {
    needsRender = false;
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// スクリーンショットのスクリプトが描画の完了を待つための目印
window.__app = { model, camera, get rendered() { return !needsRender; } };
