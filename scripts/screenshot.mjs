// ヘッドレスの Chromium で dist/ を開き、スマホ縦画面のスクリーンショットを撮る。
// 使い方: npm run build && npm run screenshot [-- 出力先のディレクトリ]
// 既定の出力先は screenshots/（git には入れない）。
// ブラウザは PLAYWRIGHT_CHROMIUM か /opt/pw-browsers の Chromium を使い、無ければ playwright-core の既定を探す。
//
// 撮るもの:
//   initial.png  開いた直後
//   removed.png  ねじを指でタップして2本外した後（箱とスロットへ）
//   resting.png  札のねじを外し、落ちた札が天板の上で止まってねじを隠し続けるところ
//   hanging.png  立体を倒して札を払い落とし、天板がねじ1本でぶら下がったところ
//   falling.png  最後のねじを外して天板が落ちていく途中
//   cleared.png  全部外してクリアの画面
//   gen-box.png / gen-shelf.png / gen-table.png  生成した盤面（?seed=番号&kind=種類）を開いた直後（M6）
//   gen-midway.png / gen-cleared.png  生成した箱の盤面を、生成器が見つけた手順どおりに外していく途中と、クリアの画面
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

async function tap(cdp, [x, y]) {
  await touch(cdp, 'touchStart', [[x, y]]);
  await touch(cdp, 'touchEnd', []);
}

// ページの中でねじを外し、演出が終わるまで待つ
async function removeInPage(page, ids) {
  for (const id of ids) {
    const reason = await page.evaluate((id) => window.__app.tapScrew(id), id);
    if (reason !== 'ok') throw new Error(`ねじ ${id} を外せなかった: ${reason}`);
    await waitRendered(page);
  }
}

const shots = [
  { name: 'initial', act: async () => {} },
  // 天板の赤いねじを指でタップして外す（箱へ入る）。続けて前板の緑（合う箱が無いので待機スロットへ）
  { name: 'removed', act: async (cdp, page) => {
    for (const id of ['t1', 'f1']) {
      await tap(cdp, await page.evaluate((id) => window.__app.screenOf(id), id));
      await waitRendered(page);
      const where = await page.evaluate((id) => window.__app.game.state.where[id], id);
      if (where === 'board') throw new Error(`タップでねじ ${id} が外れなかった`);
    }
    // 箱の中の仕切りのねじは隠れていて外せない
    const reason = await page.evaluate(() => window.__app.tapScrew('p1'));
    if (reason !== 'blocked') throw new Error(`隠れたねじ p1 が拒否されなかった: ${reason}`);
    await waitRendered(page);
  } },
  // 札 S のねじを2本続けて外すと、S は落ちて天板の上で止まり、天板のねじ t2 を隠し続ける
  // （1本ずつ間を空けると、傾いた天板の上で S が s2 を軸に回ってから落ちる）
  { name: 'resting', act: async (cdp, page) => {
    const r = await page.evaluate(() => ['s1', 's2'].map((id) => window.__app.tapScrew(id)));
    if (r.some((x) => x !== 'ok')) throw new Error(`札のねじを外せなかった: ${r}`);
    await waitRendered(page);
    const modes = await page.evaluate(() => window.__app.plateModes());
    if (modes.S !== 'loose') throw new Error(`札 S が落ちていない: ${modes.S}`);
    const reason = await page.evaluate(() => window.__app.tapScrew('t2'));
    if (reason !== 'blocked') throw new Error(`止まった札に隠れた t2 が拒否されなかった: ${reason}`);
  } },
  // 立体を倒すと S は滑り落ちて消える。天板のねじを t4 だけ残すと、天板は t4 を軸にぶら下がる
  { name: 'hanging', act: async (cdp, page) => {
    await page.evaluate(() => window.__app.view(1.1, -0.45, 0.3, 27));
    await waitRendered(page);
    const modes = await page.evaluate(() => window.__app.plateModes());
    if (modes.S !== 'gone') throw new Error(`倒しても札 S が落ちない: ${modes.S}`);
    await removeInPage(page, ['t2', 't3']);
    const t = await page.evaluate(() => window.__app.plateModes().T);
    if (t !== 'hanging') throw new Error(`天板がぶら下がっていない: ${t}`);
  } },
  // 最後の t4 を外すと天板が落ちる（落ちている途中を撮る）
  { name: 'falling', wait: false, act: async (cdp, page) => {
    await page.evaluate(() => window.__app.tapScrew('t4'));
    await page.waitForTimeout(260);
  } },
  // 外せるねじを順に外してクリアまで。外せるねじが無ければ、立体の向きを変えて動く板を払い落とす
  { name: 'cleared', act: async (cdp, page) => {
    const views = [[0.45, -0.6, 0], [0, 0, Math.PI / 2], [Math.PI / 2, 0, 0], [0, 0, -Math.PI / 2], [-Math.PI / 2, 0, 0], [Math.PI, 0, 0]];
    let k = 0;
    for (;;) {
      await waitRendered(page);
      const [id] = await page.evaluate(() => window.__app.legal());
      if (!id) {
        const status = await page.evaluate(() => window.__app.game.status);
        if (status !== 'playing') break;
        if (k >= 30) throw new Error('向きを変えても外せるねじが出てこない');
        await page.evaluate((v) => window.__app.view(...v, 19), views[k++ % views.length]);
        continue;
      }
      await removeInPage(page, [id]);
    }
    await page.waitForSelector('#overlay:not([hidden])');
  } },
];

