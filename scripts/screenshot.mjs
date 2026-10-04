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
//   （題材、D4・E7。部品の木で組んだ車・家・ぶた・ロボット・飛行機・船・ロケット・機関車・カメラ ?seed=番号&kind=car|house|animal|robot|plane|ship|rocket|train|camera）
//   theme-<題材>.png        開いた直後
//   theme-<題材>-below.png  下から見上げた向き（車輪・脚の裏のねじ）
//   theme-car-midway.png / theme-car-cleared.png  車を手順どおりに 9 本外したところと、クリアの画面
//   theme-car-held.png      子の部品（窓・屋根）が付いた客室の最後のねじをタップして、子の部品が光ったところ（D5）
//   （マスコット、D3。生成した箱 ?seed=4&kind=box で）
//   mascot-start.png    開いた直後（左下で待機しているネジまる）
//   mascot-poses.png    動きごとの姿勢を並べたもの（待機・瞬き・外せない・箱が満杯・成功の回転ジャンプ・成功の後・失敗の震え・失敗の後）
//   mascot-cleared.png  手順どおりに外してクリアした画面（ネジまるがカードに乗って、跳び終えてバンザイ）
//   mascot-stuck.png    詰みの画面の見た目（失敗の姿勢を決め打ち。詰みの局面は作らずに、カードの文字だけ替える）
//   あわせて、隠れたねじのタップで「外せない」、箱が満杯で「小さな喜び」、クリアで「成功」の動きが出ること、
//   やり直すと待機に戻ること、ネジまるのキャンバスが盤面のタップを遮らないことを確かめる
//   （クリアの評価。保存の無い新しい端末としてステージ 1 を開く）
//   rating-first.png  初めてクリアした画面（星・時間と目安。ベストは初めてなので行を出さない）
//   rating-hint.png   「もう一度」で遊び直し、ヒントを1回使った扱いでクリアした画面（星が1つ減り、前の自己ベストを出す）
//   あわせて、星の数が rate() の決まりどおりか、自己ベストが再読み込みの後も残るかを確かめる
//   （ヒント。生成した箱 ?seed=4&kind=box で、右下の電球を指でタップして）
//   hint.png          最初の局面でヒントを押し、外すねじに金色の輪が出たところ
//   hint-midway.png   ヒントの手だけを8本外したあと、もう一度押したところ
//   hint-cleared.png  ヒントの手だけでクリアした画面（使った回数を数えていることも確かめる）
//   （ランダム、D6。保存の無い新しい端末として開き、題名を指でタップして遊び方を選ぶ）
//   random-menu.png     遊び方を選ぶ画面（ステージ・今日の1問・おまかせ 3 段）
//   random-hard.png     おまかせの「むずかしい」を選んで開いた直後（題名の下に #番号）
//   random-cleared.png  手順どおりに外してクリアした画面（「次のおまかせ」）
//   random-next.png     「次のおまかせ」で開いた次の1問（同じ難しさ、違う番号）
//   daily.png / daily-cleared.png  今日の1問を開いた直後と、クリアした画面
//   daily-menu-done.png  ステージへ戻ってから遊び方の画面を開いたところ（今日の1問がクリア済みと星）
//   あわせて、?random=番号&diff= で同じ番号の盤面が開くこと、おまかせ・今日の1問のクリアでステージの到達が進まないことを確かめる
//   （設定。保存の無い新しい端末として開き、題名 → 遊び方の画面の「設定」を指でタップして）
//   settings.png        設定の画面（既定: 音・振動 入、回す速さ ふつう、画質 自動、ネジまる 出す）
//   settings-light.png  画質「軽い」・ネジまる「隠す」にして閉じた盤面（ねじの頭にローレットが無い、左下にネジまるが居ない）
//   settings-clear.png  「記録を消す」を1回押して、確かめの文字に変わったところ
//   あわせて、回す速さ「はやい」で同じ指の動きが ふつう の約 1.4 倍回ること、画質「軽い」で描く解像度が 1 になること、
//   設定が再読み込みの後も残ること、記録を消すとステージ 1 に戻り設定は残ることを確かめる
//   （続きから遊べる、E10。保存の無い新しい端末として開き、途中まで外してから再読み込みする）
//   resume-stage-before.png / resume-stage-after.png    ステージ 8（車）を 9 本外して向きを変えたところと、再読み込みした直後
//   resume-random-before.png / resume-random-after.png  おまかせ（やさしい #777）を 6 本外したところと、再読み込みした直後
//   resume-daily-before.png / resume-daily-after.png    今日の1問を 6 本外したところと、再読み込みした直後
//   resume-daily-undo.png  続きから戻した今日の1問で、保存前の手を2手戻したところ
//   あわせて、再読み込みの後に同じ遊び方・同じ局面（外したねじ・箱・スロット）・同じ板の状態と姿勢・同じ向き・同じ時間（遊んだ秒が続く）で
//   続くこと、続きからクリアできて保存が消えること、壊れた保存は黙って最初から始まることを確かめる
//   （章と難しさの曲線、E8。?stage=番号 で章の頭・中ほど・大物を開く。CHAPTER=10,11 で番号を絞れる）
//   chapter-stage<番号>.png  開いた直後（題名の下に「第N章「章の名前」 何番目/10」）
//   （進行と報酬、E9。到達 14・自己ベストを入れた端末として開き、題名 → 遊び方 → ステージを指でタップして）
//   progress-menu.png    遊び方の画面（ステージの行に到達と星の合計）
//   progress-list.png    ステージ一覧（章ごとの番号と星、次に遊ぶステージ、鍵、全部 ★3 の章の王冠）
//   progress-replay.png  クリア済みのステージ 3 を一覧から選んで開いた直後
//   progress-chapter-end.png    到達 10 の端末でステージ 10 をクリアした画面（章の星の合計と次の章の予告）
//   progress-chapter-intro.png  「第2章へ」で開いたステージ 11 のお披露目（立体が回りながら出て、章の名前の帯）
//   あわせて、遊び直しのクリアで到達が戻らず章の終わりも出ないこと、鍵のステージが押せないこと、既存の記録が残ることを確かめる
// SHOTS=stage のように組を絞って撮れる。以後の PR では、このファイルの shots に場面を足して使い回す。
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const dist = resolve(new URL('../dist/', import.meta.url).pathname);
const outDir = resolve(process.argv[2] ?? 'screenshots');
// SHOTS=box,gen,theme,stage,size,fx,mascot,rating,hint,undo で撮る組を絞れる（既定は全部）。box は固定の箱、gen は生成した盤面、theme は題材、stage はステージの進行、size は画面の大きさ、fx は分解の演出、mascot はマスコット、rating はクリアの評価、hint はヒント、undo は戻る、random はおまかせと今日の1問、settings は設定、resume は続きから遊べる、chapter は章（E8）、progress はステージ一覧と章の終わり（E9）
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

