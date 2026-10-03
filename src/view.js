// 立体の回し方とカメラの寄り引きの計算。three.js に依存しない。

// 1ピクセルのドラッグで回る角度（ラジアン）。画面の大きさが分からないときの既定
export const RAD_PER_PX = 0.01;

// 画面の短い辺を端から端までなぞると半回転（180 度）する、1ピクセルあたりの角度（M8）。
// 固定の 0.01 では、幅 390 の画面を横切ると 220 度も回って行き過ぎ、裏と表を見失いやすかった。
// 小さい画面でも回しすぎないよう、短い辺は 320 以上とみなす
export function radPerPx(width, height) {
  const short = Math.min(width, height);
  return Number.isFinite(short) && short > 0 ? Math.PI / Math.max(320, short) : RAD_PER_PX;
}

// 画面上のドラッグ量を、カメラから見た回転軸と角度に直す。
// カメラは +Z から原点を見ていて、画面の右が +X、上が +Y。画面の y は下向きに増える。
// 右へドラッグすると手前の面が右へ、下へドラッグすると手前の面が下へ動く。
export function dragRotation(dx, dy, radPerPx = RAD_PER_PX) {
  const len = Math.hypot(dx, dy);
  if (len === 0) return { axis: [0, 1, 0], angle: 0 };
  return { axis: [dy / len, dx / len, 0], angle: len * radPerPx };
}

export const MIN_DISTANCE = 5.5;
export const MAX_DISTANCE = 14;

// ピンチの比でカメラの距離を変える。指が広がる（scale > 1）と近づく。
export function zoomDistance(distance, scale, min = MIN_DISTANCE, max = MAX_DISTANCE) {
  if (!(scale > 0)) return distance;
  return Math.min(max, Math.max(min, distance / scale));
}

// ---- 構図（E1）: 立体を HUD と右下のボタン列の間の空きに収める ----

// 最初の向きで見た立体が、空きの幅か高さ（きつい方）に占める割合
export const FIT_FILL = 0.82;
// どの向きに回しても大きくはみ出さないよう、立体を包む球の直径は空きの短い辺のこの倍までにする
export const SPHERE_MAX = 1.35;
// ピンチで寄れる・引ける範囲（収めた距離に対する比）
export const ZOOM_RANGE = { min: 0.62, max: 1.8 };

// 画面（幅 w・高さ h の CSS ピクセル）の中で立体を置く空きの四角を決める。
// top は HUD の下端、bottom は右下のボタン列の上端。小さい画面でボタン列が高く空きが横幅より極端に低いときは、
// 横幅の 0.8 倍の高さまでは下へ延ばす（ボタン列は右の端だけなので、球の右下の隅が少し掛かるだけ）
export function fitRegion(w, h, top, bottom, side = 12) {
  const width = Math.max(1, w - 2 * side);
  const low = Math.min(h, Math.max(bottom, top + 0.8 * width));
  return { x: w / 2, y: (top + low) / 2, width, height: Math.max(1, low - top) };
}

// 縦の画角 fovDeg・画面の高さ h のときの焦点距離（ピクセル）
export const focalPx = (h, fovDeg) => h / 2 / Math.tan((fovDeg * Math.PI) / 360);

// 半径 radius の球を見たとき、見かけの直径が空きの短い辺の fill 倍になる距離。
// 見かけの半径 = f·R / √(d² − R²)（f は焦点距離をピクセルで表したもの）を d について解く
export function fitDistance(radius, region, h, fovDeg, fill = SPHERE_MAX) {
  const f = focalPx(h, fovDeg);
  const px = (Math.min(region.width, region.height) / 2) * fill;
  return radius * Math.sqrt(1 + (f / px) ** 2);
}

// 点の集まり（カメラから見た座標 x, y, z を並べた配列。カメラは +Z の距離 d から原点を見る）を、
// 原点を空きの真ん中に置いたまま、空きの幅と高さの fill 倍に収める距離。
// 点 (x, y, z) の画面の位置は f·x / (d − z) なので、|f·x / (d − z)| ≤ 幅/2·fill を d について解いた最大
export function fitPoints(points, region, h, fovDeg, fill = FIT_FILL) {
  const f = focalPx(h, fovDeg);
  const hw = (region.width / 2) * fill, hh = (region.height / 2) * fill;
  let d = 0;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i], y = points[i + 1], z = points[i + 2];
    d = Math.max(d, z + (f * Math.abs(x)) / hw, z + (f * Math.abs(y)) / hh);
  }
  return d;
}

