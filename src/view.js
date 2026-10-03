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