// 題材（D4）
// E7 で足した題材（ロボット・飛行機・船・ロケット・機関車・カメラ）も同じく開いた直後と下から
const THEMED = [['car', 1], ['house', 1], ['animal', 1], ['robot', 1], ['plane', 1], ['ship', 1], ['rocket', 1], ['train', 1], ['camera', 1]];
const themeShots = [
  ...THEMED.flatMap(([kind, seed]) => [
    { name: `theme-${kind}`, query: `?seed=${seed}&kind=${kind}`, act: async () => {} },
    { name: `theme-${kind}-below`, act: async (cdp, page) => {
      await page.evaluate(() => window.__app.view(-0.7, 0.5, 0, 19));
    } },
  ]),
  { name: 'theme-car-midway', query: `?seed=${THEMED[0][1]}&kind=car`, act: async (cdp, page) => {
    await playSolution(page, 9);
    await page.evaluate(() => window.__app.view(0.45, -0.6, 0, 19));
  } },
  { name: 'theme-car-cleared', act: async (cdp, page) => {
    await playSolution(page);
    await page.waitForSelector('#overlay:not([hidden])');
  } },
  // D5: 子の部品（窓・屋根）が付いた客室の最後のねじをタップすると、外せずに子の部品が光る
  { name: 'theme-car-held', query: `?seed=${THEMED[0][1]}&kind=car`, wait: false, act: async (cdp, page) => {
    await page.evaluate(() => window.__app.view(0.3, -0.9, 0, 17));
    await waitRendered(page);
    // 片側の窓を外して客室のねじを見せ、客室のねじを外せるものから外していき、最後の 1 本で held になるまで
    // （もう片側の窓と屋根が付いたまま）。落ちた窓に隠れていたら、向きを変えて払い落とす
    const ids = (plate) => page.evaluate((plate) => {
      const g = window.__app.game;
      return g.state.level.screws.filter((x) => x.plate === plate && g.state.where[x.id] === 'board').map((x) => x.id);
    }, plate);
    let last = null;
    for (let k = 0; k < 24 && last !== 'held'; k++) {
      for (const id of [...await ids('window1'), ...await ids('cabin')]) {
        last = await page.evaluate((id) => window.__app.tapScrew(id), id);
        await waitRendered(page);
        if (last === 'held') break;
      }
      if (last !== 'held') {
        await page.evaluate((v) => window.__app.view(...v, 19), VIEWS[k % VIEWS.length]);
        await waitRendered(page);
      }
    }
    if (last !== 'held') throw new Error('客室の最後のねじが held にならない');
    // 残っている窓（window2、車の -z の側）が見える向き
    await page.evaluate(() => window.__app.view(0.35, 2.4, 0, 17));
    await waitRendered(page);
    // もう一度タップして、光が強い所（FX.held の 1/4）で演出の時計を止めて撮る
    await page.evaluate(() => {
      const last = window.__app.game.state.level.screws.filter((s) => s.plate === 'cabin' && window.__app.game.state.where[s.id] === 'board');
      window.__app.tapScrew(last[0].id);
    });
    await page.waitForTimeout(170);
    await page.evaluate(() => window.__app.timeScale(0));
    await page.waitForTimeout(150);
  } },
];

// ステージの進行（M7）。新しい端末（保存なし）でステージ 1 から順にクリアして進め、再読み込みで続きから始まることを確かめる
// 章と難しさの曲線（E8）
const CHAPTER_SHOTS = (process.env.CHAPTER ?? '10,11,20,22,30,33,40,42,50,60').split(',').map(Number);
async function chapterShots(context, errors, outside) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => !r.url().startsWith(url) && !r.url().startsWith('data:') && outside.push(r.url()));
  for (const n of CHAPTER_SHOTS) {
    await page.goto(`${url}?stage=${n}`);
    await waitRendered(page);
    const file = join(outDir, `chapter-stage${n}.png`);
    await page.screenshot({ path: file });
    console.log(`screenshot: ${file}`);
  }
  await context.close();
}

