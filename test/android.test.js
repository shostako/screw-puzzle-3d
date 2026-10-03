// Android 版（Capacitor）の設定が、公開ページと同じ dist/ を縦画面で包む形から崩れていないか
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('Android 版', () => {
  const config = JSON.parse(read('capacitor.config.json'));
  const manifest = read('android/app/src/main/AndroidManifest.xml');

  it('dist/ をそのまま同梱する', () => {
    expect(config.webDir).toBe('dist');
    expect(read('vite.config.js')).toMatch(/base:\s*['"]\.\/['"]/);
  });

  it('アプリ ID と名前が Android のプロジェクトと一致する', () => {
    const strings = read('android/app/src/main/res/values/strings.xml');
    expect(strings).toContain(`<string name="app_name">${config.appName}</string>`);
    expect(strings).toContain(`<string name="package_name">${config.appId}</string>`);
    expect(read('android/app/build.gradle')).toContain(`applicationId "${config.appId}"`);
  });

  it('縦画面に固定し、振動の権限を持つ', () => {
    expect(manifest).toContain('android:screenOrientation="portrait"');
    expect(manifest).toContain('android.permission.VIBRATE');
  });

  it('安全域は Capacitor の CSS 変数を先に使う', () => {
    expect(config.plugins?.SystemBars?.insetsHandling).toBe('css');
    const css = read('src/style.css');
    expect(css).not.toMatch(/(?<!, )env\(safe-area-inset/);
    for (const side of ['top', 'right', 'bottom']) expect(css).toContain(`var(--safe-area-inset-${side}, env(safe-area-inset-${side}, 0px))`);
  });
});