// 生成した盤面（M6）。種類ごとに見栄えのよいシードを選んでいる
const GENERATED = [['box', 4], ['shelf', 2], ['table', 3]];
const VIEWS = [[0.45, -0.6, 0], [0, 0, Math.PI / 2], [Math.PI / 2, 0, 0], [0, 0, -Math.PI / 2], [-Math.PI / 2, 0, 0], [Math.PI, 0, 0]];

// 生成器が見つけた手順どおりに外す。物理で隠れていたら（落ちた板やぶら下がった板）、立体の向きを変えてから外す
async function playSolution(page, until = Infinity) {
  const path = await page.evaluate(() => window.__app.solution);
  if (!path) throw new Error('生成した盤面の手順が無い');
  let k = 0;
  for (const id of path.slice(0, until)) {
    for (let tries = 0; ; tries++) {
      const reason = await page.evaluate((id) => window.__app.tapScrew(id), id);
      if (reason === 'ok' || reason === 'gone') break;
      if (reason !== 'blocked' || tries >= 12) throw new Error(`手順のねじ ${id} を外せない: ${reason}`);
      await page.evaluate((v) => window.__app.view(...v, 19), VIEWS[k++ % VIEWS.length]);
      await waitRendered(page);
    }
    await waitRendered(page);
  }
  return path.length;
}

const genShots = [
  ...GENERATED.map(([kind, seed]) => ({ name: `gen-${kind}`, query: `?seed=${seed}&kind=${kind}`, act: async () => {} })),
  { name: 'gen-midway', query: `?seed=${GENERATED[0][1]}&kind=${GENERATED[0][0]}`, act: async (cdp, page) => {
    await playSolution(page, 8);
    // 払い落とすために変えた向きを、最初の斜めの向きに戻して撮る
    await page.evaluate(() => window.__app.view(0.45, -0.6, 0, 19));
  } },
  { name: 'gen-cleared', act: async (cdp, page) => {
    await playSolution(page);   // 続きから（外したねじは 'gone' になるので、残りだけが外れる）
    await page.waitForSelector('#overlay:not([hidden])');
  } },
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
    await s.act(cdp, page);
    if (s.wait !== false) await waitRendered(page);
    const file = join(outDir, `${s.name}.png`);
    await page.screenshot({ path: file });
    console.log(`screenshot: ${file}`);
  }
  for (const s of genShots) {
    if (s.query) {
      await page.goto(url + s.query);
      await waitRendered(page);
    }
    await s.act(cdp, page);
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
