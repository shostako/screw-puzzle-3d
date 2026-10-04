// 普段の画面の背景（F2）: 空の奥のおもちゃの町並み（遠近の2列）、流れる雲、ゆっくり昇る粒。
// 形は index.html の #backdrop（SVG と span）、色と動きは style.css。3D の外の CSS で描くので、盤面を描く回数は増えない。
// ここは立体を左右に回した分だけ町並みをずらす（わずかな視差）ことだけを受け持つ。

// 2つの向き（四元数 [x, y, z, w]）の差の、上下の軸（世界の y）まわりの角度（ラジアン、-π〜π）。
// 立体を右へ回すと正。差が大きくても（盤面が変わって向きを戻した時など）y 軸の成分だけを取り出す
export function yawDelta(q, prev) {
  const [ax, ay, az, aw] = q;
  const [bx, by, bz, bw] = [-prev[0], -prev[1], -prev[2], prev[3]];   // prev の逆
  let w = aw * bw - ax * bx - ay * by - az * bz;
  let y = aw * by + ay * bw + az * bx - ax * bz;
  if (w < 0) {
    w = -w;
    y = -y;
  }
  return 2 * Math.atan2(y, w);
}

// 町並みを左へずらす量（px）。tile は列の繰り返しの幅、rate は 1 ラジアンでずらす量。いつも 0 以上 tile 未満。
// 立体を右へ回すと町並みは左へ（回す中心より奥の物は、手前の面と逆へ動いて見える）
export function townShift(yaw, tile, rate) {
  const x = (yaw * rate) % tile;
  return x < 0 ? x + tile : x;
}

// 列ごとの繰り返しの幅と、1 ラジアンでずらす量（遠い列ほど少なく）
export const LAYERS = [
  { id: 'bd-far', tile: 360, rate: 26 },
  { id: 'bd-near', tile: 480, rate: 54 },
];

export function createBackdrop(doc = document) {
  const layers = LAYERS.map((l) => ({ ...l, el: doc.getElementById(l.id), shown: NaN }));
  let prev = null;
  let yaw = 0;
  return {
    get yaw() { return yaw; },
    // 描くたびに立体の向きを渡す。ずれが 0.5px 未満なら触らない（止まっている時は何もしない）
    update(q) {
      const now = [q.x, q.y, q.z, q.w];
      if (prev) yaw += yawDelta(now, prev);
      prev = now;
      for (const l of layers) {
        if (!l.el) continue;
        const x = townShift(yaw, l.tile, l.rate);
        if (Math.abs(x - l.shown) < 0.5) continue;
        l.shown = x;
        l.el.style.transform = `translate3d(${(-x).toFixed(1)}px, 0, 0)`;
      }
    },
  };
}
