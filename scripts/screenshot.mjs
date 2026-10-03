// ヘッドレスの Chromium で dist/ を開き、スマホ縦画面のスクリーンショットを撮る。
// 使い方: npm run build && npm run screenshot [-- 出力先のディレクトリ]
// 既定の出力先は screenshots/（git には入れない）。
// ブラウザは PLAYWRIGHT_CHROMIUM か /opt/pw-browsers の Chromium を使い、無ければ playwright-core の既定を探す。
//
// 撮るもの:
//   （固定の箱 ?level=box で）
//   initial.png  開いた直後
//   removed.png  ねじを指でタップして2本外した後（箱とスロットへ）
//   resting.png  札のねじを外し、落ちた札が天板の上で止まってねじを隠し続けるところ
//   hanging.png  立体を倒して札を払い落とし、天板がねじ1本でぶら下がったところ
//   falling.png  最後のねじを外して天板が落ちていく途中
//   pulling.png / flying.png / unscrewed.png  ねじ1本を外す途中: 抜ける向きに抜けているところ（pulling-zoom.png はその拡大）、箱かスロットへ飛んでいるところ、入った後。
//                あわせて、立体のねじと飛ぶ印が同じフレームに両方出ない（外したねじは常に1本に見える）ことを確かめる
//   cleared.png  全部外してクリアの画面
//   gen-box.png / gen-shelf.png / gen-table.png  生成した盤面（?seed=番号&kind=種類）を開いた直後（M6）
//   gen-midway.png / gen-cleared.png  生成した箱の盤面を、生成器が見つけた手順どおりに外していく途中と、クリアの画面
//   （ステージの進行、M7。保存の無い新しい端末として開く）
//   stage1.png          初めて開いた直後（ステージ 1）
//   stage1-turned.png   ステージ 1 で見えている面のねじを外し、立体を回して裏のねじを見せたところ
//   stage1-cleared.png  ステージ 1 のクリア画面（次のステージへ）
//   stage2.png / stage3.png  「次のステージへ」を指でタップして進んだ直後
//   stage4-resumed.png  ステージ 3 までクリアしてから再読み込みした直後（続きのステージ 4 から始まる）
//   stage5.png / stage6.png / stage20.png  先のステージ（?stage=番号）を開いた直後
//   （画面の大きさ、M8。小さめ 360×640・普通 390×844・大きめ 430×932 の縦画面）
//   size-<名前>.png         ステージ 7 を開いた直後
//   size-<名前>-midway.png  生成した箱（シード 4）を手順どおりに 8 本外し、箱とスロットが埋まりかけたところ
//   size-<名前>-cleared.png 同じ盤面をクリアした画面
//   あわせて、ねじの中心から少し外れた所のタップで外れること、「向きを戻す」で最初の向きに戻ること、
//   音と振動の切り替えが再読み込みの後も残ることを確かめる
//   （分解の演出、D2。生成した箱 ?seed=4&kind=box を手順どおりに外しながら）
//   fx-unscrew.png   ねじが回りながら抜けている途中の拡大（ねじ部が見える）
//   fx-burst.png     最後のねじが抜けた板がぷくっと膨らんで光ったところ
//   fx-box.png       満杯の箱のふたが閉まり、星が散ったところ
//   fx-drop.png      盤面の外へ落ちた板が回りながら画面の下へ消えていくところ
//   あわせて、演出の後に立体の描く物の数が増えていない（板が消えた分だけ減る）ことを確かめる
// SHOTS=stage のように組を絞って撮れる。以後の PR では、このファイルの shots に場面を足して使い回す。
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const dist = resolve(new URL('../dist/', import.meta.url).pathname);
const outDir = resolve(process.argv[2] ?? 'screenshots');
// SHOTS=box,gen,stage,size,fx,undo で撮る組を絞れる（既定は全部）。box は固定の箱、gen は生成した盤面、stage はステージの進行、size は画面の大きさ、fx は分解の演出、undo は戻る
const only = (group) => !process.env.SHOTS || process.env.SHOTS.split(',').includes(group);

