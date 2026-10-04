# ねじ外しパズル 3D 版

[ねじ外しパズル 2D 版](https://github.com/shostako/screw-puzzle) を発展させた3D版。立体を回して、全方向に刺さったねじを外す。

Claude Code の Projects 機能に、ほぼ放置で作らせる実験として始めた（2026-10-03）。

- 仕様: [docs/SPEC.md](docs/SPEC.md)
- ロードマップ: [docs/ROADMAP.md](docs/ROADMAP.md)
- 公開ページ: https://shostako.github.io/screw-puzzle-3d/ （master への push で配信）

## Android 版

Capacitor 8.5.2 で、公開ページと同じ `dist/` を包んだもの（`android/`）。ネットにつながっていなくても遊べる（外部から読むものが無いことを `scripts/check-dist.mjs` が CI で検査している）。

- アプリ ID `io.github.shostako.screwpuzzle3d`、名前「ねじ外し3D」、縦固定、振動の権限つき。minSdk 24、targetSdk / compileSdk 36
- アイコンはネジまるの頭（適応アイコン、背景は空のグラデーション）、起動画面は空の色にネジまる。作り直しは `bash scripts/android-icons.sh`（ImageMagick が要る）
- 文字は同梱の丸ゴシック（M PLUS Rounded 1c、SIL OFL 1.1、使う文字だけ。ライセンスは `public/fonts/OFL.txt`）。画面の文に新しい字を足して `test/font.test.js` が落ちたら `npm run font` で作り直す
- 署名はビルドした PC のデバッグ鍵。別の PC で作った APK は署名が違うので上書きでは入らない（入れ直すと端末に残した到達ステージが消える）
- ストアへの公開はしていない

### APK の作り方（手元の PC）

要るもの: Node 22、JDK 21、Android SDK（platform 36、build-tools 36.0.0）。2D 版と同じ環境（新PC の WSL の `~/.local/opt/jdk-21` と `~/Android/Sdk`）でそのまま作れる。

```
export JAVA_HOME=~/.local/opt/jdk-21 ANDROID_HOME=~/Android/Sdk
npm ci
npm run app:apk      # → android/app/build/outputs/apk/debug/app-debug.apk
```

- `npm run app:web` は `dist/` を作って `android/` へ写すだけ（`npx cap sync android`）。Android Studio で開くなら、これの後に `npx cap open android`
- スマホへの入れ方は 2D 版と同じ: USB でつないでいれば Windows 側の `adb.exe install -r android/app/build/outputs/apk/debug/app-debug.apk`。つないでいなければ Google ドライブに置き、スマホのドライブから開いて入れる（初回は「提供元不明のアプリ」の許可が要る）
- ネット無しで動くかの確かめ: `npm run app:web && npm run app:offline`（同梱するページを、ネットを遮断したヘッドレスの Chromium で開き、ステージ 1 をクリアまで進める）
