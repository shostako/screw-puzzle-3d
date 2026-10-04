// 速さを測る（E11）。ヘッドレスの Chromium で dist/ を ?perf 付きで開き、同じ操作を流して数値を残す。
// 使い方: npm run build && npm run perf [-- 名前]        → perf/<名前>.json に書き、表を出す（既定の名前は now）
//         npm run perf -- --compare 前.json 後.json      → 2 つの結果を並べた表（PR に貼る用）
//
// 測るもの（E11 の完了条件）
//   起動: 開いてから最初の盤面を描き終えて起動の画面が閉じるまでの時間（3 回の中央値）。
//         ネット無し（CPU は 4 倍遅く）と、Slow 4G 相当（下り 1.6Mbps・往復 150ms、CPU 4 倍遅く）の 2 通り。
//         配る時と同じく gzip して返す（GitHub Pages も gzip する）。物理の wasm を読み終えた時刻も記録する
//   回す: ステージ 37（6 色）を 8 秒回し続けた間のフレーム時間（前半 4 秒と後半 4 秒）（平均・p95・40fps を切った割合）、
//         renderer.render の時間、描く回数・三角形。画質「自動」と「軽い」
//   外す: ステージ 37 を手順どおりに外していく間のフレーム時間（ねじが抜ける演出と板が落ちる物理）
//   雨:   クリアした直後（ねじの雨と★の演出）の 2.5 秒のページ全体のフレーム間隔
//   止まっている時: 何も触らない 3 秒の間に、盤面とネジまるを何回描いたか（止まっている時は盤面を描かない）
//
// ヘッドレスはソフトウェアの GL（SwiftShader）で描くので、数値そのものは実機より遅い。変更の前と後を同じ機械で比べるためのもの。
// 実機では ?perf を付けて開くと、左上に同じ計器が出る（docs/DEVICE-CHECK.md）。
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.webp': 'image/webp' };
const GZIP = new Set(['.html', '.js', '.css', '.svg', '.json', '.wasm']);
const VIEWPORT = { width: 390, height: 844 };
const RUNS = 3;   // 起動と回すは 3 回の中央値
const SLOW_4G = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };

const args = process.argv.slice(2);
if (args[0] === '--compare') {
  const [a, b] = args.slice(1, 3).map((f) => JSON.parse(readFileSync(f, 'utf8')));
  console.log(table(a, b));
  process.exit(0);
}
const label = args[0] ?? 'now';
// PERF=startup,rotate,play で測る組を絞れる（既定は全部。絞った結果は表の一部が空になる）
const only = (group) => !process.env.PERF || process.env.PERF.split(',').includes(group);

