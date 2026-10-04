// マスコット「ネジまる」（D3）。画面の左下の小さなキャンバスに、盤面とは別の描き手で描く。
// 形・寸法・動きは docs/design/mockup.src.html の試作（ユーザーが了承した形）から写し、
// 動かす部分ごと・材質ごとに形を1つにまとめて（焼いて）描く回数を減らした（試作は約 140 回、ここでは姿勢により 19〜24 回）。
// 動き（姿勢）は mascot-motion.js、どの合図で動くかもそこ。ここは形を作って姿勢を当てるだけ。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THEME } from './theme.js';
import { mascotPose, createMascotState, cueAction } from './mascot-motion.js';

const V3 = (...a) => new THREE.Vector3(...a);

// キャンバスに写す範囲（立体の座標）。跳んでバンザイしても収まる高さと、回っても収まる幅
export const FRAME = { fov: 30, center: [0, 2.3, 0], height: 5.3, yaw: 0.45, pitch: -0.12 };

// 材質。色は theme.js の THEME.mascot
function materials(c = THEME.mascot) {
  return {
    gold: new THREE.MeshPhysicalMaterial({ color: c.gold, metalness: 0.55, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.15, envMapIntensity: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: c.steel, metalness: 0.9, roughness: 0.3, envMapIntensity: 0.8 }),
    vinyl: new THREE.MeshPhysicalMaterial({ color: c.vinyl, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15 }),
    shoe: new THREE.MeshPhysicalMaterial({ color: c.shoe, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }),
    key: new THREE.MeshStandardMaterial({ color: c.key, metalness: 0.7, roughness: 0.4 }),
    hole: new THREE.MeshStandardMaterial({ color: c.socket, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }),
    ink: new THREE.MeshStandardMaterial({ color: c.ink, roughness: 0.4 }),
    eyeW: new THREE.MeshPhysicalMaterial({ color: c.eyeWhite, roughness: 0.15, clearcoat: 1 }),
    iris: new THREE.MeshPhysicalMaterial({ color: c.iris, roughness: 0.2, clearcoat: 1 }),
    irisLo: new THREE.MeshPhysicalMaterial({ color: c.irisLow, roughness: 0.25, clearcoat: 1 }),
    hi: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    cheek: new THREE.MeshStandardMaterial({ color: c.cheek, roughness: 0.6 }),
    mouth: new THREE.MeshStandardMaterial({ color: c.mouth, roughness: 0.5 }),
    tongue: new THREE.MeshStandardMaterial({ color: c.tongue, roughness: 0.5 }),
    sweat: new THREE.MeshPhysicalMaterial({ color: c.sweat, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.92 }),
    shadow: new THREE.MeshBasicMaterial({ color: c.shadow, transparent: true, opacity: c.shadowOpacity, depthWrite: false }),
  };
}

// 動かす部分（userData.part）の下にある、動かない Mesh を材質ごとに1つの形へまとめる。
// 動かす部分どうしの親子はそのまま残す（姿勢の値は、焼く前と同じ部分へそのまま当てられる）
function bake(node) {
  node.updateMatrixWorld(true);
  const inv = node.matrixWorld.clone().invert();
  const byMat = new Map();
  const parts = [];
  (function walk(o) {
    for (const c of o.children) {
      if (c.userData.part) { parts.push(c); continue; }
      if (c.isMesh) {
        const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld));
        if (!byMat.has(c.material)) byMat.set(c.material, []);
        byMat.get(c.material).push(g);
      }
      walk(c);
    }
  })(node);
  for (const c of [...node.children]) node.remove(c);
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    node.add(new THREE.Mesh(merged, mat));
  }
  for (const p of parts) {
    node.add(p);
    // 親から外した間の変換を、焼いた後の親に合わせて付け直す
    p.matrix.copy(inv).multiply(p.matrixWorld);
    p.matrix.decompose(p.position, p.quaternion, p.scale);
    bake(p);
  }
}

