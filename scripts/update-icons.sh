#!/usr/bin/env bash
# usage: ./scripts/update-icons.sh path/to/source.png
# This helper resizes a single source image into all of the required
# icon locations for the llms project (electron, android, linux/deb grid, etc.)
# The provided image should be a square png at high resolution (512x512 or larger).

# if no source provided, use the default robot icon (generate if needed)
if [ -z "$1" ]; then
    if [ -x "./scripts/generate-default-icon.sh" ]; then
        ./scripts/generate-default-icon.sh || echo "failed to generate default icon"
    fi
    SRC="electron/assets/appIcon.png"
    echo "no source given, using generated default icon: $SRC"
else
    SRC="$1"
fi
if [ ! -f "$SRC" ]; then
    echo "source file not found: $SRC"
    exit 1
fi

# require imagemagick convert
command -v convert >/dev/null 2>&1 || {
    echo "imagemagick is required (convert)";
    exit 1;
}

# electron assets
EASSETS="electron/assets"
mkdir -p "$EASSETS"
echo "creating electron icon files..."
convert "$SRC" -resize 256x256 "$EASSETS/appIcon.png"
convert "$SRC" -resize 256x256 "$EASSETS/appIcon.ico"

# android mipmap sizes
# mapping density -> px
declare -A ANDROID_SIZES=(
    [mdpi]=48
    [hdpi]=72
    [xhdpi]=96
    [xxhdpi]=144
    [xxxhdpi]=192
)
echo "updating android mipmap icons..."
for density in "${!ANDROID_SIZES[@]}"; do
    size=${ANDROID_SIZES[$density]}
    dir="android/app/src/main/res/mipmap-$density"
    if [ -d "$dir" ]; then
        echo "  -> $dir/ic_launcher.png"
        convert "$SRC" -resize ${size}x${size} "$dir/ic_launcher.png"
        echo "  -> $dir/ic_launcher_round.png"
        convert "$SRC" -resize ${size}x${size} "$dir/ic_launcher_round.png"
    fi
done

# linux/deb/appimage icon
echo "copying to linux icon (electron/assets/appIcon.png)"
mkdir -p electron/assets
cp "$EASSETS/appIcon.png" electron/assets/appIcon.png

echo "icons updated. remember to rebuild the project after running this script."
