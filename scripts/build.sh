#!/usr/bin/env bash
# 公開するページを dist/ に作る。CI と GitHub Pages の配信（deploy-pages.yml）の両方がこれを呼ぶ。
# 作り方を変えるときはこのファイルを書き換える。ワークフローの YAML は触らない。
#   package.json に build があれば npm run build（出力先は dist/）
#   無ければ index.html と assets/ を dist/ へ写す
#   index.html も無ければ「準備中」のページを置く
set -euo pipefail
cd "$(dirname "$0")/.."

has_script() { [ -f package.json ] && node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)"; }

if [ -f package.json ] && [ ! -d node_modules ]; then
  if [ -f package-lock.json ]; then npm ci; else npm install; fi
fi

rm -rf dist
if has_script build; then
  npm run build
else
  mkdir -p dist
  if [ -f index.html ]; then
    cp index.html dist/
    if [ -d assets ]; then cp -r assets dist/; fi
  else
    cat > dist/index.html <<'HTML'
<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ねじ外しパズル 3D</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#f4ead9;font-family:sans-serif">
<p>ねじ外しパズル 3D は準備中。</p>
</body>
</html>
HTML
  fi
fi

test -f dist/index.html || { echo "build: dist/index.html がない" >&2; exit 1; }