// ネジまるの立体を作る。返り値 { root, parts, materials }。parts は姿勢を当てる部分
export function buildMascot() {
  const m = materials();
  const M = (g, mat) => new THREE.Mesh(g, mat);
  const part = (name, o = new THREE.Group()) => { o.userData.part = name; o.name = name; return o; };

  const root = part('root');
  const shadow = part('shadow', M(new THREE.CircleGeometry(1.25, 32), m.shadow));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005;
  shadow.renderOrder = -1;
  const ground = part('ground');   // 影は回らないよう、回る root の外に置く
  ground.add(shadow);
  const body = part('body');
  root.add(body);

  // 靴と脚（脚は銀）
  const legs = [-1, 1].map((s) => {
    const g = part(`leg${s}`);
    g.position.set(s * 0.27, 0.85, 0);
    body.add(g);
    const o = new THREE.Group();
    o.position.y = -0.85;
    g.add(o);
    const leg = M(new THREE.CylinderGeometry(0.1, 0.1, 0.55, 12), m.steel);
    leg.position.y = 0.6;
    o.add(leg);
    const shoeG = new THREE.SphereGeometry(0.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    shoeG.scale(1, 0.95, 1.45);
    const shoe = M(shoeG, m.shoe);
    shoe.position.set(0, 0.09, 0.12);
    o.add(shoe);
    const sole = M(new THREE.CylinderGeometry(0.31, 0.31, 0.09, 20), m.vinyl);
    sole.scale.set(1, 1, 1.47);
    sole.position.set(0, 0.045, 0.12);
    o.add(sole);
    const cuff = M(new THREE.TorusGeometry(0.13, 0.045, 8, 18), m.shoe);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = 0.36;
    o.add(cuff);
    return g;
  });

  // ねじ部（胴）とねじ山
  const shaft = M(new THREE.CylinderGeometry(0.47, 0.47, 1.6, 24), m.steel);
  shaft.position.y = 1.55;
  body.add(shaft);
  class Helix extends THREE.Curve {
    getPoint(t) {
      const a = t * Math.PI * 2 * 7.5;
      return V3(Math.cos(a) * 0.47, 2.25 - t * 1.4, Math.sin(a) * 0.47);
    }
  }
  body.add(M(new THREE.TubeGeometry(new Helix(), 150, 0.06, 6, false), m.steel));

  // 頭: 円筒頭＋面取り＋ローレット＋六角穴（キャップボルト）
  const head = part('head');
  head.position.y = 2.3;
  body.add(head);
  const R = 0.97, H = 1.28, HEX = 0.56;
  const prof = [[0, 0], [R - 0.04, 0], [R, 0.04], [R, H - 0.12], [R - 0.1, H], [0.62, H]].map(([x, y]) => new THREE.Vector2(x, y));
  head.add(M(new THREE.LatheGeometry(prof, 48), m.gold));
  const top = new THREE.Shape();
  top.absarc(0, 0, 0.63, 0, Math.PI * 2, false);
  const hp = new THREE.Path();
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const p = [Math.cos(a) * HEX, Math.sin(a) * HEX];
    if (i) hp.lineTo(...p); else hp.moveTo(...p);
  }
  top.holes.push(hp);
  const topG = new THREE.ShapeGeometry(top, 24);
  topG.rotateX(-Math.PI / 2);
  const topM = M(topG, m.gold);
  topM.position.y = H;
  head.add(topM);
  const wall = M(new THREE.CylinderGeometry(HEX, HEX, 0.6, 6, 1, true, 0), m.hole);
  wall.position.y = H - 0.3;
  head.add(wall);
  const floorG = new THREE.CircleGeometry(HEX, 6, Math.PI / 6);
  floorG.rotateX(-Math.PI / 2);
  const floor = M(floorG, m.hole);
  floor.position.y = H - 0.6;
  head.add(floor);
  const knurl = new THREE.BoxGeometry(0.035, H - 0.32, 0.05);
  for (let i = 0; i < 84; i++) {
    const a = (i / 84) * Math.PI * 2;
    const k = M(knurl, m.gold);
    k.position.set(Math.sin(a) * R, (H - 0.32) / 2 + 0.16, Math.cos(a) * R);
    k.rotation.y = a;
    head.add(k);
  }

  // 顔: 頭の側面（円筒）に沿って貼る。phi は正面からの角度
  const onHead = (parent, o, phi, y, out = 0) => {
    const g = new THREE.Group();
    g.rotation.y = phi;
    o.position.set(0, y, R + 0.03 + out);
    g.add(o);
    parent.add(g);
    return o;
  };
  // 開いた目（縦長の大きな瞳）。瞬きは eyesOpen を目の高さで縦につぶす
  const EYE_Y = 0.56;
  const eyesOpen = part('eyesOpen');
  eyesOpen.position.y = EYE_Y;
  head.add(eyesOpen);
  for (const s of [-1, 1]) {
    const e = new THREE.Group();
    const D = (r, mat, sx, sy, x, y, z, sz = 0.3) => {
      const o = M(new THREE.SphereGeometry(r, 20, 12), mat);
      o.scale.set(sx, sy, sz);
      o.position.set(x, y, z);
      e.add(o);
    };
    D(0.2, m.eyeW, 1, 1.25, 0, 0, 0);                      // 白目
    D(0.182, m.iris, 1, 1.22, 0, -0.008, 0.012);           // 瞳（濃い茶）
    D(0.09, m.irisLo, 1.25, 0.5, 0, -0.135, 0.026);        // 瞳の下の明るい茶
    D(0.1, m.ink, 1, 1.15, 0, 0.005, 0.045);               // 黒目
    D(0.062, m.hi, 1, 1.1, 0.06, 0.085, 0.08, 0.4);        // 大きなハイライト
    D(0.028, m.hi, 1, 1, -0.065, -0.085, 0.08, 0.4);       // 小さなハイライト
    const g = new THREE.Group();
    g.rotation.y = s * 0.34;
    e.position.set(0, 0, R + 0.02);
    e.scale.setScalar(1.22);
    g.add(e);
    eyesOpen.add(g);
  }
  // ^ ^ の目と × の目
  const eyesHappy = part('eyesHappy');
  head.add(eyesHappy);
  for (const s of [-1, 1]) {
    const a = M(new THREE.TorusGeometry(0.13, 0.035, 8, 18, Math.PI), m.ink);
    a.scale.setScalar(1.3);
    onHead(eyesHappy, a, s * 0.4, 0.52, 0.02);
  }
  const eyesX = part('eyesX');
  head.add(eyesX);
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.rotation.y = s * 0.4;
    eyesX.add(g);
    for (const r of [0.78, -0.78]) {
      const b = M(new THREE.BoxGeometry(0.32, 0.075, 0.06), m.ink);
      b.rotation.z = r;
      b.position.set(0, 0.6, R + 0.05);
      g.add(b);
    }
  }
  // 眉（ふつう・困り眉）
  const browsNormal = part('browsNormal');
  const browsWorried = part('browsWorried');
  head.add(browsNormal, browsWorried);
  for (const [i, s] of [-1, 1].entries()) {
    for (const [group, extra] of [[browsNormal, 0], [browsWorried, i ? -0.35 : 0.35]]) {
      const b = M(new THREE.TorusGeometry(0.12, 0.025, 6, 16, Math.PI * 0.7), m.ink);
      b.rotation.z = Math.PI * 0.15 + extra;
      onHead(group, b, s * 0.36, 0.93, 0.02);
    }
  }
  // ほっぺ
  for (const s of [-1, 1]) {
    const c = M(new THREE.SphereGeometry(0.12, 12, 8), m.cheek);
    c.scale.set(1.25, 0.8, 0.25);
    onHead(head, c, s * 0.66, 0.33, 0);
  }
  // 口（開いた口・への字）
  const mouthOpen = part('mouthOpen');
  onHead(head, mouthOpen, 0, 0.32, 0.01);
  mouthOpen.add(M(new THREE.CircleGeometry(0.15, 20, Math.PI, Math.PI), m.mouth));
  const tg = M(new THREE.CircleGeometry(0.08, 16), m.tongue);
  tg.scale.set(1.1, 0.7, 1);
  tg.position.set(0, -0.1, 0.005);
  mouthOpen.add(tg);
  const lip = M(new THREE.TorusGeometry(0.15, 0.018, 6, 18, Math.PI), m.ink);
  lip.rotation.z = Math.PI;
  mouthOpen.add(lip);
  const mouthSad = part('mouthSad', M(new THREE.TorusGeometry(0.11, 0.025, 6, 16, Math.PI), m.ink));
  onHead(head, mouthSad, 0, 0.3, 0.02);
  // 汗
  const sweat = part('sweat');
  const drop = M(new THREE.SphereGeometry(0.09, 12, 8), m.sweat);
  sweat.add(drop);
  const tip = M(new THREE.ConeGeometry(0.085, 0.16, 12), m.sweat);
  tip.position.y = 0.1;
  sweat.add(tip);
  onHead(head, sweat, 0.78, 0.8, 0.05);

  // 腕・手袋・六角レンチ
  function glove() {
    const g = new THREE.Group();
    const palm = M(new THREE.SphereGeometry(0.17, 16, 10), m.vinyl);
    palm.scale.set(1, 1.1, 0.9);
    g.add(palm);
    const th = M(new THREE.SphereGeometry(0.07, 10, 8), m.vinyl);
    th.scale.set(1, 1.6, 1);
    th.position.set(0.13, 0.06, 0.06);
    th.rotation.z = -0.6;
    g.add(th);
    const cuff = M(new THREE.TorusGeometry(0.12, 0.045, 8, 16), m.vinyl);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = 0.17;
    g.add(cuff);
    return g;
  }
  const arms = [-1, 1].map((s) => {
    const a = part(`arm${s}`);
    a.position.set(s * 0.47, 2.02, 0);
    body.add(a);
    const up = M(new THREE.CylinderGeometry(0.085, 0.085, 0.62, 10), m.vinyl);
    up.position.y = -0.31;
    a.add(up);
    const h = s < 0 ? part('hand') : new THREE.Group();
    h.add(glove());
    h.position.y = -0.7;
    if (s > 0) h.scale.x = -1;
    a.add(h);
    return { a, h };
  });
  const key = part('key');
  arms[0].h.add(key);
  const k1 = M(new THREE.CylinderGeometry(0.055, 0.055, 1.0, 6), m.key);
  k1.position.y = 0.25;
  key.add(k1);
  const k2 = M(new THREE.CylinderGeometry(0.055, 0.055, 0.38, 6), m.key);
  k2.rotation.z = Math.PI / 2;
  k2.position.set(0.16, 0.75, 0);
  key.add(k2);
  const kn = M(new THREE.SphereGeometry(0.055, 8, 6), m.key);
  kn.position.set(0, 0.75, 0);
  key.add(kn);
  key.position.set(0, 0.02, 0.05);

  bake(root);
  bake(ground);
  knurl.dispose();
  const parts = {};
  for (const g of [root, ground]) g.traverse((o) => { if (o.userData.part) parts[o.userData.part] = o; });
  for (const p of Object.values(parts)) p.userData.rest = { position: p.position.clone(), quaternion: p.quaternion.clone(), scale: p.scale.clone() };
  const holder = new THREE.Group();
  holder.add(ground, root);
  return { root: holder, parts, materials: m };
}