async function progressShots(context, errors, outside) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => !r.url().startsWith(url) && !r.url().startsWith('data:') && outside.push(r.url()));
  const cdp = await context.newCDPSession(page);
  const save = async (name) => {
    const path = join(outDir, `${name}.png`);
    await page.screenshot({ path });
    console.log(`screenshot: ${path}`);
  };
  const tapButton = async (sel) => {
    const box = await page.locator(sel).boundingBox();
    await tap(cdp, [box.x + box.width / 2, box.y + box.height / 2]);
  };
  // 記録を入れた端末: 到達 reached、1 章は全部 ★3（王冠）、11〜13 は星いろいろ、今日の1問の記録と設定も入れておく（消えないことを見る）
  const bestsFor = () => ({
    ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, { stars: 3, seconds: 30 + i }])),
    11: { stars: 2, seconds: 95 }, 12: { stars: 3, seconds: 70 }, 13: { stars: 1, seconds: 180 },
    'daily-20261003': { stars: 2, seconds: 77 },
  });
  const seed = (reached, bests) => page.evaluate(([reached, bests]) => {
    localStorage.clear();
    localStorage.setItem('screw-puzzle-3d.stage', String(reached));
    localStorage.setItem('screw-puzzle-3d.best', JSON.stringify(bests));
    localStorage.setItem('screw-puzzle-3d.settings', JSON.stringify({ speed: 'fast' }));
  }, [reached, bests]);
  // 保存を書き換えるのは、保存しない ?level=box のページから（E10 の pagehide の保存と競らない）
  await page.goto(url + '?level=box');
  await seed(14, bestsFor());
  await page.goto(url);
  await waitRendered(page);
  if (await page.evaluate(() => window.__app.stage) !== 14) throw new Error('到達 14 の端末がステージ 14 から始まらない');
  await tapButton('#mode-btn');
  await page.waitForSelector('#menu:not([hidden])');
  const sub = await page.locator('#m-stage-sub').textContent();
  if (sub !== 'ステージ 14 まで・★ 36') throw new Error(`遊び方の画面のステージの行が合わない: ${sub}`);
  await page.waitForTimeout(300);
  await save('progress-menu');
  await tapButton('#m-stage');
  await page.waitForSelector('#stages:not([hidden])');
  await page.waitForTimeout(300);
  const states = await page.evaluate(() => [...document.querySelectorAll('#st-list .st')].map((b) => b.className.replace(/^st /, '')));
  if (states.length !== 30) throw new Error(`一覧のステージの数が合わない（1〜3 章で 30）: ${states.length}`);
  if (states[12] !== 'cleared' || states[13] !== 'next playing' || states[14] !== 'locked' || states[29] !== 'locked') throw new Error(`一覧の状態が合わない: ${states.slice(10, 16)}`);
  if (!await page.locator('#st-list .chap[data-chapter="1"] .crown').count()) throw new Error('全部 ★3 の 1 章に王冠が無い');
  if (!await page.locator('#st-list .st[data-n="20"]').isDisabled()) throw new Error('鍵のステージが押せる');
  // 一覧を上へ戻して 1 章から撮る
  await page.evaluate(() => { document.getElementById('st-list').scrollTop = 0; });
  await save('progress-list');
  // 鍵のステージを押しても何も起きない
  await page.locator('#st-list .st[data-n="20"]').scrollIntoViewIfNeeded();
  await page.locator('#st-list .st[data-n="20"]').click({ force: true });
  await page.waitForTimeout(200);
  if (await page.locator('#stages').isHidden() || await page.evaluate(() => window.__app.stage) !== 14) throw new Error('鍵のステージで遊べてしまった');

  // クリア済みのステージ 3 を選んで遊び直す
  await page.locator('#st-list .st[data-n="3"]').scrollIntoViewIfNeeded();
  await tapButton('#st-list .st[data-n="3"]');
  await page.waitForFunction(() => window.__app.stage === 3 && window.__app.rendered, null, { timeout: SETTLE_MS });
  await waitRendered(page);
  const title = await page.locator('#title').textContent();
  if (title !== 'ステージ 3') throw new Error(`遊び直しの題名が合わない: ${title}`);
  await save('progress-replay');
  await playSolution(page);
  await page.waitForSelector('#overlay:not([hidden]) #next:not([hidden])');
  if (!await page.locator('#end-chapter').isHidden()) throw new Error('遊び直しのクリアで章の終わりが出た');
  if (await page.evaluate(() => window.__app.reached) !== 14) throw new Error('遊び直しのクリアで到達が戻った');
  const kept = await page.evaluate(() => [localStorage.getItem('screw-puzzle-3d.stage'), JSON.parse(localStorage.getItem('screw-puzzle-3d.best')), JSON.parse(localStorage.getItem('screw-puzzle-3d.settings')).speed]);
  if (kept[0] !== '14' || kept[1]['daily-20261003']?.stars !== 2 || kept[1][13]?.stars !== 1 || kept[2] !== 'fast') throw new Error(`既存の記録が変わった: ${JSON.stringify(kept)}`);
  // 「次のステージへ」は遊び直しの次（4）
  await tapButton('#next');
  await page.waitForFunction(() => window.__app.stage === 4 && window.__app.rendered, null, { timeout: SETTLE_MS });

  // 章の終わり: 到達 10 の端末でステージ 10 をクリアする
  await page.goto(url + '?level=box');
  const ch1 = bestsFor();
  delete ch1[10];
  for (const k of [11, 12, 13]) delete ch1[k];
  await seed(10, ch1);
  await page.goto(url);
  await waitRendered(page);
  if (await page.evaluate(() => window.__app.stage) !== 10) throw new Error('到達 10 の端末がステージ 10 から始まらない');
  await playSolution(page);
  await page.waitForSelector('#overlay:not([hidden]) #end-chapter:not([hidden])');
  const next = await page.locator('#next').textContent();
  if (next !== '第2章へ') throw new Error(`章の終わりの「次へ」が合わない: ${next}`);
  const lines = await page.locator('#end-chapter span').allTextContents();
  if (!lines[0].startsWith('第1章「はじめての工作」') || !/★ \d+ \/ 30/.test(lines[1]) || !lines[3].includes('ロボット')) throw new Error(`章の終わりの文が合わない: ${lines}`);
  await page.waitForTimeout(1600);
  await save('progress-chapter-end');
  // ネジまるがもう1回跳ぶ（成功の動きが2回）
  await page.waitForFunction(() => window.__app.mascot.history.filter((h) => h === 'win').length >= 2, null, { timeout: 8000 }).catch(() => { throw new Error('章の終わりでネジまるがもう1回跳ばない'); });
  await tapButton('#next');
  await page.waitForFunction(() => window.__app.stage === 11 && !window.__app.why().loading, null, { timeout: SETTLE_MS });
  await page.waitForSelector('.ch-banner');
  await page.waitForTimeout(500);
  await save('progress-chapter-intro');
  await waitRendered(page);
  await context.close();
}

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
      // 右下のボタンで音を切ると、再読み込みしても切れたまま
      const sb = await page.locator('#sound').boundingBox();
      await page.locator('#again').click();
      await tap(cdp, [sb.x + sb.width / 2, sb.y + sb.height / 2]);
      await page.reload();
      await waitRendered(page);
      const pressed = await page.locator('#sound').getAttribute('aria-pressed');
      if (pressed !== 'false') throw new Error(`音の切り替えが残らない: ${pressed}`);
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