const dist = resolve(new URL('../dist/', import.meta.url).pathname);
const zipped = new Map();
function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(dist, path.endsWith('/') ? path + 'index.html' : path);
    if (!file.startsWith(dist)) return res.writeHead(403).end();
    try {
      const ext = extname(file);
      let body = await readFile(file);
      const head = { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' };
      if (GZIP.has(ext) && /gzip/.test(req.headers['accept-encoding'] ?? '')) {
        if (!zipped.has(file)) zipped.set(file, gzipSync(body, { level: 9 }));
        body = zipped.get(file);
        head['content-encoding'] = 'gzip';
      }
      head['content-length'] = body.length;
      res.writeHead(200, head).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  for (const dir of readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
      const p = join(base, dir, rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser, { quality = 'auto' } = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await context.addInitScript((q) => {
    localStorage.setItem('screw-puzzle-3d.settings', JSON.stringify({ quality: q }));
    // 起動の画面が閉じた時刻（ページの時計、ミリ秒）
    const watch = () => {
      if (window.__app && !window.__app.booting) window.__firstBoard = performance.now();
      else requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  }, quality);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp };
}

async function waitRendered(page) {
  await page.waitForFunction(() => window.__app?.rendered, null, { timeout: 60000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

// 起動の時間
async function startup(browser, url, network) {
  const out = [];
  for (let i = 0; i < RUNS; i++) {
    const { context, page, cdp } = await newPage(browser);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (network) await cdp.send('Network.emulateNetworkConditions', network);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(url + '?stage=1&perf', { waitUntil: 'commit' });
    await page.waitForFunction(() => window.__firstBoard, null, { timeout: 120000, polling: 100 });
    out.push(await page.evaluate(() => {
      const res = performance.getEntriesByType('resource');
      const end = (re) => res.find((r) => re.test(r.name))?.responseEnd ?? null;
      const marks = Object.fromEntries(performance.getEntriesByType('mark').filter((m) => m.name.startsWith('e11:')).map((m) => [m.name.slice(4), Math.round(m.startTime)]));
      const wasm = res.find((r) => /\.wasm/.test(r.name));
      return { firstBoard: window.__firstBoard, wasmStart: wasm?.fetchStart ?? null, wasmEnd: end(/\.wasm/), jsEnd: end(/index-[^/]*\.js/), marks };
    }));
    await context.close();
  }
  const pick = (k) => median(out.map((o) => o[k]).filter((v) => v != null));
  const marks = {};
  for (const k of Object.keys(out[0].marks)) marks[k] = median(out.map((o) => o.marks[k]));
  return { firstBoard: pick('firstBoard'), wasmStart: pick('wasmStart'), wasmEnd: pick('wasmEnd'), jsEnd: pick('jsEnd'), marks, runs: out.map((o) => Math.round(o.firstBoard)) };
}

// ステージ 37 を 8 秒回し続ける。指の動き（CDP のタッチ）は送る間隔が揺れて、描く速さより入力の速さを測ってしまうので、
// ページの中で毎フレーム向きを少しずつ変える（回す操作と同じく、変えた次のフレームで描く）。
// 最初の 4 秒（画質「自動」が解像度を下げる前後）と、後の 4 秒（下げ終わった後）を分けて記録する。
// ヘッドレスは回ごとの揺れが大きいので 3 回回して、最初の 4 秒のフレーム平均が中央の回を採る
async function rotate(browser, url, quality) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await rotateOnce(browser, url, quality));
  runs.sort((a, b) => a.avg - b.avg);
  return { ...runs[1], runs: runs.map((r) => Math.round(r.avg)) };
}
async function rotateOnce(browser, url, quality) {
  const { context, page } = await newPage(browser, { quality });
  await page.goto(url + '?stage=37&perf');
  await waitRendered(page);
  const s = await page.evaluate(() => new Promise((done) => {
    const app = window.__app;
    const [x, y, z] = [app.model.rotation.x, app.model.rotation.y, app.model.rotation.z];
    app.perf.reset();
    const t0 = performance.now();
    let first = null;
    const tick = (t) => {
      const k = (t - t0) / 1000;
      app.view(x + 0.3 * Math.sin(k * 1.7), y + k * 1.4, z);
      if (!first && k >= 4) {
        first = app.perf.stats();
        app.perf.reset();
      }
      if (k < 8) requestAnimationFrame(tick);
      else requestAnimationFrame(() => done({ ...first, later: app.perf.stats() }));
    };
    requestAnimationFrame(tick);
  }));
  await context.close();
  return s;
}

// ステージ 37 を手順どおりに外していく間、クリアの後のねじの雨、止まっている時
async function play(browser, url) {
  const { context, page } = await newPage(browser);
  await page.goto(url + '?stage=37&perf');
  await waitRendered(page);
  // 止まっている 3 秒（盤面は描かないはず。ネジまるは待機の動きで間引いて描く）
  await page.evaluate(() => window.__app.perf.reset());
  await sleep(3000);
  const idle = await page.evaluate(() => window.__app.perf.stats());
  // 外していく（screenshot.mjs の playSolution と同じ。物理で落ちた板に隠れていれば、立体の向きを変えてから外す）
  await page.evaluate(() => window.__app.perf.reset());
  const ids = await page.evaluate(() => window.__app.solution);
  const views = [[0.45, -0.6, 0], [0, 0, Math.PI / 2], [Math.PI / 2, 0, 0], [0, 0, -Math.PI / 2], [-Math.PI / 2, 0, 0], [Math.PI, 0, 0]];
  let k = 0;
  for (const id of ids) {
    for (let tries = 0; ; tries++) {
      const reason = await page.evaluate((id) => window.__app.tapScrew(id), id);
      if (reason === 'ok' || reason === 'gone') break;
      if (reason !== 'blocked' || tries >= 12) throw new Error(`ねじ ${id} を外せなかった: ${reason}`);
      await page.evaluate((v) => window.__app.view(...v, 1), views[k++ % views.length]);
      await waitRendered(page);
    }
    if (id !== ids.at(-1)) await waitRendered(page);
  }
  const removing = await page.evaluate(() => window.__app.perf.stats());
  // クリアの画面が出たら、ページ全体のフレーム間隔を 2.5 秒測る（雨と★は DOM の演出なので rAF の間隔で見る）
  await page.waitForFunction(() => !document.getElementById('overlay').hidden, null, { timeout: 60000 });
  const rain = await page.evaluate(() => new Promise((done) => {
    const gaps = [];
    let last = 0;
    const t0 = performance.now();
    const tick = (t) => {
      if (last) gaps.push(t - last);
      last = t;
      if (t - t0 < 2500) requestAnimationFrame(tick);
      else {
        gaps.sort((a, b) => a - b);
        done({ frames: gaps.length, avg: gaps.reduce((a, b) => a + b, 0) / gaps.length, p95: gaps[Math.ceil(gaps.length * 0.95) - 1], drops: document.querySelectorAll('#rain > *').length });
      }
    };
    requestAnimationFrame(tick);
  }));
  await context.close();
  return { idle, removing, rain };
}

const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
});
const result = { label, at: new Date().toISOString(), bytes: {} };
try {
  for (const f of readdirSync(join(dist, 'assets'))) {
    const ext = extname(f);
    const raw = readFileSync(join(dist, 'assets', f));
    const key = ext.slice(1);
    result.bytes[key] ??= { raw: 0, gzip: 0 };
    result.bytes[key].raw += raw.length;
    result.bytes[key].gzip += GZIP.has(ext) ? gzipSync(raw, { level: 9 }).length : raw.length;
  }
  if (only('startup')) {
    result.startupLocal = await startup(browser, url, null);
    console.log('起動（ネット無し）', result.startupLocal);
    result.startup4g = await startup(browser, url, SLOW_4G);
    console.log('起動（Slow 4G）', result.startup4g);
  }
  if (only('rotate')) {
    result.rotateAuto = await rotate(browser, url, 'auto');
    result.rotateLight = await rotate(browser, url, 'light');
  }
  if (only('play')) Object.assign(result, await play(browser, url));
} finally {
  await browser.close();
  server.close();
}
await mkdir('perf', { recursive: true });
await writeFile(join('perf', `${label}.json`), JSON.stringify(result, null, 2));
console.log(`perf/${label}.json`);
console.log(table(result));

// 結果の表（Markdown）。b があれば前（a）と後（b）を並べる
function table(a, b) {
  const ms = (v) => (v == null ? '-' : `${Math.round(v)} ms`);
  const ms1 = (v) => (v == null ? '-' : `${v.toFixed(1)} ms`);
  const pct = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`);
  const kb = (v) => (v == null ? '-' : `${Math.round(v / 1024)} KB`);
  const per = (r, k) => (r ? (r[k] / 3).toFixed(1) : '-');
  const rows = [
    ['JS（gzip）', (r) => kb(r.bytes.js?.gzip)],
    ['物理の wasm（gzip）', (r) => kb(r.bytes.wasm?.gzip)],
    ['最初の盤面まで（ネット無し・CPU 4 倍遅く）', (r) => ms(r.startupLocal.firstBoard)],
    ['最初の盤面まで（Slow 4G・CPU 4 倍遅く）', (r) => ms(r.startup4g.firstBoard)],
    ['　うち wasm を読み終えた時刻（Slow 4G）', (r) => ms(r.startup4g.wasmEnd)],
    ['ステージ 37 を回す: 最初の 4 秒のフレーム平均（自動）', (r) => ms1(r.rotateAuto.avg)],
    ['　p95（自動）', (r) => ms1(r.rotateAuto.p95)],
    ['　40fps を切った割合（自動）', (r) => pct(r.rotateAuto.slow)],
    ['　後の 4 秒のフレーム平均（自動）', (r) => ms1(r.rotateAuto.later.avg)],
    ['　render の時間（自動）', (r) => ms1(r.rotateAuto.renderMs)],
    ['　描く回数・三角形（自動）', (r) => `${r.rotateAuto.calls}・${(r.rotateAuto.triangles / 1000).toFixed(1)}k`],
    ['　8 秒後の解像度（自動）', (r) => String(r.rotateAuto.later.pixelRatio)],
    ['　8 秒後の描く回数・三角形（自動）', (r) => `${r.rotateAuto.later.calls}・${(r.rotateAuto.later.triangles / 1000).toFixed(1)}k`],
    ['ステージ 37 を回す: フレーム平均（軽い）', (r) => ms1(r.rotateLight.avg)],
    ['　p95（軽い）', (r) => ms1(r.rotateLight.p95)],
    ['　描く回数・三角形（軽い）', (r) => `${r.rotateLight.calls}・${(r.rotateLight.triangles / 1000).toFixed(1)}k`],
    ['ステージ 37 を外していく: フレーム平均', (r) => ms1(r.removing.avg)],
    ['　p95', (r) => ms1(r.removing.p95)],
    ['クリア直後（ねじの雨）: フレーム平均', (r) => ms1(r.rain.avg)],
    ['　p95', (r) => ms1(r.rain.p95)],
    ['止まっている時: 盤面を描いた回数／秒', (r) => per(r.idle, 'drawn')],
    ['止まっている時: ネジまるを描いた回数／秒', (r) => per(r.idle, 'mascotDrawn')],
  ];
  const head = b ? `| 項目 | 変更前 | 変更後 |\n|---|---:|---:|` : `| 項目 | ${a.label} |\n|---|---:|`;
  const cell = (r, f) => { try { return f(r); } catch { return '-'; } };
  return [head, ...rows.map(([name, f]) => `| ${name} | ${cell(a, f)} |${b ? ` ${cell(b, f)} |` : ''}`)].join('\n');
}
