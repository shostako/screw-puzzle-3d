// 起動の画面（E3）: 読み込みの間はネジまると進みの棒、初めて開いた時はそのままタイトル（「はじめる」）になる。
// 画面そのものは index.html にあり、JS が届く前から出ている（棒は CSS だけで 3 割ほどまで伸びる）。
// ここは JS が動き出してからの進み（物理の wasm の読み込み → 物理の準備 → 最初の描画）と、タイトルの出し入れを受け持つ。

// 進みの目安（0〜1）。JS が届いた所・wasm を読み終えた所・物理の準備ができた所
export const STEPS = { script: 0.35, wasm: 0.85, physics: 0.92 };

// 読んだバイト数から、棒の進み（script〜wasm の間）。全体の大きさが分からなければ null
export function wasmProgress(loaded, total) {
  if (!(total > 0)) return null;
  return STEPS.script + (STEPS.wasm - STEPS.script) * Math.min(1, loaded / total);
}

// タイトルを挟むか: URL で盤面や遊び方を決めていない、自動の操作（スクリーンショット・テスト）でない、
// 到達がステージ 1 のまま、続きの局面も無い（＝初めて開いた端末）。?boot=title なら必ず挟む（確かめ用）
export function wantsTitle({ query, webdriver, reached, resuming, chosen }) {
  if (query.get('boot') === 'title') return true;
  if (query.get('boot') === 'skip' || webdriver || chosen) return false;
  return reached === 1 && !resuming;
}

// 物理の wasm を読む fetch を包んで、読んだバイト数を onBytes(loaded, total) に知らせる。
// 中身はそのまま流すので、WebAssembly.instantiateStreaming も今までどおり使える（型の見出しも写す）。
// 圧縮して送られた時（content-encoding あり）は content-length が展開後の大きさと合わないので total を 0 にする
export function watchWasm(onBytes, win = globalThis) {
  const original = win.fetch;
  if (typeof original !== 'function' || typeof ReadableStream === 'undefined') return () => {};
  win.fetch = async (input, init) => {
    const res = await original.call(win, input, init);
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (!/\.wasm(\?|$)/.test(url) || !res.ok || !res.body) return res;
    const encoded = res.headers.get('content-encoding');
    const total = encoded && encoded !== 'identity' ? 0 : Number(res.headers.get('content-length')) || 0;
    let loaded = 0;
    const reader = res.body.getReader();
    const body = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        loaded += value.byteLength;
        onBytes(loaded, total);
        controller.enqueue(value);
      },
      cancel: (why) => reader.cancel(why),
    });
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
  return () => { win.fetch = original; };
}

// index.html の #boot を動かす
export function createBoot(doc = document) {
  const root = doc.getElementById('boot');
  const bar = doc.getElementById('boot-bar');
  let shown = 0;
  let creep = 0;      // 大きさが分からない読み込みの間、少しずつ伸ばす
  let open = !!root && !root.hidden;
  let busy = open;    // 読み込み中か、消える途中（スクリーンショットはこれが終わるまで待つ）
  const set = (p) => {
    shown = Math.max(shown, Math.min(1, p));
    bar?.style.setProperty('--p', shown.toFixed(3));
    bar?.setAttribute('aria-valuenow', String(Math.round(shown * 100)));
  };
  // JS が届いたので CSS だけの伸びを止め、ここから JS で決める
  root?.classList.add('scripted');
  set(STEPS.script);
  const unwatch = watchWasm((loaded, total) => {
    const p = wasmProgress(loaded, total);
    if (p != null) set(p);
    else if (!creep) {
      // 全体が分からない: 次の目安へ向けて、近づくほどゆっくり伸ばす
      creep = setInterval(() => set(shown + (STEPS.wasm - shown) * 0.08), 120);
    }
  });
  const stopCreep = () => {
    clearInterval(creep);
    creep = 0;
  };
  return {
    get open() { return open; },
    // 読み込み中か消える途中。タイトルで「はじめる」を待っている間は止まっているので false
    get busy() { return busy; },
    step(name) {
      stopCreep();
      if (name === 'wasm' || name === 'physics') unwatch();
      set(STEPS[name] ?? 1);
    },
    // 読み込みが終わった。title なら「はじめる」を出し、押されたら onStart を呼んで閉じる。そうでなければすぐ閉じる
    ready({ title = false, onStart = () => {} } = {}) {
      stopCreep();
      unwatch();
      set(1);
      if (!root) return;
      if (!title) {
        close();
        return;
      }
      root.classList.add('title');
      busy = false;
      const btn = doc.getElementById('boot-start');
      btn.hidden = false;
      btn.addEventListener('click', () => {
        onStart();
        close();
      }, { once: true });
      btn.focus({ preventScroll: true });
    },
  };
  function close() {
    open = false;
    root.classList.add('leaving');
    busy = true;
    const done = () => {
      busy = false;
      root.hidden = true;
      root.classList.remove('leaving');
    };
    // 消える動き（CSS）の後に取り除く。動きを止めている端末でも残らないよう、時間でも消す
    root.addEventListener('animationend', done, { once: true });
    setTimeout(done, 700);
  }
}