// ヒント。電球を押して出た輪のねじを外す、を繰り返してクリアまで進める
async function hintShots(context, errors, outside) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => !r.url().startsWith(url) && !r.url().startsWith('data:') && outside.push(r.url()));
  const cdp = await context.newCDPSession(page);
  const press = async () => {
    const box = await page.locator('#hint-btn').boundingBox();
    await tap(cdp, [box.x + box.width / 2, box.y + box.height / 2]);
    const id = await page.evaluate(() => window.__app.hintScrew);
    if (!id) throw new Error(`ヒントの輪が出ない: ${await page.locator('#hint').textContent()}`);
    return id;
  };
  // 輪が脈打つ途中で時計を止めて撮る（輪は5秒で消える）
  const shoot = async (name) => {
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
    await page.evaluate(() => window.__app.timeScale(0));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const file = join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    console.log(`screenshot: ${file}`);
    await page.evaluate(() => window.__app.timeScale(1));
  };

  await page.goto(url + '?seed=4&kind=box');
  await waitRendered(page);
  let used = 0, k = 0;
  for (;;) {
    const id = await press();
    used++;
    if (used === 1) await shoot('hint');
    if (used === 9) await shoot('hint-midway');
    for (let tries = 0; ; tries++) {
      const reason = await page.evaluate((id) => window.__app.tapScrew(id), id);
      if (reason === 'ok') break;
      // 落ちた板やぶら下がった板に隠れていれば、回して払い落としてからもう一度
      if (reason !== 'blocked' || tries >= 12) throw new Error(`ヒントのねじ ${id} を外せない: ${reason}`);
      await page.evaluate((v) => window.__app.view(...v, 19), VIEWS[k++ % VIEWS.length]);
      await waitRendered(page);
    }
    await waitRendered(page);
    if (await page.evaluate(() => window.__app.game.status) !== 'playing') break;
    await page.evaluate(() => window.__app.view(0.45, -0.6, 0, 19));
    await waitRendered(page);
  }
  const [status, hints] = await page.evaluate(() => [window.__app.game.status, window.__app.game.hints]);
  if (status !== 'cleared') throw new Error(`ヒントどおりに外したのにクリアにならない: ${status}`);
  if (hints !== used) throw new Error(`ヒントの回数が ${used} のはずが ${hints}`);
  await page.waitForSelector('#overlay:not([hidden])');
  const file = join(outDir, 'hint-cleared.png');
  await page.screenshot({ path: file });
  console.log(`screenshot: ${file}（ヒント ${used} 回）`);
  await context.close();
}

// マスコット（D3）。姿勢を決め打ちして並べて撮り、実際の合図（外せない・箱が満杯・クリア）で動くことを確かめる
const MASCOT_POSES = [['idle', 0.5], ['idle', 0.05], ['flinch', 0.12], ['joy', 0.37], ['win', 0.2], ['win', 4], ['lose', 0.2], ['lose', 2.4]];
async function mascotShots(context, errors, outside) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => !r.url().startsWith(url) && !r.url().startsWith('data:') && outside.push(r.url()));
  const cdp = await context.newCDPSession(page);
  const save = async (name, clip) => {
    const path = join(outDir, `${name}.png`);
    await page.screenshot({ path, clip });
    console.log(`screenshot: ${path}`);
  };
  const history = () => page.evaluate(() => [...window.__app.mascot.history]);
  const nextFrames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.goto(url + '?seed=4&kind=box');
  await waitRendered(page);
  await nextFrames();
  await save('mascot-start');

  // ネジまるのキャンバスの上をタップしても、下の盤面へ届く（pointer-events: none）
  const box = await page.locator('#mascot').boundingBox();
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [box.x + box.width / 2, box.y + box.height / 2]);
  if (hit !== 'stage') throw new Error(`ネジまるの上のタップが盤面に届かない: ${hit}`);

  // 姿勢を決め打ちして、1枚ずつ撮ってから横に並べる（並べるのはページの中のキャンバスで）
  const tiles = [];
  for (const [action, t] of MASCOT_POSES) {
    await page.evaluate(([a, t]) => window.__app.mascot.force(a, t), [action, t]);
    await nextFrames();
    tiles.push((await page.screenshot({ clip: box })).toString('base64'));
  }
  await page.evaluate(() => window.__app.mascot.force(null));
  const sheet = await page.evaluate(async ([tiles, w, h]) => {
    const c = document.createElement('canvas');
    c.width = w * 4;
    c.height = h * 2;
    const g = c.getContext('2d');
    g.fillStyle = '#eaf4ff';
    g.fillRect(0, 0, c.width, c.height);
    for (const [i, b64] of tiles.entries()) {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      g.drawImage(img, (i % 4) * w, Math.floor(i / 4) * h, w, h);
    }
    return c.toDataURL('image/png').split(',')[1];
  }, [tiles, Math.round(box.width * 2), Math.round(box.height * 2)]);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(outDir, 'mascot-poses.png'), Buffer.from(sheet, 'base64'));
  console.log(`screenshot: ${join(outDir, 'mascot-poses.png')}`);

  // 隠れたねじをタップすると「外せない」
  const blocked = await page.evaluate(() => {
    const g = window.__app.game, legal = new Set(g.legal());
    return Object.keys(g.state.where).find((id) => g.state.where[id] === 'board' && !legal.has(id));
  });
  if (!blocked) throw new Error('隠れたねじが見つからない');
  if (await page.evaluate((id) => window.__app.tapScrew(id), blocked) !== 'blocked') throw new Error(`ねじ ${blocked} が隠れていない`);
  if (!(await history()).includes('flinch')) throw new Error(`外せないねじのタップでネジまるが動かない: ${await history()}`);
  await waitRendered(page);

  // 手順どおりに外し切る。途中で箱が満杯になると「小さな喜び」、クリアで「成功」
  await playSolution(page);
  await page.waitForSelector('#overlay:not([hidden])');
  const h = await history();
  if (!h.includes('joy')) throw new Error(`箱が満杯でネジまるが喜ばない: ${h}`);
  if (h.at(-1) !== 'win' || await page.evaluate(() => window.__app.mascot.action) !== 'win') throw new Error(`クリアでネジまるが成功の動きをしない: ${h}`);
  // 跳び終えてバンザイしたところ（成功の動きは 3.3 秒）を撮る
  await page.waitForTimeout(3600);
  await page.evaluate(() => window.__app.timeScale(0));
  await nextFrames();
  await save('mascot-cleared');
  await page.evaluate(() => window.__app.timeScale(1));
  // 失敗はカードの上で、詰みの画面と同じ置き方で姿勢だけ決め打ちして撮る
  await page.evaluate(() => {
    document.getElementById('overlay').className = 'stuck';
    document.getElementById('end-title').textContent = '詰み';
    document.getElementById('end-text').textContent = '外せるねじが無くなった';
    document.getElementById('again').textContent = 'やり直す';
    document.getElementById('end-stars').hidden = true;
    document.getElementById('end-score').hidden = true;
    window.__app.mascot.force('lose', 2.4);
  });
  await nextFrames();
  await save('mascot-stuck');
  await page.evaluate(() => window.__app.mascot.force(null));

  // やり直すと待機に戻る
  const again = await page.locator('#again').boundingBox();
  await tap(cdp, [again.x + again.width / 2, again.y + again.height / 2]);
  await waitRendered(page);
  const after = await page.evaluate(() => window.__app.mascot.action);
  if (after !== 'idle') throw new Error(`やり直してもネジまるが待機に戻らない: ${after}`);
  await context.close();
}

