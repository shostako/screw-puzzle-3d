import * as THREE from 'three';
import { screwParts, driveOf, BOLT } from './scene.js';
import { THEME } from './theme.js';
import { FX, rainDrops, rainFall } from './effects.js';

// クリアのねじの雨を立体で降らせる（F。E5 の雨は平たい印を画面の中で回すだけだった）。
// 画面いっぱいの透明なキャンバス（#rain の中）に、盤面と同じキャップボルトを1本ずつ違う姿勢で置き、
// ゆっくり3次元で回しながら落とす。色ごと・部品（頭・穴・ねじ部）ごとに InstancedMesh にして、描く回数は 色の数 × 3。
// 画面では小さい（頭の直径 24px 前後）ので、頭はローレット無し、ねじ部は分割を粗くして 1 本 約 800 三角形（盤面のねじの 1/3）。
// 画面いっぱいなので、アンチエイリアスは付けない（ヘッドレスで雨の間のフレームが 3 割ほど軽くなった）。
// 降り始めのフレームが遅ければ（中央値が 30fps を切る）、その場で解像度を 1 に下げる。
// 降っている間だけ毎フレーム描き、降り終えたらキャンバスを隠して止まる（ふだんは何も描かない）。
// 描き手（WebGL の文脈・景色の焼き込み・シェーダー）は begin() で前もって作る。作れなければ start() は false を返し、
// 呼ぶ側が平たい印の雨（DOM）で代わりに降らせる。
// clock は演出の時計（スクリーンショットのスクリプトが止められる）。

const R = 1;              // 形を作る半径（画面の大きさは行列で合わせる）
const LENGTH = 2.0;       // ねじ部の長さ × r（盤面のねじは板に隠れて短い。降らせるのは長いボルト）
const CENTER = (BOLT.headHeight - LENGTH) * R / 2;   // 回す中心（頭の上面と先の真ん中）
const FOV = 30;