// 距離 d から見た点の集まりの、原点からの見かけの広がり（ピクセル。左右・上下のうち大きい方）
export function spreadPx(points, d, h, fovDeg) {
  const f = focalPx(h, fovDeg);
  let r = 0;
  for (let i = 0; i < points.length; i += 3) {
    const k = f / (d - points[i + 2]);
    r = Math.max(r, Math.abs(points[i]) * k, Math.abs(points[i + 1]) * k);
  }
  return r;
}

// ---- 慣性（E1）: 指を離したときの速さで回り続け、なめらかに減速して止まる ----

export const INERTIA = {
  window: 90,      // 離す直前のこの時間（ミリ秒）の動きから速さを出す
  stillMs: 70,     // 最後に動いてからこれだけ止めていたら、離しても回さない（止めてから離した）
  tau: 220,        // 速さが 1/e になる時間（ミリ秒）。惰性で進む量は 速さ × tau
  maxSpeed: 2.4,   // 速さの上限（ピクセル毎ミリ秒）。強くはじいても回りすぎない
  minStart: 0.25,  // これより遅く離したら回さない（ゆっくり置いた指）
  minSpeed: 0.02,  // ここまで遅くなったら止める
  maxStep: 50,     // 1回に進める時間の上限（描画が途切れた後に飛ばない）
};

// 回す速さの出どころは指の移動量（ピクセル）なので、設定の「回す速さ」は回す側（ピクセル→角度）でそのまま効く。
export function createInertia(opt = INERTIA) {
  let samples = [];   // { dx, dy, t }
  let vx = 0, vy = 0; // 惰性の速さ（ピクセル毎ミリ秒）

  // 指で動かした分を覚える（t は出来事の時刻、ミリ秒）
  function push(dx, dy, t) {
    samples.push({ dx, dy, t });
    while (samples.length && samples[0].t < t - opt.window) samples.shift();
  }
  // 指が離れた。回り始めるなら true
  function release(t) {
    const recent = samples.filter((s) => s.t >= t - opt.window);
    samples = [];
    vx = vy = 0;
    if (!recent.length || t - recent[recent.length - 1].t > opt.stillMs) return false;
    // 窓の中の最初の出来事は、それより前からの移動を含むので、時間の起点にだけ使う。
    // 出来事が1つだけなら、1フレーム（16 ミリ秒）で動いたとみなす
    const moves = recent.length > 1 ? recent.slice(1) : recent;
    const span = recent.length > 1 ? Math.max(8, t - recent[0].t) : 16;
    let sx = 0, sy = 0;
    for (const s of moves) { sx += s.dx; sy += s.dy; }
    vx = sx / span;
    vy = sy / span;
    const v = Math.hypot(vx, vy);
    if (v < opt.minStart) { vx = vy = 0; return false; }
    if (v > opt.maxSpeed) { vx *= opt.maxSpeed / v; vy *= opt.maxSpeed / v; }
    return true;
  }
  // dt ミリ秒進める。この間に回す量（ピクセル）を返す。止まったら null
  function step(dt) {
    if (!active()) return null;
    dt = Math.min(Math.max(dt, 0), opt.maxStep);
    // 速さ v·e^(−t/τ) をこの間で積分した量
    const k = Math.exp(-dt / opt.tau);
    const move = opt.tau * (1 - k);
    const out = { dx: vx * move, dy: vy * move };
    vx *= k;
    vy *= k;
    if (Math.hypot(vx, vy) < opt.minSpeed) vx = vy = 0;
    return out;
  }
  // 指が触れた・向きを戻すなど。回っていたら止める。止めたときの速さを返す（ピクセル毎ミリ秒）
  function stop() {
    const v = Math.hypot(vx, vy);
    vx = vy = 0;
    samples = [];
    return v;
  }
  const active = () => vx !== 0 || vy !== 0;
  return { push, release, step, stop, get active() { return active(); }, get speed() { return Math.hypot(vx, vy); } };
}