// クリアの評価。ステージ 1 を2回クリアして、星・時間・自己ベストの出方を撮る
async function ratingShots(context, errors, outside) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => !r.url().startsWith(url) && !r.url().startsWith('data:') && outside.push(r.url()));
  const cdp = await context.newCDPSession(page);
  const save = async (name) => {
    const path = join(outDir, `${name}.png`);
    await page.screenshot({ path });
    console.log(`screenshot: ${path}`);
  };
  const card = () => page.evaluate(() => ({
    stars: document.querySelectorAll('#end-stars span.on').length,
    shown: !document.getElementById('end-stars').hidden,
    score: document.getElementById('end-score').innerText,
    rating: window.__app.rating,
  }));
  // 星がはじけ終わるまで待ってから撮る
  const settle = () => page.waitForTimeout(1400);
  await page.goto(url);
  await waitRendered(page);
  if (await page.evaluate(() => window.__app.stage) !== 1) throw new Error('新しい端末がステージ 1 から始まらない');
  await playSolution(page);
  await page.waitForSelector('#overlay:not([hidden])');
  const first = await card();
  const want = (r) => Math.max(1, 3 - r.hints - r.rewinds - (r.seconds > r.par ? 1 : 0));
  if (!first.shown || first.stars !== first.rating.stars || first.stars !== want(first.rating)) throw new Error(`初めてのクリアの星が合わない: ${JSON.stringify(first)}`);
  if (!first.score.includes('目安') || first.score.includes('自己ベスト')) throw new Error(`初めてのクリアの行が合わない: ${first.score}`);
  await settle();
  await save('rating-first');

  // 「もう一度」（次へがあるので控えめのボタン）で遊び直し、ヒントを1回使った扱いでクリアする
  const again = await page.locator('#again').boundingBox();
  await tap(cdp, [again.x + again.width / 2, again.y + again.height / 2]);
  await waitRendered(page);
  if (await page.evaluate(() => window.__app.playSeconds) > 30) throw new Error('遊び直しで時計が 0 に戻らない');
  await page.evaluate(() => window.__app.countHint());
  await playSolution(page);
  await page.waitForSelector('#overlay:not([hidden])');
  const second = await card();
  if (second.rating.hints !== 1 || second.stars !== want(second.rating) || second.stars > 2) throw new Error(`ヒントを使ったクリアの星が合わない: ${JSON.stringify(second)}`);
  const best = first.rating.stars > second.stars || (first.rating.stars === second.stars && first.rating.seconds <= second.rating.seconds);
  if (best && !second.score.includes('自己ベスト ★')) throw new Error(`前の自己ベストが出ない: ${second.score}`);
  await settle();
  await save('rating-hint');

  // 自己ベストは再読み込みの後も残る
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('screw-puzzle-3d.best'))?.[1]);
  if (!kept || kept.stars !== Math.max(first.rating.stars, second.stars)) throw new Error(`自己ベストが保存されていない: ${JSON.stringify(kept)}`);
  await page.reload();
  await waitRendered(page);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('screw-puzzle-3d.best'))?.[1]);
  if (JSON.stringify(after) !== JSON.stringify(kept)) throw new Error('再読み込みで自己ベストが変わった');
  await context.close();
}