// 姿勢（mascot-motion.js の mascotPose）を立体へ当てる。yaw は体の向き（画面の中ほどを向く）
export function applyPose(parts, p, yaw = 0) {
  const P = parts;
  const rest = (o) => o.userData.rest;
  P.root.position.y = p.y;
  P.root.rotation.set(0, yaw + p.spin, p.shake);
  const s = p.squash;
  P.body.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
  P.body.rotation.set(0, 0, p.sway);
  P.head.rotation.set(p.headTilt, 0, p.headSide);
  // 腕（z: 横に開く、x: 前へ出す）。画面左＝キャラの右手
  P['arm-1'].rotation.set(p.armR[1], 0, -p.armR[0]);
  P.arm1.rotation.set(p.armL[1], 0, -p.armL[0]);
  P.hand.rotation.set(0, 0, p.armR[2]);
  P.key.rotation.set(0, 0, p.armR[0] - p.armR[2] - 0.15 + p.keyFlip * 2.9);
  P['leg-1'].rotation.x = p.legSwing;
  P.leg1.rotation.x = -p.legSwing * 0.6;
  // 顔
  P.eyesOpen.visible = p.face === 'open';
  P.eyesOpen.scale.y = p.blink ? 0.1 : 1;
  P.eyesHappy.visible = p.face === 'happy';
  P.eyesX.visible = p.face === 'x';
  P.browsNormal.visible = p.brows === 'normal';
  P.browsWorried.visible = p.brows === 'worried';
  P.mouthOpen.visible = p.mouth !== 'sad';
  P.mouthOpen.scale.setScalar(p.mouth === 'big' ? 1.25 : 1);
  P.mouthSad.visible = p.mouth === 'sad';
  P.sweat.visible = p.sweat !== null;
  if (p.sweat !== null) {
    P.sweat.position.copy(rest(P.sweat).position);
    P.sweat.position.y -= p.sweat * 0.4;
    P.sweat.scale.setScalar(1 - p.sweat * 0.35);
  }
  // 影は跳ぶと小さく薄くなる
  P.shadow.scale.setScalar(1 - Math.min(0.4, p.y * 0.8));
}

