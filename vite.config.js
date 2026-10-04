import { defineConfig } from 'vite';

// 物理（Rapier の互換版）は wasm を base64 の文字列で JS に埋め込んでいて、そのままでは JS が約 5MB になる。
// ビルドのときだけ、その文字列を別ファイルの .wasm に取り出し、init が fetch で読むように書き換える。
// 中身のバイト列は同じなので、物理の結果（決定性）は変わらない。開発サーバーとテスト（Node）は埋め込みのまま。
// .wasm にすると、ブラウザは文字列の解読をせずに読みながらコンパイルでき、転送量も減る（gzip で約 1.6MB → 1.2MB）。
function rapierWasmFile() {
  // 埋め込みの形: X.toByteArray("AGFzbQ...").buffer（AGFzbQ は wasm の先頭 "\0asm" の base64）
  const embedded = /[\w$]+\.toByteArray\("(AGFzbQ[A-Za-z0-9+/=]+)"\)(?:\.buffer)?/;
  return {
    name: 'rapier-wasm-file',
    apply: 'build',
    transform(code, id) {
      if (!/rapier3d[\w-]*compat[\\/]dist[\\/]rapier\.mjs$/.test(id)) return null;
      const m = code.match(embedded);
      if (!m) this.error('Rapier の埋め込み wasm が見つからない（パッケージの形が変わった？）');
      const ref = this.emitFile({ type: 'asset', name: 'rapier.wasm', source: Buffer.from(m[1], 'base64') });
      // wasm-bindgen の init は URL を受け取ると fetch して読む（Content-Type が application/wasm でなくても読める）
      return { code: code.replace(m[0], `new URL(import.meta.ROLLUP_FILE_URL_${ref})`), map: null };
    },
  };
}

// 物理の wasm（gzip で約 1.2MB、起動で一番大きな荷物）を、index.html の <link rel="preload"> で JS と同時に読み始める（E11）。
// これが無いと、JS を読んで実行し、3D の準備（描き手・ネジまる）を終えてから wasm を読み始めるので、遅い回線では待ちが足し算になる。
// as="fetch" と crossorigin（anonymous）は、wasm-bindgen の fetch(URL) と同じ読み方なので、読んだものがそのまま使われる
function preloadRapierWasm() {
  return {
    name: 'preload-rapier-wasm',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const wasm = Object.values(ctx.bundle ?? {}).find((f) => f.type === 'asset' && /rapier.*\.wasm$/.test(f.fileName));
        if (!wasm) throw new Error('物理の wasm が出力に見つからない（rapierWasmFile の後に動くはず）');
        return [{ tag: 'link', attrs: { rel: 'preload', href: `./${wasm.fileName}`, as: 'fetch', type: 'application/wasm', crossorigin: '' }, injectTo: 'head' }];
      },
    },
  };
}

// base を相対にして、GitHub Pages のサブパス（/screw-puzzle-3d/）でも Capacitor の中でも同じ dist/ が動くようにする
export default defineConfig({
  base: './',
  plugins: [rapierWasmFile(), preloadRapierWasm()],
  // three.js と物理の JS（wasm を除く）で 1MB 弱。これを超えたら何かが紛れ込んでいる
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  // 生成器とステージのテストは多数の盤面を作るので、既定の 5 秒では並列に走らせたときに打ち切られる。
  // 速さの検査はテストの中で時間を測って行う（打ち切りの時間は検査ではない）
  test: { testTimeout: 30000 },
});