// ランダム（D6）。題名から遊び方を選び、おまかせと今日の1問を遊ぶ
async function randomShots(context, errors, outside) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => !r.url().startsWith(url) && !r.url().startsWith('data:') && outside.push(r.url()));
  const cdp = await context.newCDPSession(page);
  const save = async (name) => {
    const path = join(outDir, `${name}.png`);
    await page.screenshot({ path });
    console.log(`screenshot: ${path}`);
  };
  const tapButton = async (sel) => {
    const box = await page.locator(sel).boundingBox();
    await tap(cdp, [box.x + box.width / 2, box.y + box.height / 2]);
  };
  const title = () => page.evaluate(() => [document.getElementById('title').textContent, document.getElementById('subtitle').textContent]);
  const openMenu = async () => {
    await tapButton('#mode-btn');
    await page.waitForSelector('#menu:not([hidden])');
    await page.waitForTimeout(300);
  };
  const loaded = (type) => page.waitForFunction((type) => window.__app.mode.type === type && window.__app.rendered, type, { timeout: SETTLE_MS });

  await page.goto(url);
  await waitRendered(page);
  if (await page.evaluate(() => window.__app.stage) !== 1) throw new Error('新しい端末がステージ 1 から始まらない');
  await openMenu();
  await save('random-menu');

  await tapButton('#m-hard');
  await loaded('random');
  await waitRendered(page);
  const first = await page.evaluate(() => window.__app.mode);
  const [t1, s1] = await title();
  if (first.difficulty !== 'hard' || t1 !== 'おまかせ・むずかしい' || s1 !== `#${first.no}`) throw new Error(`おまかせの題名が合わない: ${t1} ${s1} ${JSON.stringify(first)}`);
  if (JSON.stringify(await page.evaluate(() => window.__app.level.random)) !== JSON.stringify({ no: first.no, difficulty: 'hard' })) throw new Error('おまかせの盤面の番号が合わない');
  await save('random-hard');
  await playSolution(page);
  await page.waitForSelector('#overlay:not([hidden]) #next:not([hidden])');
  if (await page.locator('#next').textContent() !== '次のおまかせ') throw new Error('おまかせのクリアで「次のおまかせ」が出ない');
  await page.waitForTimeout(1400);
  await save('random-cleared');
  await tapButton('#next');
  await page.waitForFunction((no) => window.__app.mode.type === 'random' && window.__app.mode.no !== no && window.__app.rendered, first.no, { timeout: SETTLE_MS });
  const second = await page.evaluate(() => window.__app.mode);
  if (second.difficulty !== 'hard') throw new Error('次のおまかせの難しさが変わった');
  await save('random-next');

  // 同じ番号は ?random= で開ける（同じ盤面）
  const solution = await page.evaluate(() => window.__app.solution);
  await page.goto(url + `?random=${second.no}&diff=hard`);
  await waitRendered(page);
  if (JSON.stringify(await page.evaluate(() => window.__app.solution)) !== JSON.stringify(solution)) throw new Error('?random= で同じ盤面が開かない');

  // 今日の1問
  await page.goto(url);
  await waitRendered(page);
  await openMenu();
  if (!(await page.locator('#m-daily-sub').textContent()).endsWith('まだ')) throw new Error('今日の1問が始めからクリア済みになっている');
  await tapButton('#m-daily');
  await loaded('daily');
  await waitRendered(page);
  const [t2] = await title();
  if (t2 !== '今日の1問') throw new Error(`今日の1問の題名が合わない: ${t2}`);
  await save('daily');
  await playSolution(page);
  await page.waitForSelector('#overlay:not([hidden]) #next:not([hidden])');
  await page.waitForTimeout(1400);
  await save('daily-cleared');
  const key = await page.evaluate(() => window.__app.mode.key);
  const best = await page.evaluate((key) => JSON.parse(localStorage.getItem('screw-puzzle-3d.best'))?.[`daily-${key}`], key);
  if (!best) throw new Error('今日の1問の自己ベストが保存されていない');
  await tapButton('#next');
  await loaded('stage');
  await waitRendered(page);
  // おまかせ・今日の1問をクリアしても、ステージの到達は進まない
  if (await page.evaluate(() => window.__app.stage) !== 1) throw new Error('ステージの到達が進んでしまった');
  await openMenu();
  if (!(await page.locator('#m-daily-sub').textContent()).includes('クリア ★')) throw new Error('今日の1問がクリア済みにならない');
  await save('daily-menu-done');
  await tapButton('#m-close');
  await page.waitForSelector('#menu', { state: 'hidden' });
  await context.close();
}

