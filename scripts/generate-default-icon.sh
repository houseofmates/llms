#!/bin/bash
# generate a simple yellow robot face icon using ImageMagick
# output: electron/assets/appIcon.png (1024x1024) plus android mipmaps

set -e

# ensure imagemagick convert exists
if ! command -v convert &>/dev/null; then
    echo "imagemagick 'convert' not found, cannot generate icon"
    exit 1
fi

mkdir -p electron/assets
OUT=electron/assets/appIcon.png

# create yellow canvas first
convert -size 1024x1024 canvas:"#f5af12" "$OUT"

# draw left eye (open circle)
convert "$OUT" -fill black -draw "circle 400,450 400,510" "$OUT"

# draw right eye as wink (arc)
convert "$OUT" -fill none -stroke black -strokewidth 50 -draw "path 'M600,460 q40,-40 80,0'" "$OUT"

# draw smile curve
convert "$OUT" -fill none -stroke black -strokewidth 50 -draw "path 'M320,700 C420,800 620,800 720,700'" "$OUT"

# draw antenna stem
convert "$OUT" -fill "#f5af12" -draw "roundrectangle 494,64 534,250 20,20" "$OUT"

# draw antenna bulb
convert "$OUT" -fill "#f5af12" -draw "circle 514,64 514,32" "$OUT"

# create other formats
convert $OUT electron/assets/appIcon.icns || true
convert $OUT electron/assets/appIcon.ico || true

# android mipmaps
for size in 48 72 96 144 192 512; do
    convert $OUT -resize ${size}x${size} "android/app/src/main/res/mipmap-${size}dpi/ic_launcher.png" 2>/dev/null || true
    convert $OUT -resize ${size}x${size} "android/app/src/main/res/mipmap-${size}dpi/ic_launcher_round.png" 2>/dev/null || true
done

echo "default robot icon generated in electron/assets (and copied to android mipmaps)"
