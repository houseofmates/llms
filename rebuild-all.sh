#!/bin/bash

# exit on error
set -e

# ensure only one instance runs at a time
# we use flock with a 10-minute timeout so hung builds don't block forever.
# if timeout expires, we force-acquire the lock and continue.
LOCKFILE="$PWD/.rebuild-lock"
exec 9>"$LOCKFILE"
if ! flock -w 600 9; then
    echo "warning: could not acquire lock within 10 minutes, forcing continue..."
fi
# (lock will be released automatically when the script exits)

echo "starting full multi-platform rebuild..."

# 1. ensure we have the default icon generated (robot)
if [ -x "./scripts/generate-default-icon.sh" ]; then
    ./scripts/generate-default-icon.sh || echo "icon generation failed"
fi
# 1. create releases directory if needed (don't delete old binaries yet)
mkdir -p releases

# 2. build web assets
echo "building web assets..."
npm run build

# 3. build electron packages (AppImage, DEB, EXE)
echo "building electron packages..."
cd electron
# build linux (AppImage + DEB)
npm run electron:make-linux || echo "linux electron build failed, continuing"
# build windows (portable EXE)
npm run electron:make-win || echo "windows electron build failed, continuing"
cd ..

# 4. build android APK
echo "building android APK..."
cd android
./gradlew assembleDebug
cd ..

# 5. consolidate binaries in releases/
echo "consolidating binaries..."

# electron-builder already writes AppImage/DEB/EXE into releases directly
# so we don't need to copy those from dist any more.

# android APK
cp android/app/build/outputs/apk/debug/app-debug.apk releases/llms-debug.apk 2>/dev/null || echo "no APK found"

echo "rebuild complete! binaries currently in releases/:"
ls -lh releases/
# show just the app packages names for quick reference
echo "package list:"
ls releases | grep -E '\.AppImage$|\.deb$|\.exe$|\.apk$' || echo "(none)"