// 戻る。生成した箱を手順どおりに途中まで外し、右下の「1手戻す」で2手戻して外し直すと同じ局面になること、
// わざと待機スロットへ入れて詰ませ、詰みの画面の「1手戻す」と「解ける所まで戻る」が効くことを確かめる
// 設定。題名から遊び方の画面を開き、「設定」で設定の画面へ
async function settingsShots(context, errors, outside) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => !r.url().startsWith(url) && !r.url().startsWith('data:') && outside.push(r.url()));
  const cdp = await context.newCDPSession(page);
  const save = async (name) => {
    const path = join(outDir, `${name}.png`);
    await page.screenshot({ path });
    console.log(`screenshot: ${path}`);
  };
  const tapButton = async (sel) => {
    const box = await page.locator(sel).boundingBox();
    if (!box) throw new Error(`${sel} が見えない`);
    await tap(cdp, [box.x + box.width / 2, box.y + box.height / 2]);
    await page.waitForTimeout(300);
  };
  const pick = (key, v) => tapButton(`#settings .seg[data-key="${key}"] button[data-v="${v}"]`);
  const openSettings = async () => {
    await tapButton('#mode-btn');
    await page.waitForSelector('#menu:not([hidden])');
    await tapButton('#m-settings');
    await page.waitForSelector('#settings:not([hidden])');
  };
  const closeAll = async () => {
    await tapButton('#s-close');
    await page.waitForSelector('#menu:not([hidden])');
    await tapButton('#m-close');
    await page.waitForSelector('#menu', { state: 'hidden' });
  };
  // 盤面の真ん中を右へ 120px なぞって、回った角度（ラジアン）
  const turnAngle = async () => {
    await page.evaluate(() => window.__app.view(0.45, -0.6, 0, 19));
    const q0 = await page.evaluate(() => window.__app.model.quaternion.toArray());
    const c = [VIEWPORT.width / 2, VIEWPORT.height / 2];
    await drag(cdp, c, [c[0] + 120, c[1]]);
    await page.waitForTimeout(300);
    const q1 = await page.evaluate(() => window.__app.model.quaternion.toArray());
    const dot = Math.abs(q0.reduce((t, v, i) => t + v * q1[i], 0));
    return 2 * Math.acos(Math.min(1, dot));
  };

  await page.goto(url);
  await waitRendered(page);
  const normalTurn = await turnAngle();
  await openSettings();
  const shown = await page.evaluate(() => window.__app.settings.all());
  if (JSON.stringify(shown) !== JSON.stringify({ sound: true, bgm: true, vibrate: true, speed: 'normal', quality: 'auto', mascot: true })) throw new Error(`設定の既定が違う: ${JSON.stringify(shown)}`);
  const card = await page.locator('#settings .card').boundingBox();
  if (card.x < 0 || card.x + card.width > VIEWPORT.width || card.y < 0 || card.y + card.height > VIEWPORT.height) throw new Error('設定の画面がはみ出す');
  await save('settings');

  await pick('speed', 'fast');
  await pick('quality', 'light');
  await pick('mascot', 'false');
  await pick('vibrate', 'false');
  await pick('bgm', 'false');
  if (await page.evaluate(() => window.__app.pixelRatio) !== 1) throw new Error('画質「軽い」で解像度が 1 にならない');
  await closeAll();
  const fastTurn = await turnAngle();
  const ratio = fastTurn / normalTurn;
  if (Math.abs(ratio - 1.4) > 0.15) throw new Error(`回す速さ「はやい」の回り方が合わない: ${normalTurn.toFixed(3)} → ${fastTurn.toFixed(3)}`);
  await page.evaluate(() => window.__app.view(0.45, -0.6, 0, 19));
  await waitRendered(page);
  if (await page.locator('#mascot').isVisible()) throw new Error('ネジまるを隠しても見えている');
  await save('settings-light');

  // 再読み込みしても残る
  await page.reload();
  await waitRendered(page);
  const kept = await page.evaluate(() => window.__app.settings.all());
  if (JSON.stringify(kept) !== JSON.stringify({ sound: true, bgm: false, vibrate: false, speed: 'fast', quality: 'light', mascot: false })) throw new Error(`設定が再読み込みで残らない: ${JSON.stringify(kept)}`);
  if (await page.locator('#mascot').isVisible() || await page.evaluate(() => window.__app.mascotDrawing)) throw new Error('再読み込みでネジまるが戻った');

  // 記録を消す: ステージ 3 まで進んだ端末で、2 回押すとステージ 1 に戻る。設定は残る
  await page.evaluate(() => localStorage.setItem('screw-puzzle-3d.stage', '3'));
  await page.goto(url);
  await waitRendered(page);
  if (await page.evaluate(() => window.__app.stage) !== 3) throw new Error('ステージ 3 から始まらない');
  await openSettings();
  await tapButton('#s-clear');
  if (await page.locator('#s-clear').textContent() !== 'もう一度押すと消えます') throw new Error('記録を消すの確かめが出ない');
  await save('settings-clear');
  await Promise.all([page.waitForNavigation(), tapButton('#s-clear')]);
  await waitRendered(page);
  if (await page.evaluate(() => window.__app.stage) !== 1) throw new Error('記録を消してもステージ 1 に戻らない');
  if (await page.evaluate(() => window.__app.settings.get('speed')) !== 'fast') throw new Error('記録を消したら設定まで消えた');
  await context.close();
}

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
  for (const [n, id] of STUCK_PATH.entries()) {
    // 5 手目の後は、ヒントでも解ける手順が見つからない（行き止まり）。ヒントのボタンから戻る先へ案内する画面が出る
    if (n === 6) {
      await tapButton('#hint-btn');
      await page.waitForSelector('#overlay.deadend:not([hidden]) #rewind:not([hidden])');
      await page.evaluate(() => window.__app.view(0.45, -0.6, 0, 19));
      await shoot('undo-deadend');
      await tapButton('#resume');
      await page.waitForSelector('#overlay', { state: 'hidden' });
    }
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
  // 輪の演出は止めてあるので終わらない。物理と演出の列が落ち着くのだけ待つ
  await page.waitForFunction(() => { const w = window.__app.why(); return !w.loading && !w.playing && !w.moving; });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const back = await moves();
  if (!(back < stuckAt - 1) || await page.evaluate(() => window.__app.game.status) !== 'playing') throw new Error(`解ける所まで戻れない（${stuckAt} → ${back} 手）`);
  console.log(`解ける所まで戻る: ${stuckAt} 手 → ${back} 手、分かれ目 ${await page.evaluate(() => window.__app.marked())}`);
  await shoot('undo-rewound', false);
  await page.evaluate(() => window.__app.timeScale(1));
  // 戻した所からはヒントを頼りにクリアまで進め、評価に「戻る 2 回」（詰みの画面の1手戻すと、解ける所まで戻る）が数えられている
  for (let n = 0; n < 80 && await page.evaluate(() => window.__app.game.status) === 'playing'; n++) {
    const id = await page.evaluate(() => { window.__app.showHint(); return window.__app.hintScrew; });
    if (!id) throw new Error('戻した所からヒントが出ない');
    for (let tries = 0; ; tries++) {
      const reason = await page.evaluate((id) => window.__app.tapScrew(id), id);
      if (reason === 'ok') break;
      if (reason !== 'blocked' || tries >= 12) throw new Error(`ヒントのねじ ${id} を外せない: ${reason}`);
      await page.evaluate((v) => window.__app.view(...v, 19), VIEWS[k++ % VIEWS.length]);
      await waitRendered(page);
    }
    await waitRendered(page);
  }
  await page.waitForSelector('#overlay.cleared:not([hidden])');
  const rating = await page.evaluate(() => window.__app.rating);
  if (rating.rewinds !== 2) throw new Error(`評価の戻るの回数が ${rating.rewinds}（2 のはず）`);
  await shoot('undo-cleared');
  await context.close();
}

