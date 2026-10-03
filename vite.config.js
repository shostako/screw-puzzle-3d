import { defineConfig } from 'vite';

// base を相対にして、GitHub Pages のサブパス（/screw-puzzle-3d/）でも Capacitor の中でも同じ dist/ が動くようにする
export default defineConfig({
  base: './',
  // three.js と物理（Rapier の wasm を base64 で埋め込んだもの、約 4MB）を丸ごと同梱するので、大きさの警告は上げておく
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 5500 },
  // 生成器とステージのテストは多数の盤面を作るので、既定の 5 秒では並列に走らせたときに打ち切られる。
  // 速さの検査はテストの中で時間を測って行う（打ち切りの時間は検査ではない）
  test: { testTimeout: 30000 },
});
