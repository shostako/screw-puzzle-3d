import { defineConfig } from 'vite';

// base を相対にして、GitHub Pages のサブパス（/screw-puzzle-3d/）でも Capacitor の中でも同じ dist/ が動くようにする
export default defineConfig({
  base: './',
  // three.js を丸ごと同梱するので 500kB の警告は上げておく
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 800 },
});
