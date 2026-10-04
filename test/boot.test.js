// 起動の画面（E3）: タイトルを挟む条件・進みの棒・wasm の読み込みの見張り
import { describe, it, expect } from 'vitest';
import { wantsTitle, wantsHold, holdTime, HOLD, wasmProgress, watchWasm, STEPS } from '../src/boot.js';

const q = (s = '') => new URLSearchParams(s);
const base = { query: q(), webdriver: false, reached: 1, resuming: false, chosen: false };

describe('起動の画面', () => {
  it('初めて開いた端末だけタイトルを挟む', () => {
    expect(wantsTitle(base)).toBe(true);
    expect(wantsTitle({ ...base, reached: 2 })).toBe(false);        // 2 回目からは続きのステージへ直行
    expect(wantsTitle({ ...base, resuming: true })).toBe(false);     // ステージ 1 の途中・おまかせの途中
    expect(wantsTitle({ ...base, chosen: true })).toBe(false);       // ?stage= ?seed= など URL で決めた盤面
    expect(wantsTitle({ ...base, webdriver: true })).toBe(false);    // スクリーンショットとテストは盤面から
    expect(wantsTitle({ ...base, query: q('boot=skip') })).toBe(false);
    expect(wantsTitle({ ...base, reached: 9, webdriver: true, query: q('boot=title') })).toBe(true);
  });

  it('タイトルを挟まない時も、起動の画面は少し残してから消す（F2）', () => {
    expect(wantsHold({ query: q(), webdriver: false })).toBe(true);
    expect(wantsHold({ query: q(), webdriver: true })).toBe(false);   // スクリーンショットとテストは待たせない
    expect(wantsHold({ query: q('boot=skip'), webdriver: false })).toBe(false);
    expect(wantsHold({ query: q('boot=hold'), webdriver: true })).toBe(true);
    // 速く読み終えても開いてから minShow までは残す。遅くても greet だけはバンザイを見せる
    expect(holdTime(300)).toBe(HOLD.minShow - 300);
    expect(holdTime(HOLD.minShow + 5000)).toBe(HOLD.greet);
    expect(holdTime(HOLD.minShow - HOLD.greet)).toBe(HOLD.greet);
  });

  it('棒は JS が届いた所から wasm を読み終える所まで、読んだバイト数で伸びる', () => {
    expect(wasmProgress(0, 1000)).toBe(STEPS.script);
    expect(wasmProgress(500, 1000)).toBeCloseTo((STEPS.script + STEPS.wasm) / 2);
    expect(wasmProgress(2000, 1000)).toBe(STEPS.wasm);
    expect(wasmProgress(10, 0)).toBeNull();
    expect(STEPS.script).toBeLessThan(STEPS.wasm);
    expect(STEPS.wasm).toBeLessThan(STEPS.physics);
    expect(STEPS.physics).toBeLessThan(1);
  });

  it('wasm の fetch を包んでも中身と見出しはそのまま。ほかの fetch は触らない', async () => {
    const bytes = new Uint8Array(10000).map((_, i) => i % 251);
    const win = {
      fetch: async (url) => new Response(bytes, { headers: url.endsWith('.wasm') ? { 'content-type': 'application/wasm', 'content-length': '10000' } : {} }),
    };
    const seen = [];
    const unwatch = watchWasm((loaded, total) => seen.push([loaded, total]), win);
    const res = await win.fetch('./assets/rapier-abc.wasm');
    expect(res.headers.get('content-type')).toBe('application/wasm');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(seen.at(-1)).toEqual([10000, 10000]);
    const other = await win.fetch('./a.json');
    await other.arrayBuffer();
    expect(seen.at(-1)).toEqual([10000, 10000]);
    unwatch();
    expect(win.fetch.name).not.toBe('');
  });

  it('圧縮して送られた wasm は全体の大きさを分からない（0）として知らせる', async () => {
    const win = { fetch: async () => new Response(new Uint8Array(100), { headers: { 'content-encoding': 'gzip', 'content-length': '40' } }) };
    const seen = [];
    watchWasm((loaded, total) => seen.push(total), win);
    await (await win.fetch(new URL('https://x/rapier.wasm'))).arrayBuffer();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((t) => t === 0)).toBe(true);
  });
});
