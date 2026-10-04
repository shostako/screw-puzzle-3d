#!/usr/bin/env bash
# Android のアイコン（適応アイコンの前景・昔の丸と角丸の四角）とスプラッシュを、ネジまるの絵から作る（E3）。
# 使い方: bash scripts/android-icons.sh（ImageMagick の convert が要る。作った PNG は git に入れるので、絵を変えた時だけ走らせる）
#   前景: docs/design/icon-head.png（ネジまるの頭。docs/design/nejimaru_1_front.png の背景を抜いて頭だけ切り出した）
#   スプラッシュ: docs/design/nejimaru-cutout.png（同じ絵の全身、背景を抜いたもの）
#   背景の空の色は src/theme.js の既定の空（sky）に合わせる。適応アイコンの背景は drawable/ic_launcher_background.xml のグラデーション
set -euo pipefail
cd "$(dirname "$0")/.."
command -v convert >/dev/null || { echo "ImageMagick（convert）が要る" >&2; exit 1; }

RES=android/app/src/main/res
TOP='#7cc4ff'; BOTTOM='#e6f4ff'   # 空の上と下（アイコン・スプラッシュ共通）
HEAD=docs/design/icon-head.png
BODY=docs/design/nejimaru-cutout.png
declare -A SCALE=([mdpi]=1 [hdpi]=1.5 [xhdpi]=2 [xxhdpi]=3 [xxxhdpi]=4)

for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  s=${SCALE[$d]}
  px() { awk -v a="$1" -v s="$s" 'BEGIN { printf "%d", a * s + 0.5 }'; }
  # 適応アイコンの前景（108dp）。頭は丸く切られても欠けないよう、中央の 66dp の円に収まる幅 46dp（見える所は 72dp 角）
  fg=$(px 108); hw=$(px 46)
  convert -size "${fg}x${fg}" xc:none \( "$HEAD" -resize "${hw}x" \) -gravity center -geometry +0+$(px 2) -composite \
    -strip "$RES/mipmap-$d/ic_launcher_foreground.png"
  # 昔の端末のアイコン（48dp）: 角丸の四角と丸に、空のグラデーションと頭
  ic=$(px 48); r=$(px 9); hw2=$(px 34)
  for shape in square round; do
    if [ "$shape" = square ]; then mask="roundrectangle 0,0 $((ic - 1)),$((ic - 1)) $r,$r"; out=ic_launcher.png
    else mask="circle $((ic / 2)),$((ic / 2)) $((ic / 2)),0"; out=ic_launcher_round.png; fi
    convert -size "${ic}x${ic}" "gradient:$TOP-$BOTTOM" \( "$HEAD" -resize "${hw2}x" \) -gravity center -geometry +0+$(px 1) -composite \
      \( -size "${ic}x${ic}" xc:none -fill white -draw "$mask" \) -compose DstIn -composite -strip "$RES/mipmap-$d/$out"
  done
  # スプラッシュ: 空のグラデーションの真ん中にネジまる（短い辺の半分の高さ）
  for o in port land; do
    size=$(identify -format '%wx%h' "$RES/drawable-$o-$d/splash.png")
    w=${size%x*}; h=${size#*x}; m=$(( w < h ? w : h ))
    convert -size "$size" "gradient:$TOP-$BOTTOM" \( "$BODY" -resize "x$((m / 2))" \) -gravity center -composite -strip "$RES/drawable-$o-$d/splash.png"
  done
done
convert -size 480x320 "gradient:$TOP-$BOTTOM" \( "$BODY" -resize x160 \) -gravity center -composite -strip "$RES/drawable/splash.png"
echo "android-icons: ok"