// カメラを FRAME に合わせる（aspect はキャンバスの幅 / 高さ）
export function frameCamera(camera, aspect) {
  const { fov, center, height, yaw, pitch } = FRAME;
  camera.fov = fov;
  camera.aspect = aspect;
  const dist = height / 2 / Math.tan((fov * Math.PI) / 360);
  const c = V3(...center);
  camera.position.set(c.x + Math.sin(yaw) * Math.cos(pitch) * dist, c.y - Math.sin(pitch) * dist, c.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  camera.lookAt(c);
  camera.updateProjectionMatrix();
}

// 画面に出すネジまる。canvas に描き、clock()（ミリ秒、演出の時計）で動く。
// 動いている間は毎フレーム、待機中は 1/idleEvery の間隔で描く（小さなキャンバスなので軽いが、待機は長いので電池を気にする）。
// maxRatio は描く解像度の上限、idleEvery は待機中に何フレームに1回描くか（設定の画質で変える）
export function createMascot(canvas, { clock = () => performance.now(), environment = null, maxRatio = 2, idleEvery = 2 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  const ratioFor = (max) => Math.min(max, window.devicePixelRatio || 1);
  renderer.setPixelRatio(ratioFor(maxRatio));
  let enabled = true;   // 設定で隠したら描かない
  const scene = new THREE.Scene();
  const { hemi, sun, rim } = THEME.lights;
  scene.add(new THREE.HemisphereLight(hemi.sky, hemi.ground, hemi.intensity));
  for (const l of [sun, rim]) {
    const light = new THREE.DirectionalLight(l.color, l.intensity);
    light.position.set(...l.position);
    scene.add(light);
  }
  if (environment) scene.environment = environment(renderer);
  const camera = new THREE.PerspectiveCamera();
  const { root, parts } = buildMascot();
  scene.add(root);
  const state = createMascotState(clock());
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let forced = null;   // スクリーンショット用に姿勢を決め打ちする { action, t }
  let frameNo = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    frameCamera(camera, r.width / r.height);
  }
  // 置き場所（左下・終わりの画面のカード）で大きさが変わるので、キャンバスの大きさを見張る
  if (globalThis.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);
  resize();

  function draw() {
    const now = clock();
    const cur = forced ?? state.current(now);
    applyPose(parts, mascotPose(cur.action, cur.t, forced ? forced.t : now / 1000, still), FRAME.yaw * 0.6);
    renderer.render(scene, camera);
  }
  function loop() {
    requestAnimationFrame(loop);
    if (!enabled) return;
    const { action } = state.current(clock());
    if (action === 'idle' && !forced && frameNo++ % idleEvery) return;
    draw();
  }
  requestAnimationFrame(loop);

  const history = [];   // 見せた動きの名前（新しい 20 個）。スクリーンショットのスクリプトが合図とのつながりを確かめる
  const played = (ok, action) => {
    if (ok) history.push(action);
    if (history.length > 20) history.shift();
    return ok;
  };
  return {
    // 合図（feedback.js の cue の名前）を受ける。動くなら true
    react: (cue, opts) => played(state.react(cue, clock(), opts), cueAction(cue, opts)),
    play: (action) => played(state.play(action, clock()), action),
    history,
    reset: () => state.reset(clock()),
    get action() { return state.current(clock()).action; },
    // 出す・隠す（隠している間は描かない。キャンバスの表示は呼ぶ側が CSS で切り替える）
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },
    // 画質: 解像度の上限と、待機中に何フレームに1回描くか
    setQuality({ maxRatio: m = 2, idleEvery: k = 2 } = {}) {
      idleEvery = Math.max(1, k);
      renderer.setPixelRatio(ratioFor(m));
      resize();
    },
    // 姿勢を決め打ちする（null で戻す）。スクリーンショット用
    force(action, t = 0) {
      forced = action ? { action, t } : null;
      draw();
    },
  };
}
