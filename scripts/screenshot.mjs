// ヘッドレスの Chromium で dist/ を開き、スマホ縦画面のスクリーンショットを撮る。
// 使い方: npm run build && npm run screenshot [-- 出力先のディレクトリ]
// 既定の出力先は screenshots/（git には入れない）。
// ブラウザは PLAYWRIGHT_CHROMIUM か /opt/pw-browsers の Chromium を使い、無ければ playwright-core の既定を探す。
//
// 撮るもの:
//   initial.png  開いた直後
//   rotated.png  1本指で横にドラッグした後
//   zoomed.png   2本指で広げた後
// 以後の PR では、このファイルの shots に場面を足して使い回す。
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const dist = resolve(new URL('../dist/', import.meta.url).pathname);
const outDir = resolve(process.argv[2] ?? 'screenshots');

// 代表的なスマホ縦画面（CSS ピクセル）
const VIEWPORT = { width: 390, height: 844 };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(dist, path.endsWith('/') ? path + 'index.html' : path);
    if (!file.startsWith(dist)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
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

async function waitRendered(page) {
  await page.waitForFunction(() => window.__app?.rendered);
  // 描いた後の1フレームを待ってから撮る
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

// CDP でタッチを送る（Playwright の touchscreen はタップしか無いため）
async function touch(cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })),
  });
}

async function drag(cdp, from, to, steps = 12) {
  await touch(cdp, 'touchStart', [from]);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await touch(cdp, 'touchMove', [[from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]]);
  }
  await touch(cdp, 'touchEnd', []);
}

async function pinch(cdp, center, fromGap, toGap, steps = 12) {
  const at = (g) => [[center[0] - g / 2, center[1]], [center[0] + g / 2, center[1]]];
  await touch(cdp, 'touchStart', at(fromGap));
  for (let i = 1; i <= steps; i++) await touch(cdp, 'touchMove', at(fromGap + ((toGap - fromGap) * i) / steps));
  await touch(cdp, 'touchEnd', []);
}

const shots = [
  { name: 'initial', act: async () => {} },
  { name: 'rotated', act: async (cdp) => drag(cdp, [120, 520], [300, 470]) },
  { name: 'zoomed', act: async (cdp) => pinch(cdp, [195, 450], 80, 220) },
];

const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  executablePath: findChromium(),
  // ヘッドレスでも WebGL が描けるよう、ソフトウェアの GL を使う
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // 外部への読み込みがあれば記録する（dist/ だけで動くことの確認）
  const outside = [];
  page.on('request', (r) => !r.url().startsWith(url) && !r.url().startsWith('data:') && outside.push(r.url()));

  await page.goto(url);
  await waitRendered(page);
  const cdp = await context.newCDPSession(page);
  await mkdir(outDir, { recursive: true });
  for (const s of shots) {
    await s.act(cdp);
    await waitRendered(page);
    const file = join(outDir, `${s.name}.png`);
    await page.screenshot({ path: file });
    console.log(`screenshot: ${file}`);
  }
  if (outside.length) throw new Error(`外部への読み込みがあった: ${outside.join(', ')}`);
  if (errors.length) throw new Error(`ページでエラー: ${errors.join(' / ')}`);
} finally {
  await browser.close();
  server.close();
}