// 代表的なスマホ縦画面（CSS ピクセル）
const VIEWPORT = { width: 390, height: 844 };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm' };

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

// 描画と物理が落ち着くまで待つ。M7 までは、板が触れ合ったまま止まらないときに警告だけ出して先へ進めていたが、
// M8 で物理が必ず落ち着くようにしたので、待ちきれなければ失敗にする。
// （物理の歯止めは 1200 刻み。ヘッドレスの遅い描画では1フレームに 4 刻みしか進めないので、余裕をみて長めに待つ）
const SETTLE_MS = 40000;
async function waitRendered(page) {
  try {
    await page.waitForFunction(() => window.__app?.rendered, null, { timeout: SETTLE_MS });
  } catch (e) {
    const why = await page.evaluate(() => window.__app?.why?.()).catch(() => null);
    throw new Error(`描画が落ち着かない: ${JSON.stringify(why)}`, { cause: e });
  }
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
  // ねじ1本を外す演出を毎フレーム記録しながら、抜けている途中を撮る
  { name: 'pulling', wait: false, act: async (cdp, page) => {
    await waitRendered(page);
    const id = await page.evaluate(() => {
      // 外せて、いまの向きで見えているねじ
      const seen = new Set(window.__app.visibleScrews().map((s) => s.id));
      const id = window.__app.legal().find((id) => seen.has(id));
      if (!id) return null;
      const trace = window.__trace = [];
      const rec = () => {
        trace.push({ shown: window.__app.screwShown(id), flyers: document.querySelectorAll('#flyers .flyer').length });
        if (!window.__app.rendered || trace.length < 3) requestAnimationFrame(rec);
      };
      if (window.__app.tapScrew(id) !== 'ok') return null;
      requestAnimationFrame(rec);
      return id;
    });
    if (!id) throw new Error('外せるねじが無い');
    // 抜けているねじの周りを拡大して残す（抜けはじめて数フレームの所）
    await page.waitForFunction(() => window.__trace.length >= 3);
    const [x, y] = await page.evaluate((id) => window.__app.screenOf(id), id);
    const file = join(outDir, 'pulling-zoom.png');
    await page.screenshot({ path: file, clip: { x: x - 90, y: y - 90, width: 180, height: 180 } });
    console.log(`screenshot: ${file}`);
  } },
  { name: 'flying', wait: false, act: async (cdp, page) => {
    await page.waitForSelector('#flyers .flyer');
    await page.waitForTimeout(120);
  } },
  { name: 'unscrewed', act: async (cdp, page) => {
    await waitRendered(page);
    const trace = await page.evaluate(() => window.__trace);
    const both = trace.filter((f) => f.shown && f.flyers > 0).length;
    if (both) throw new Error(`外したねじが2本に見えたフレームがある: ${both} / ${trace.length}`);
    if (!trace.some((f) => f.shown)) throw new Error('ねじが抜ける様子が出ていない');
    if (!trace.some((f) => f.flyers > 0)) throw new Error('ねじが箱やスロットへ飛んでいない');
    if (trace.at(-1).shown) throw new Error('外したねじが立体に残っている');
    console.log(`ねじ1本の演出: 抜ける ${trace.filter((f) => f.shown).length} フレーム → 飛ぶ ${trace.filter((f) => f.flyers).length} フレーム（両方出たフレーム 0）`);
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
      // 手順の外の順で先に外していれば、手順の途中でクリアになっている
      if (reason === 'over' && await page.evaluate(() => window.__app.game.status) === 'cleared') return path.length;
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

// ステージの進行（M7）。新しい端末（保存なし）でステージ 1 から順にクリアして進め、再読み込みで続きから始まることを確かめる
async function stageShots(context, errors, outside) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => !r.url().startsWith(url) && !r.url().startsWith('data:') && outside.push(r.url()));
  const cdp = await context.newCDPSession(page);
  const shoot = async (name) => {
    await waitRendered(page);
    const file = join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    console.log(`screenshot: ${file}`);
  };
  const expectStage = async (n) => {
    const [stage, title] = await page.evaluate(() => [window.__app.stage, document.getElementById('title').textContent]);
    if (stage !== n || title !== `ステージ ${n}`) throw new Error(`ステージ ${n} のはずが ${stage}（${title}）`);
  };
  const tapButton = async (sel) => {
    const box = await page.locator(sel).boundingBox();
    await tap(cdp, [box.x + box.width / 2, box.y + box.height / 2]);
  };

  await page.goto(url);
  await waitRendered(page);
  await expectStage(1);
  await shoot('stage1');
  // 最初の向きで外せる（見えている）ねじを外し切ったら、回して裏を見せる
  for (;;) {
    const [id] = await page.evaluate(() => {
      const seen = new Set(window.__app.visibleScrews().map((s) => s.id));
      return window.__app.legal().filter((id) => seen.has(id));
    });
    if (!id) break;
    await tap(cdp, await page.evaluate((id) => window.__app.screenOf(id), id));
    await waitRendered(page);
  }
  const left = await page.evaluate(() => window.__app.legal().length);
  if (!left) throw new Error('ステージ 1 で、見えない面に残るねじが無い');
  await drag(cdp, [195, 600], [195 - 170, 600 - 40]);
  await drag(cdp, [195, 600], [195 - 90, 600 - 110]);
  await shoot('stage1-turned');
  await playSolution(page);
  await page.waitForSelector('#overlay:not([hidden]) #next:not([hidden])');
  await shoot('stage1-cleared');
  for (const n of [2, 3]) {
    await tapButton('#next');
    await page.waitForFunction((n) => window.__app.stage === n && window.__app.rendered, n);
    await expectStage(n);
    await shoot(`stage${n}`);
    await playSolution(page);
    await page.waitForSelector('#overlay:not([hidden]) #next:not([hidden])');
  }
  // 「次へ」を押さずに再読み込みしても、続きのステージ 4 から始まる
  await page.reload();
  await waitRendered(page);
  await expectStage(4);
  await shoot('stage4-resumed');
  for (const n of [5, 6, 20]) {
    await page.goto(url + `?stage=${n}`);
    await waitRendered(page);
    await expectStage(n);
    await shoot(`stage${n}`);
  }
  // 見るだけ（?stage=）では到達は進まない
  await page.goto(url);
  await waitRendered(page);
  await expectStage(4);
  await context.close();
}

// 画面の大きさ（M8）。代表的なスマホの縦画面
const SIZES = [['small', { width: 360, height: 640 }], ['normal', { width: 390, height: 844 }], ['large', { width: 430, height: 932 }]];

async function sizeShots(browser, errors, outside) {
  for (const [name, viewport] of SIZES) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('request', (r) => !r.url().startsWith(url) && !r.url().startsWith('data:') && outside.push(r.url()));
    const cdp = await context.newCDPSession(page);
    const shoot = async (file) => {
      await waitRendered(page);
      const path = join(outDir, `${file}.png`);
      await page.screenshot({ path });
      console.log(`screenshot: ${path}`);
    };
    // HUD・右下のボタン・立体が画面からはみ出していないか
    const checkLayout = async () => {
      const bad = await page.evaluate(() => {
        const out = [];
        const w = window.innerWidth, h = window.innerHeight;
        for (const sel of ['#bar', '#boxes .box', '#slots', '#hint', '#tools button', '#restart']) {
          for (const el of document.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r.left < 0 || r.top < 0 || r.right > w + 0.5 || r.bottom > h + 0.5) out.push(`${sel} が画面の外 ${JSON.stringify(r)}`);
          }
        }
        // 盤面のねじが全部、HUD より下・右下のボタンに重ならない所に見えている（最初の向き）
        const hud = document.getElementById('hud').getBoundingClientRect().bottom;
        for (const s of window.__app.level ? window.__app.visibleScrews() : []) {
          if (s.x < 0 || s.x > w || s.y < hud - 10 || s.y > h) out.push(`ねじ ${s.id} が画面の外か HUD の下 (${s.x | 0}, ${s.y | 0})`);
        }
        return out;
      });
      if (bad.length) throw new Error(`${name}: レイアウトが崩れている: ${bad.join(' / ')}`);
    };

    await page.goto(url + '?stage=7');
    await waitRendered(page);
    await checkLayout();
    await shoot(`size-${name}`);

    // 指の腹の幅: ねじ頭の中心から 26px（M7 までの判定の半径 24 の外）ずれた所をタップしても、そのねじが外れる。
    // 周りのねじから 60px 以上離れたねじを選び、一番近いねじと反対の向きにずらす（ずらした先でも、ほかのねじより近い）
    const target = await page.evaluate(() => {
      const seen = window.__app.visibleScrews();
      const legal = new Set(window.__app.legal());
      for (const s of seen) {
        if (!legal.has(s.id)) continue;
        const others = seen.filter((o) => o.id !== s.id).sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y));
        const n = others[0];
        const d = n ? Math.hypot(n.x - s.x, n.y - s.y) : Infinity;
        if (d < 60) continue;
        const [ux, uy] = n ? [(s.x - n.x) / d, (s.y - n.y) / d] : [1, 0];
        return { id: s.id, x: s.x + 26 * ux, y: s.y + 26 * uy };
      }
      return null;
    });
    if (!target) throw new Error(`${name}: 周りの空いた外せるねじが無い`);
    await tap(cdp, [target.x, target.y]);
    await waitRendered(page);
    if (await page.evaluate((id) => window.__app.game.state.where[id], target.id) === 'board') {
      throw new Error(`${name}: 中心から 26px ずれたタップでねじ ${target.id} が外れなかった`);
    }

    // 回してから「向きを戻す」をタップすると、最初の向きに戻る
    const mid = [viewport.width / 2, viewport.height * 0.6];
    await drag(cdp, mid, [mid[0] - 150, mid[1] + 60]);
    const homeBox = await page.locator('#home').boundingBox();
    const offHome = () => page.evaluate(() => {
      const q = window.__app.model.quaternion, s = window.__app.startQuaternion;
      return 1 - Math.abs(q.x * s[0] + q.y * s[1] + q.z * s[2] + q.w * s[3]);
    });
    if (await offHome() < 1e-3) throw new Error(`${name}: ドラッグで回っていない`);
    // ドラッグの直後（同じ刻み）のタップは、Chrome がボタンの click にしない（人の指ではありえない速さ）。少し間を空ける
    await page.waitForTimeout(300);
    await tap(cdp, [homeBox.x + homeBox.width / 2, homeBox.y + homeBox.height / 2]);
    // ボタンの click はタッチの後に届き、0.35 秒かけて戻る
    await page.waitForFunction(() => {
      const q = window.__app.model.quaternion, s = window.__app.startQuaternion;
      return 1 - Math.abs(q.x * s[0] + q.y * s[1] + q.z * s[2] + q.w * s[3]) < 1e-6;
    }, null, { timeout: 5000 }).catch(async () => {
      throw new Error(`${name}: 「向きを戻す」で最初の向きに戻らない (${await offHome()})`);
    });
    await waitRendered(page);

    // 生成した箱を途中まで外す（箱とスロットが埋まりかける）
    await page.goto(url + '?seed=4&kind=box');
    await waitRendered(page);
    await playSolution(page, 8);
    await page.evaluate(() => window.__app.view(0.45, -0.6, 0, 19));
    await checkLayout();
    await shoot(`size-${name}-midway`);
    await playSolution(page);
    await page.waitForSelector('#overlay:not([hidden])');
    await shoot(`size-${name}-cleared`);
    const card = await page.locator('#overlay .card').boundingBox();
    if (card.x < 0 || card.x + card.width > viewport.width) throw new Error(`${name}: クリアの札が画面からはみ出す`);

    if (name === 'normal') {
      // 音と振動を切ると、再読み込みしても切れたまま
      const sb = await page.locator('#sound').boundingBox();
      await page.locator('#again').click();
      await tap(cdp, [sb.x + sb.width / 2, sb.y + sb.height / 2]);
      await page.reload();
      await waitRendered(page);
      const pressed = await page.locator('#sound').getAttribute('aria-pressed');
      if (pressed !== 'false') throw new Error(`音と振動の切り替えが残らない: ${pressed}`);
    }
    await context.close();
  }
}


