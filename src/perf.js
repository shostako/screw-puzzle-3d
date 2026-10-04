// 速さの計器（E11）。?perf を付けて開くと、画面の左上にフレーム時間・描く回数・三角形・メモリを出す。
// scripts/perf.mjs は同じ数値を window.__app.perf から読んで表にする。?perf が無ければ何も測らない（作りもしない）。
//
// フレーム時間は「続けて描いたフレームの間隔」。止まっていた後の1フレーム（250ms を超える間隔）は数えない
// （止まっている時に描かないのは正しい振る舞いで、それを遅いフレームと数えないため）。250ms までは引っかかりとして数える。

// 画質「自動」の解像度を下げるかの判断（E11）。続けて描いたフレームの間隔を 40 個（とても遅い端末では 1.5 秒分、最低 10 個）ためて、
// 中央値が 24ms（40fps）を超えたら true。
// 前は平均で見て、100ms を超える間隔が1つでも来たらためた分を捨てていたので、引っかかりの多い遅い端末ほど
// 40 個たまらず、下げる判断に届かなかった。いまは 250ms を超える間隔（止まっていた後・指を止めていた間）だけを飛ばし、
// 指を一瞬止めた程度の長い間隔は中央値なので効かない
export const SLOW_FRAME_MS = 24;
export const WATCH_FRAMES = 40;
export const STALL_MS = 250;
export const WATCH_MS = 1500;
export const MIN_FRAMES = 10;
export function slowFrames(times, interval) {
  if (interval == null || interval > STALL_MS) return false;
  times.push(interval);
  const enough = times.length >= WATCH_FRAMES || (times.length >= MIN_FRAMES && times.reduce((a, b) => a + b, 0) >= WATCH_MS);
  if (!enough) return false;
  const median = [...times].sort((a, b) => a - b)[times.length >> 1];
  times.length = 0;
  return median > SLOW_FRAME_MS;
}
const KEEP = 120;   // 直近の何フレームで平均と p95 を出すか

// 間隔の並びから平均・p95・最大・40fps を切った割合（24ms 超）
export function summarize(intervals) {
  const n = intervals.length;
  if (!n) return { frames: 0, avg: 0, p95: 0, max: 0, slow: 0 };
  const sorted = [...intervals].sort((a, b) => a - b);
  const avg = intervals.reduce((a, b) => a + b, 0) / n;
  const p95 = sorted[Math.min(n - 1, Math.ceil(n * 0.95) - 1)];
  return { frames: n, avg, p95, max: sorted[n - 1], slow: intervals.filter((t) => t > 24).length / n };
}

// 描く繰り返しから呼ぶ計器。frame(now, renderMs) を描いたフレームごとに呼ぶ
export function createPerf({ renderer, now = () => performance.now() } = {}) {
  let last = null;
  let intervals = [];
  let renders = [];
  let drawn = 0;       // 描いた回数の合計（止まっている時に描いていないかを数える）
  let mascotDrawn = 0;
  const started = now();
  const all = [];      // 測り始め（reset）からの全部の間隔。scripts/perf.mjs が区間ごとに読む
  const allRender = [];
  return {
    frame(t, renderMs) {
      drawn++;
      if (last != null && t - last <= STALL_MS) {
        intervals.push(t - last);
        all.push(t - last);
        if (intervals.length > KEEP) intervals = intervals.slice(-KEEP);
      }
      renders.push(renderMs);
      allRender.push(renderMs);
      if (renders.length > KEEP) renders = renders.slice(-KEEP);
      last = t;
    },
    mascot() { mascotDrawn++; },
    // 区間の測り直し（スクリプトが場面ごとに呼ぶ）
    reset() {
      all.length = 0;
      allRender.length = 0;
      drawn = 0;
      mascotDrawn = 0;
      last = null;
    },
    stats() {
      const info = renderer?.info;
      const heap = globalThis.performance?.memory?.usedJSHeapSize;
      const r = allRender.length ? allRender.reduce((a, b) => a + b, 0) / allRender.length : 0;
      return {
        ...summarize(all),
        recent: summarize(intervals),
        renderMs: r,
        drawn,
        mascotDrawn,
        calls: info?.render.calls ?? 0,
        triangles: info?.render.triangles ?? 0,
        geometries: info?.memory.geometries ?? 0,
        textures: info?.memory.textures ?? 0,
        heapMB: heap ? heap / 2 ** 20 : null,
        pixelRatio: renderer?.getPixelRatio?.() ?? null,
        uptime: now() - started,
      };
    },
  };
}

// 画面の左上の小さな表。0.5 秒ごとに書き換える（書き換えのために 3D を描き直すことはしない）
export function mountPerfPanel(perf, doc = document) {
  const el = doc.createElement('pre');
  el.id = 'perf';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:fixed;left:4px;top:env(safe-area-inset-top,0);z-index:99;margin:0;padding:3px 5px;'
    + 'font:10px/1.25 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.55);border-radius:4px;pointer-events:none;white-space:pre';
  doc.body.append(el);
  const f = (v, d = 1) => (v == null ? '-' : v.toFixed(d));
  setInterval(() => {
    const s = perf.stats();
    const r = s.recent;
    el.textContent = `${f(r.avg)}ms p95 ${f(r.p95)} (${r.avg ? f(1000 / r.avg, 0) : '-'}fps)\n`
      + `draw ${f(s.renderMs, 2)}ms ×${s.drawn} m${s.mascotDrawn}\n`
      + `calls ${s.calls} tri ${(s.triangles / 1000).toFixed(1)}k\n`
      + `geo ${s.geometries} tex ${s.textures} heap ${f(s.heapMB, 0)}MB dpr ${f(s.pixelRatio, 2)}`;
  }, 500);
  return el;
}