// 続きから遊べる（E10）。途中まで外して再読み込みし、同じ局面・同じ時間で続くことを確かめる
async function resumeShots(context, errors, outside) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => !r.url().startsWith(url) && !r.url().startsWith('data:') && outside.push(r.url()));
  const save = async (name) => {
    const path = join(outDir, `${name}.png`);
    await page.screenshot({ path });
    console.log(`screenshot: ${path}`);
  };
  // 比べる局面: 遊び方・題名・外した順・ねじの居場所・箱とスロット・板の状態と姿勢・向き・ヒントと戻るの回数
  const look = () => page.evaluate(() => {
    const a = window.__app, st = a.game.state;
    return {
      mode: a.mode, stage: a.stage, title: document.getElementById('title').textContent + document.getElementById('subtitle').textContent,
      path: a.game.path, where: st.where, boxes: st.boxes, slots: st.slots, modes: a.plateModes(), poses: a.platePoses(),
      q: a.model.quaternion.toArray(),
    };
  });
  const near = (a, b, eps = 1e-6) => JSON.stringify(a, (k, v) => (typeof v === 'number' ? Math.round(v / eps) : v)) === JSON.stringify(b, (k, v) => (typeof v === 'number' ? Math.round(v / eps) : v));
  async function reloadAndCompare(name, go) {
    await waitRendered(page);
    await save(`resume-${name}-before`);
    const before = await look();
    const seconds = await page.evaluate(() => window.__app.playSeconds);
    await go();
    await waitRendered(page);
    const after = await look();
    const resumed = await page.evaluate(() => window.__app.resumed);
    const secondsAfter = await page.evaluate(() => window.__app.playSeconds);
    if (!resumed || resumed.moves !== before.path.length) throw new Error(`${name}: 続きから戻っていない ${JSON.stringify(resumed)}`);
    if (resumed.physics !== 'snapshot') throw new Error(`${name}: 物理の写しから戻っていない`);
    for (const k of ['mode', 'stage', 'title', 'path', 'where', 'boxes', 'slots', 'modes']) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) throw new Error(`${name}: 再読み込みで ${k} が変わった ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`);
    }
    if (!near(before.q, after.q)) throw new Error(`${name}: 再読み込みで向きが変わった`);
    if (!near(before.poses, after.poses, 1e-4)) throw new Error(`${name}: 再読み込みで板の姿勢が変わった`);
    if (!(secondsAfter >= seconds - 0.05 && secondsAfter < seconds + 3)) throw new Error(`${name}: 遊んだ時間が続いていない ${seconds} → ${secondsAfter}`);
    await save(`resume-${name}-after`);
    console.log(`resume ${name}: ${before.path.length} 手・${seconds.toFixed(1)} 秒 → ${secondsAfter.toFixed(1)} 秒`);
  }

  // ステージ 8（車）。?stage= で開き、URL の指定の無い入口から開き直す（アプリの再開と同じ）
  await page.goto(url + '?stage=8');
  await waitRendered(page);
  await playSolution(page, 9);
  await page.evaluate(() => window.__app.view(0.2, 0.9, 0, 21));
  await reloadAndCompare('stage', () => page.goto(url));
  // 続きからクリアすると保存は消え、次に開くとステージ 9
  await playSolution(page);
  await page.waitForSelector('#overlay:not([hidden]) #next:not([hidden])');
  if (await page.evaluate(() => localStorage.getItem('screw-puzzle-3d.resume')) !== null) throw new Error('クリアしても途中の保存が残っている');
  await page.goto(url);
  await waitRendered(page);
  if (await page.evaluate(() => [window.__app.stage, window.__app.resumed, window.__app.moves].join()) !== '9,,0') throw new Error('クリアの後に開くとステージ 9 の最初にならない');

  // おまかせ
  await page.evaluate(() => window.__app.loadMode({ type: 'random', no: 777, difficulty: 'easy' }));
  await waitRendered(page);
  await playSolution(page, 6);
  await reloadAndCompare('random', () => page.reload());

  // 今日の1問
  const key = await page.evaluate(() => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); });
  await page.evaluate((key) => window.__app.loadMode({ type: 'daily', key }), key);
  await waitRendered(page);
  await playSolution(page, 6);
  await reloadAndCompare('daily', () => page.reload());
  // 保存前の手へ戻す（物理の写しは無いので、ルールの局面から姿勢を作り直す）
  await page.evaluate(() => { window.__app.undo(); window.__app.undo(); });
  await waitRendered(page);
  if (await page.evaluate(() => [window.__app.moves, window.__app.game.status].join()) !== '4,playing') throw new Error('続きから戻した局面で2手戻せない');
  await save('resume-daily-undo');
  // 戻した後の局面も保存され、開き直すと同じ所から
  const undone = await look();
  await page.reload();
  await waitRendered(page);
  if (JSON.stringify((await look()).where) !== JSON.stringify(undone.where)) throw new Error('戻した後の局面が保存されていない');

  // 盤面の作りが変わった版の後（指紋が合わない）は、黙ってその盤面の最初から。
  // 閉じる時（pagehide）にも保存するので、保存しない固定の箱（?level=box）のページを別に開いて、ゲームのページを閉じてから書き換える
  const other = await context.newPage();
  other.on('pageerror', (e) => errors.push(String(e)));
  await other.goto(url + '?level=box');
  await waitRendered(other);
  await page.close();
  await other.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('screw-puzzle-3d.resume'));
    localStorage.setItem('screw-puzzle-3d.resume', JSON.stringify({ ...r, sig: '00000000' }));
  });
  await other.goto(url);
  await waitRendered(other);
  const fresh = await other.evaluate(() => [window.__app.mode.type, window.__app.resumed, window.__app.moves].join());
  if (fresh !== 'daily,,0') throw new Error(`合わない保存で最初から始まらない: ${fresh}`);
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
  for (const s of [...(only('gen') ? genShots : []), ...(only('theme') ? themeShots : [])]) {
    if (s.query) {
      await page.goto(url + s.query);
      await waitRendered(page);
    }
    await s.act(cdp, page);
    if (s.wait !== false) await waitRendered(page);
    const file = join(outDir, `${s.name}.png`);
    await page.screenshot({ path: file });
    console.log(`screenshot: ${file}`);
  }
  await context.close();
  if (only('mascot')) await mascotShots(await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), errors, outside);
  if (only('fx')) await fxShots(await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), errors, outside);
  if (only('hint')) await hintShots(await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), errors, outside);
  if (only('size')) await sizeShots(browser, errors, outside);
  if (only('undo')) await undoShots(await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), errors, outside);
  if (only('rating')) await ratingShots(await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), errors, outside);
  if (only('random')) await randomShots(await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), errors, outside);
  if (only('settings')) await settingsShots(await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), errors, outside);
  if (only('resume')) await resumeShots(await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), errors, outside);
  if (only('chapter')) await chapterShots(await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), errors, outside);
  if (only('progress')) await progressShots(await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), errors, outside);
  if (only('stage')) await stageShots(await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), errors, outside);
  if (outside.length) throw new Error(`外部への読み込みがあった: ${outside.join(', ')}`);
  if (errors.length) throw new Error(`ページでエラー: ${errors.join(' / ')}`);
} finally {
  await browser.close();
  server.close();
}