// 分解の演出（D2）。生成した箱を手順どおりに外しながら、それぞれの演出の途中を撮る
async function fxShots(context, errors, outside) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => !r.url().startsWith(url) && !r.url().startsWith('data:') && outside.push(r.url()));
  const save = async (name, clip) => {
    const path = join(outDir, `${name}.png`);
    await page.screenshot({ path, clip });
    console.log(`screenshot: ${path}`);
  };
  // 立体で描く物（Mesh）の数。演出で立体を足していないことを確かめる
  const meshCount = () => page.evaluate(() => {
    let n = 0;
    window.__app.model.parent.traverse((o) => { if (o.isMesh && o.visible) n++; });
    return n;
  });
  await page.goto(url + '?seed=4&kind=box');
  await waitRendered(page);
  const before = await meshCount();
  const path = await page.evaluate(() => window.__app.solution);
  const want = new Set(['fx-unscrew', 'fx-burst', 'fx-box', 'fx-drop']);
  let k = 0;
  for (const id of path) {
    if (!want.size) break;
    let reason;
    const seen = await page.evaluate((id) => window.__app.visibleScrews().some((s) => s.id === id), id);
    // 抜ける途中を撮るときは、演出の時計を 1/20 の速さにしておく
    if (want.has('fx-unscrew') && seen) await page.evaluate(() => window.__app.timeScale(0.05));
    for (let tries = 0; ; tries++) {
      reason = await page.evaluate((id) => window.__app.tapScrew(id), id);
      if (reason === 'ok' || reason === 'gone') break;
      if (reason !== 'blocked' || tries >= 12) throw new Error(`手順のねじ ${id} を外せない: ${reason}`);
      await page.evaluate((v) => window.__app.view(...v, 19), VIEWS[k++ % VIEWS.length]);
      await waitRendered(page);
    }
    if (reason !== 'ok') continue;
    if (want.has('fx-unscrew') && seen) {
      // 抜け始めて、ねじ部が板から出たところ（立体のねじがまだ見えている間）
      const [x, y] = await page.evaluate((id) => window.__app.screenOf(id), id);
      const ok = await page.waitForFunction((id) => {
        const s = window.__app.screw(id);
        return s.visible && s.scale.x === 1 && s.userData.lift > 0.14;
      }, id, { timeout: 10000, polling: 'raf' }).then(() => true, () => false);
      if (ok) {
        await page.evaluate(() => window.__app.timeScale(0));
        await save('fx-unscrew', { x: x - 80, y: y - 100, width: 160, height: 160 });
        want.delete('fx-unscrew');
      }
      await page.evaluate(() => window.__app.timeScale(1));
    }
    const shot = await Promise.race([
      page.waitForFunction(() => {
        let swollen = false;
        window.__app.model.traverse((o) => { if (o.userData.plateId && o.scale.x > 1.04) swollen = true; });
        return swollen;
      }, null, { timeout: 3000, polling: 'raf' }).then(() => 'fx-burst', () => null),
      page.waitForFunction(() => document.querySelector('#boxes .box.closing'), null, { timeout: 3000, polling: 'raf' }).then(() => 'fx-box', () => null),
      page.waitForFunction(() => window.__app.model.parent.children.some((o) => o.userData.plateId && o.position.y < -2), null, { timeout: 3000, polling: 'raf' }).then(() => 'fx-drop', () => null),
    ]);
    if (shot && want.has(shot)) {
      // 演出の時計と CSS のアニメーションを止めて撮る（ヘッドレスの描画は遅く、撮る間に先へ進んでしまう）
      await page.evaluate(() => window.__app.timeScale(0));
      if (shot === 'fx-box') {
        // ふたは閉まりきった所まで進めて撮る（止めた時計では動かないので、ふたの動きだけ終わらせる）
        await page.waitForFunction(() => document.querySelector('#boxes .box.closing').getAnimations({ subtree: true }).length, null, { polling: 'raf' });
        await page.evaluate(() => {
          for (const a of document.querySelector('#boxes .box.closing').getAnimations({ subtree: true })) if (a.effect?.pseudoElement === '::after') a.finish();
        });
        const lid = await page.evaluate(() => getComputedStyle(document.querySelector('#boxes .box.closing'), '::after').opacity);
        if (lid !== '1') throw new Error(`箱のふたが閉まっていない: ${lid}`);
      }
      await save(shot);
      await page.evaluate(() => window.__app.timeScale(1));
      want.delete(shot);
    }
    await waitRendered(page);
  }
  if (want.size) throw new Error(`演出を撮れなかった: ${[...want].join(', ')}`);
  await playSolution(page);
  await waitRendered(page);
  const after = await meshCount();
  if (after > before) throw new Error(`演出の後に立体で描く物が増えた: ${before} → ${after}`);
  await context.close();
}

