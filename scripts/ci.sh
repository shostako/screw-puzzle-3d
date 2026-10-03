#!/usr/bin/env bash
# PR ごとの検査。.github/workflows/ci.yml の ci ジョブがこれを呼ぶ。
# 検査を増やすときはこのファイルか package.json の test を書き換える。ワークフローの YAML は触らない。
# ブラウザを使うテスト（Playwright など）は、ここでブラウザを入れてから走らせる。
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f package.json ]; then
  if [ -f package-lock.json ]; then npm ci; else npm install; fi
  if node -e 'process.exit(require("./package.json").scripts?.test ? 0 : 1)'; then
    npm test
  fi
fi

bash scripts/build.sh
# dist/ が外部 URL から読み込んでいないか（ネット無しの Android アプリでも動くように）
node scripts/check-dist.mjs
# Android のプロジェクトへ dist/ を写せるか（Capacitor の設定の検査。APK のビルドは Android SDK が要るのでここではしない）
npx cap sync android
echo "ci: ok"
