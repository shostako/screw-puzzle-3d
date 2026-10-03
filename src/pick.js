// タップした位置からねじを選ぶ。描画に依存しない。
//
// 先に光線（レイキャスト）でまっすぐ当たったものを見る。当たったのがねじならそれ。
// 板や何も無い所に当たったときは、指の太さを見込んで、画面上で近くに見えているねじを選ぶ。

// 指の太さの分、ねじ頭の中心から何ピクセル（CSS）までをそのねじのタップとみなすか。
// 指の腹が画面に触れる幅はおよそ 8〜10mm で、CSS の 1px は 1/96 インチなので、半径 32px ≈ 8.5mm の円にする（M8 で 24 から広げた）。
// 近くに複数あれば一番近いものを選ぶので、隣り合うねじの間でも、近い方が選ばれる
export const PICK_RADIUS_PX = 32;

// candidates: [{ id, x, y }]（見えているねじの画面上の位置、CSS ピクセル）
// 一番近いものの id。maxPx より遠ければ null
export function nearestScrew(candidates, x, y, maxPx = PICK_RADIUS_PX) {
  let best = null, bestD = maxPx;
  for (const c of candidates) {
    const d = Math.hypot(c.x - x, c.y - y);
    if (d <= bestD) { best = c.id; bestD = d; }
  }
  return best;
}