export function createRain(container, { clock = () => performance.now(), environment = null, maxRatio = 2, onDraw = null } = {}) {
  const ratioFor = (max) => Math.min(max, window.devicePixelRatio || 1);
  let gl = null;          // { renderer, scene, camera, canvas }
  let failed = false;
  let run = null;         // 降っている間 { t0, drops, meshes, end }
  let held = null;        // 時計を止めて見せる時刻（スクリーンショット用。null で時計どおり）
  let size = { W: 0, H: 0 };
  let slow = false;       // 降り始めが遅かった（この回の間は解像度 1 のまま）

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), spinQ = new THREE.Quaternion(), axis = new THREE.Vector3();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3(), offset = new THREE.Matrix4().makeTranslation(0, -CENTER, 0);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);

  // 描き手を作る手順。1 つずつは数十 ms ほど（ヘッドレスでは 1 秒近く）主の処理を止めるので、
  // prepare() は指が離れていて演出も無い時に 1 つずつ進める（タップの途中で止めると長押し扱いになる）
  let building = null;
  const steps = [
    () => {
      const canvas = document.createElement('canvas');
      canvas.className = 'rain3d';
      canvas.hidden = true;
      container.append(canvas);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(ratioFor(maxRatio));
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = THEME.exposure;
      const scene = new THREE.Scene();
      const { hemi, sun, rim } = THEME.lights;
      scene.add(new THREE.HemisphereLight(hemi.sky, hemi.ground, hemi.intensity));
      for (const l of [sun, rim]) {
        const light = new THREE.DirectionalLight(l.color, l.intensity);
        light.position.set(...l.position);
        scene.add(light);
      }
      building = { renderer, scene, camera: new THREE.PerspectiveCamera(FOV, 1, 1, 4000), canvas };
    },
    () => {
      if (environment) building.scene.environment = environment(building.renderer);
    },
    () => {
      // シェーダーを先に作っておく（最初のクリアで止まらないように）。色で変わるのは値だけなので1色で足りる
      const { scene, camera, renderer } = building;
      const warm = meshesFor([{ color: 0 }], ['red'], 'hex');
      for (const mesh of warm) scene.add(mesh);
      gl = building;
      resize();
      renderer.compile(scene, camera);
      for (const mesh of warm) {
        scene.remove(mesh);
        mesh.dispose();
      }
    },
  ];
  let stepAt = 0;
  function step() {
    try {
      steps[stepAt++]();
    } catch (e) {
      failed = true;
      (gl ?? building)?.canvas.remove();
      gl = building = null;
      console.warn('rain3d: WebGL unavailable, using flat rain', e);
    }
  }
  // 残りの手順をまとめて進める（前もって作り終えていないうちにクリアしたとき）
  function begin() {
    while (!gl && !failed && stepAt < steps.length) step();
  }
  // 前もって作る。idle() が true の時だけ、1 つずつ間を空けて進める
  let preparing = false;
  function prepare(idle = () => true) {
    if (gl || failed || preparing) return;
    preparing = true;
    const later = (f) => (globalThis.requestIdleCallback ? requestIdleCallback(f, { timeout: 1000 }) : setTimeout(f, 60));
    const next = () => {
      if (gl || failed || stepAt >= steps.length) return;
      if (!idle()) {
        setTimeout(next, 250);
        return;
      }
      step();
      later(next);
    };
    later(next);
  }

  // 1 px が奥行き 0 の面で 1 になるようにカメラを置く（画面の px で並べられる）
  function resize() {
    if (!gl) return;
    const W = window.innerWidth, H = window.innerHeight;
    if (W === size.W && H === size.H) return;
    size = { W, H };
    gl.renderer.setSize(W, H, false);
    gl.camera.aspect = W / H;
    gl.camera.position.set(W / 2, -H / 2, (H / 2) / Math.tan((FOV / 2) * Math.PI / 180));
    gl.camera.lookAt(W / 2, -H / 2, 0);
    gl.camera.updateProjectionMatrix();
  }

  // 色ごと・部品ごとの InstancedMesh。drops の color は colors の番号
  function meshesFor(drops, colors, drive) {
    const out = [];
    colors.forEach((color, c) => {
      const mine = drops.filter((d) => d.color === c);
      if (!mine.length) return;
      for (const { geometry, material } of screwParts(color, R, { knurl: false, drive: drive === 'color' ? driveOf(color) : 'hex', length: LENGTH, coarse: true })) {
        const mesh = new THREE.InstancedMesh(geometry, material, mine.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.userData.drops = mine;
        for (let i = 0; i < mine.length; i++) mesh.setMatrixAt(i, zero);
        out.push(mesh);
      }
    });
    return out;
  }

  function place(mesh, t) {
    const { W, H } = size;
    const px = FX.rain3d.head / (2 * R);   // 頭の直径が FX.rain3d.head px
    mesh.userData.drops.forEach((d, i) => {
      const k = (t - d.delay) / d.ms;
      if (k < 0 || k > 1) {
        mesh.setMatrixAt(i, zero);
        return;
      }
      const f = rainFall(d, k, W, H);
      axis.set(...d.tilt.slice(0, 3));
      q.setFromAxisAngle(axis, d.tilt[3]);
      spinQ.setFromAxisAngle(axis.set(...d.spin), f.angle);
      q.premultiply(spinQ);
      pos.set(f.x, -f.y, d.depth * 60);
      scl.setScalar(px * d.size);
      m.compose(pos, q, scl).multiply(offset);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  function draw() {
    if (!gl || !run) return;
    const t = held ?? clock() - run.t0;
    for (const mesh of run.meshes) place(mesh, t);
    gl.renderer.render(gl.scene, gl.camera);
    onDraw?.();
    return t;
  }

  function loop(now, mine) {
    if (!run || run !== mine) return;   // 止めた・降らせ直した回の残り
    // 降り始めの 8 フレームの間隔の中央値が 34ms を超えたら、解像度を 1 に下げる（1 回だけ）
    if (run.gaps && run.last) {
      run.gaps.push(now - run.last);
      if (run.gaps.length === 8) {
        const med = [...run.gaps].sort((a, b) => a - b)[4];
        if (med > 34 && gl.renderer.getPixelRatio() > 1) {
          slow = true;
          gl.renderer.setPixelRatio(1);
          size = { W: 0, H: 0 };
          resize();
        }
        run.gaps = null;
      }
    }
    run.last = now;
    const t = draw();
    if (held === null && t > run.end) stop();
    else requestAnimationFrame((n) => loop(n, mine));
  }

  function stop() {
    if (!run) return;
    for (const mesh of run.meshes) {
      gl.scene.remove(mesh);
      mesh.dispose();
    }
    run = null;
    held = null;
    gl.renderer.clear();
    gl.canvas.hidden = true;
  }

  return {
    begin,
    prepare,
    get begun() { return !!gl; },
    // 降らせる。colors はこのステージのねじの色の名前、drive は 'hex' か 'color'（設定「ねじ穴の形」）。作れていなければ false
    start(stars, colors, { drive = 'hex' } = {}) {
      if (!gl) begin();
      if (!gl) return false;
      stop();
      resize();
      const drops = rainDrops(stars, colors.length);
      const meshes = meshesFor(drops, colors, drive);
      for (const mesh of meshes) gl.scene.add(mesh);
      run = { t0: clock(), drops, meshes, end: Math.max(...drops.map((d) => d.delay + d.ms)), gaps: [], last: 0 };
      gl.canvas.hidden = false;
      const mine = run;
      requestAnimationFrame((n) => loop(n, mine));
      return true;
    },
    stop,
    // 今降っている本数（画面に出ているもの）。スクリーンショットのスクリプトが待つのに使う
    get falling() {
      if (!run) return 0;
      const t = held ?? clock() - run.t0;
      return run.drops.filter((d) => t >= d.delay && t <= d.delay + d.ms).length;
    },
    // 降り始めから ms の所で止めて描く（null で時計どおりに戻す）。スクリーンショット用
    seek(ms) {
      if (!run) return;
      held = ms;
      if (ms === null) run.t0 = clock() - (run.end + 1);   // 戻したら終わらせる
      draw();
    },
    // 画質: 解像度の上限
    setQuality({ maxRatio: mr = 2 } = {}) {
      maxRatio = slow ? 1 : mr;
      if (!gl || gl.renderer.getPixelRatio() === ratioFor(maxRatio)) return;
      gl.renderer.setPixelRatio(ratioFor(maxRatio));
      size = { W: 0, H: 0 };
      resize();
    },
  };
}
