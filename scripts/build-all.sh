#!/usr/bin/env bash
# run all builds: web, electron (linux+win), and android
set -e

# add android build-tools to path if they exist
for version in /home/house/Android/Sdk/build-tools/*; do
    if [ -d "$version" ]; then
        export PATH="$version:$PATH"
    fi
done

echo "building web assets"
npm run build

# wipe electron/app so stale files can't be carried over
rm -rf electron/app/*

echo "packaging electron (linux & win)"
cd electron
# remove previous build artifacts to force fresh asar
rm -rf dist/*
rm -rf dist/linux-unpacked dist/win-unpacked
npm run electron:make-linux
npm run electron:make-win
# electron-builder now outputs directly to ../releases per config; ensure copies
ls dist | grep -E "\.AppImage$|\.deb$|\.exe$" && cp -v dist/* ../releases/ || true
cd ..

echo "building android apk"
cd android
if [ -x ./gradlew ]; then
    ./gradlew assembleRelease
else
    echo "gradlew not found or not executable" >&2
    exit 1
fi
# find apk
APK_PATH=$(find app/build -name "*release*.apk" | head -n1)
if [ -f "$APK_PATH" ]; then
    # ensure we have a signing key
    CERT_DIR="../scripts/certs"
    KEYSTORE="$CERT_DIR/debug.keystore"
    if [ ! -f "$KEYSTORE" ]; then
        mkdir -p "$CERT_DIR"
        echo "generating debug keystore at $KEYSTORE"
        keytool -genkeypair -v -keystore "$KEYSTORE" -alias llmsdebug -storepass android -keypass android -dname "CN=house, OU=llms, O=houseofmates, L=home, S=state, C=US" -keyalg RSA -keysize 2048 -validity 10000
    fi
    # sign and zipalign
    FINAL_APK="../releases/llms.apk"
    echo "processing apk signing and alignment"
    
    if command -v apksigner >/dev/null 2>&1; then
        # apksigner requires zipalign BEFORE signing
        if command -v zipalign >/dev/null 2>&1; then
            echo "zipaligning apk before signing"
            zipalign -f -p 4 "$APK_PATH" "$FINAL_APK"
            echo "signing aligned apk with apksigner"
            apksigner sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android "$FINAL_APK"
        else
            echo "zipalign not found, signing directly (may fail install on R+)"
            cp "$APK_PATH" "$FINAL_APK"
            apksigner sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android "$FINAL_APK"
        fi
    else
        # jarsigner requires zipalign AFTER signing
        echo "signing apk with jarsigner"
        jarsigner -v -keystore "$KEYSTORE" -storepass android -keypass android "$APK_PATH" llmsdebug
        if command -v zipalign >/dev/null 2>&1; then
            echo "zipaligning apk after jarsigner"
            zipalign -f -p 4 "$APK_PATH" "$FINAL_APK"
        else
            cp "$APK_PATH" "$FINAL_APK"
        fi
    fi
fi
cd ..

echo "all done. desktop outputs are in releases/ and apk copy placed in releases/ too"