// 戻る。生成した箱を手順どおりに途中まで外し、右下の「1手戻す」で2手戻して外し直すと同じ局面になること、
// わざと待機スロットへ入れて詰ませ、詰みの画面の「1手戻す」と「解ける所まで戻る」が効くことを確かめる
async function undoShots(context, errors, outside) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => !r.url().startsWith(url) && !r.url().startsWith('data:') && outside.push(r.url()));
  const cdp = await context.newCDPSession(page);
  const shoot = async (name, settle = true) => {
    if (settle) await waitRendered(page);
    const file = join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    console.log(`screenshot: ${file}`);
  };
  const tapButton = async (sel) => {
    await page.waitForTimeout(300);
    const box = await page.locator(sel).boundingBox();
    await tap(cdp, [box.x + box.width / 2, box.y + box.height / 2]);
  };
  const snapshot = () => page.evaluate(() => JSON.stringify([window.__app.game.state.where, window.__app.game.state.slots, window.__app.plateModes()]));
  const moves = () => page.evaluate(() => window.__app.moves);

  await page.goto(url + '?seed=4&kind=box');
  await waitRendered(page);
  if (!(await page.locator('#undo').isDisabled())) throw new Error('外す前から「1手戻す」が押せる');
  await playSolution(page, 4);
  await page.evaluate(() => window.__app.view(0.45, -0.6, 0, 19));
  const at2 = await snapshot();
  await playSolution(page, 6);
  await page.evaluate(() => window.__app.view(0.45, -0.6, 0, 19));
  await shoot('undo-before');
  for (let i = 0; i < 2; i++) {
    await tapButton('#undo');
    await waitRendered(page);
  }
  if ((await moves()) !== 4 || (await snapshot()) !== at2) throw new Error(`2手戻した局面が、4手目の後と違う（${await moves()} 手）`);
  await shoot('undo-two-back');
  await playSolution(page, 6);
  if ((await moves()) !== 6) throw new Error('戻した後に外し直せない');

  // 詰ませる。このゲームの詰みは「待機スロットが満杯で、出ている箱の色のねじが全部、動かない板に隠れている」ときだけで、
  // 序盤のステージではまず起きない。ステージ 25 のこの順（手元で探した 9 手）なら詰む。生成器が変わったら探し直す
  const STUCK_PATH = ['bottom-3', 'back-3', 'top-2', 'back-1', 'back-4', 'top-1', 'bottom-1', 'bottom-2', 'top-3'];
  await page.goto(url + '?stage=25');
  await waitRendered(page);
  let k = 0;
  for (const id of STUCK_PATH) {
    for (let tries = 0; ; tries++) {
      const reason = await page.evaluate((id) => window.__app.tapScrew(id), id);
      if (reason === 'ok') break;
      if (reason !== 'blocked' || tries >= 12) throw new Error(`詰ませる手順のねじ ${id} を外せない: ${reason}`);
      await page.evaluate((v) => window.__app.view(...v, 19), VIEWS[k++ % VIEWS.length]);
      await waitRendered(page);
    }
    await waitRendered(page);
  }
  await page.waitForSelector('#overlay.stuck:not([hidden]) #rewind:not([hidden])');
  await page.evaluate(() => window.__app.view(0.45, -0.6, 0, 19));
  await shoot('undo-stuck');
  const stuckAt = await moves();
  const stuckState = await snapshot();
  // 詰みの画面の「1手戻す」で遊べる局面に戻り、同じねじを外せばまた同じ詰みになる
  const last = await page.evaluate(() => window.__app.game.path.at(-1));
  await tapButton('#back1');
  await waitRendered(page);
  if ((await moves()) !== stuckAt - 1 || await page.evaluate(() => window.__app.game.status) !== 'playing' || !(await page.locator('#overlay').isHidden())) throw new Error('詰みから1手戻せない');
  await page.evaluate((id) => window.__app.tapScrew(id), last);
  await waitRendered(page);
  if ((await snapshot()) !== stuckState) throw new Error('外し直した詰みが前と違う');
  // 「解ける所まで戻る」。分かれ目の赤い輪を撮るため、演出の時計を止めてから押す
  await page.waitForSelector('#overlay.stuck:not([hidden]) #rewind:not([hidden])');
  await tapButton('#rewind');
  await page.waitForFunction(() => window.__app.marked() !== null);
  await page.evaluate(() => window.__app.timeScale(0));
  await waitRendered(page);
  const back = await moves();
  if (!(back < stuckAt - 1) || await page.evaluate(() => window.__app.game.status) !== 'playing') throw new Error(`解ける所まで戻れない（${stuckAt} → ${back} 手）`);
  console.log(`解ける所まで戻る: ${stuckAt} 手 → ${back} 手、分かれ目 ${await page.evaluate(() => window.__app.marked())}`);
  await shoot('undo-rewound');
  await page.evaluate(() => window.__app.timeScale(1));
  await context.close();
}

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

  await page.goto(url + '?level=box');
  await waitRendered(page);
  const cdp = await context.newCDPSession(page);
  await mkdir(outDir, { recursive: true });
  for (const s of only('box') ? shots : []) {
    await s.act(cdp, page);
    if (s.wait !== false) await waitRendered(page);
    const file = join(outDir, `${s.name}.png`);
    await page.screenshot({ path: file });
    console.log(`screenshot: ${file}`);
  }
  for (const s of only('gen') ? genShots : []) {
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
  await context.close();
  if (only('fx')) await fxShots(await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), errors, outside);
  if (only('size')) await sizeShots(browser, errors, outside);
  if (only('undo')) await undoShots(await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), errors, outside);
  if (only('stage')) await stageShots(await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), errors, outside);
  if (outside.length) throw new Error(`外部への読み込みがあった: ${outside.join(', ')}`);
  if (errors.length) throw new Error(`ページでエラー: ${errors.join(' / ')}`);
} finally {
  await browser.close();
  server.close();
}
