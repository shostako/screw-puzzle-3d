#!/usr/bin/env bash
# Android 版（Capacitor）に入れるページを作り、android/ へ写す。
# 公開ページと同じ dist/ をそのまま同梱する（scripts/build.sh が作る。外部 URL を読まないことは scripts/check-dist.mjs が検査済み）。
# APK まで作るときは npm run app:apk（JDK 21 と Android SDK が要る。README の「Android 版」）。
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/build.sh
node scripts/check-dist.mjs
npx cap sync android
