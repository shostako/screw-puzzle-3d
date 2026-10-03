import { defineConfig } from 'vite';

// base を相対にして、GitHub Pages のサブパス（/screw-puzzle-3d/）でも Capacitor の中でも同じ dist/ が動くようにする
export default defineConfig({
  base: './',
  // three.js と物理（Rapier の wasm を base64 で埋め込んだもの、約 4MB）を丸ごと同梱するので、大きさの警告は上げておく
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 5500 },
});
