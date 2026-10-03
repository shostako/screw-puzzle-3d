// Android 版に同梱するページ（android/app/src/main/assets/public、npm run app:web が作る）を、
// ネットを遮断したヘッドレスの Chromium で開き、ネット無しで遊べることを確かめる。
// 使い方: npm run app:web && npm run app:offline [-- 出力先のディレクトリ]
//   - 127.0.0.1 以外の名前は引けず、127.0.0.1 以外への要求は全部打ち切る。外部への要求が1件でもあれば失敗
//   - .wasm は application/wasm ではなく application/octet-stream で返す（サーバーが wasm の型を付けない場合でも読めるか）
//   - Capacitor の SystemBars が入れる --safe-area-inset-* を仮に入れ、HUD とボタンがその分だけ内側に寄るか
//   - ステージ 1 を手順どおりに外してクリアまで進め、JS のエラーが無いか
// 撮るもの: app-stage1.png（開いた直後）、app-cleared.png（クリアの画面）
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve(new URL('../android/app/src/main/assets/public/', import.meta.url).pathname);
const outDir = resolve(process.argv[2] ?? 'screenshots');
if (!existsSync(join(root, 'index.html'))) throw new Error(`${root} が無い。先に npm run app:web`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(root, path.endsWith('/') ? path + 'index.html' : path);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const url = `http://127.0.0.1:${server.address().port}/`;

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

const SAFE = { top: 32, right: 0, bottom: 24, left: 0 };
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--no-proxy-server'],
});
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const outside = [];
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(url) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    outside.push(u);
    return route.abort('internetdisconnected');
  });
  await context.addInitScript((safe) => {
    document.addEventListener('DOMContentLoaded', () => {
      for (const [k, v] of Object.entries(safe)) document.documentElement.style.setProperty(`--safe-area-inset-${k}`, `${v}px`);
    });
  }, SAFE);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const settle = () => page.waitForFunction(() => window.__app?.rendered, null, { timeout: 40000 });

  await page.goto(url);
  await settle();
  const stage = await page.evaluate(() => window.__app.stage);
  if (stage !== 1) throw new Error(`ステージ 1 から始まるはずが ${stage}`);
  const pad = await page.evaluate(() => [getComputedStyle(document.getElementById('hud')).paddingTop, getComputedStyle(document.getElementById('tools')).bottom]);
  if (pad[0] !== `${SAFE.top + 10}px` || pad[1] !== `${SAFE.bottom + 16}px`) throw new Error(`安全域の余白が効いていない: ${pad}`);
  await mkdir(outDir, { recursive: true });
  await page.screenshot({ path: join(outDir, 'app-stage1.png') });

  const path = await page.evaluate(() => window.__app.solution);
  if (!path) throw new Error('ステージ 1 の手順が無い');
  const views = [[0.45, -0.6, 0], [-0.45, 2.5, 0], [Math.PI / 2, 0, 0], [-Math.PI / 2, 0, 0], [0, Math.PI, 0], [0, Math.PI / 2, 0], [0, -Math.PI / 2, 0]];
  let k = 0;
  for (const id of path) {
    for (let tries = 0; ; tries++) {
      const reason = await page.evaluate((id) => window.__app.tapScrew(id), id);
      if (reason === 'ok' || reason === 'gone') break;
      if (reason === 'over' && await page.evaluate(() => window.__app.game.status) === 'cleared') break;
      if (reason !== 'blocked' || tries >= 12) throw new Error(`手順のねじ ${id} を外せない: ${reason}`);
      await page.evaluate((v) => window.__app.view(...v, 19), views[k++ % views.length]);
      await settle();
    }
    await settle();
  }
  await page.waitForSelector('#overlay:not([hidden])');
  if (await page.evaluate(() => window.__app.game.status) !== 'cleared') throw new Error('クリアにならない');
  await page.screenshot({ path: join(outDir, 'app-cleared.png') });

  if (outside.length) throw new Error(`外部への要求があった: ${outside.join(', ')}`);
  if (errors.length) throw new Error(`ページでエラー: ${errors.join(' / ')}`);
  console.log(`offline: ok（外部への要求 0 件、ステージ 1 をクリア、安全域 上${SAFE.top}px 下${SAFE.bottom}px）`);
} finally {
  await browser.close();
  server.close();
}
