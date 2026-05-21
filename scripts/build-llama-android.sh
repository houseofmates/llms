#!/bin/bash
# Build script for llama.cpp Android binary
# This compiles llama-server for Android ARM64

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_DIR="$PROJECT_ROOT/android"
ASSETS_DIR="$ANDROID_DIR/app/src/main/assets"
JNI_LIBS_DIR="$ANDROID_DIR/app/src/main/jniLibs/arm64-v8a"
PREBUILT_CACHE_DIR="$SCRIPT_DIR/.llama-android-prebuilt"

# Configuration
LLAMA_CPP_VERSION="b8925"  # Latest version with Gemma 4 support
LLAMA_CPP_DIR="$SCRIPT_DIR/llama.cpp"
BUILD_DIR="$LLAMA_CPP_DIR/build-android"
PREBUILT_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_VERSION}/llama-${LLAMA_CPP_VERSION}-bin-android-arm64.tar.gz"

# Android NDK Configuration
NDK_VERSION="26.2.11394342"  # Default NDK version
ANDROID_PLATFORM="android-28"
ANDROID_ABI="arm64-v8a"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

PACKAGED_BINARY_PATH=""
PREBUILT_ROOT=""

# Find Android SDK and NDK
find_ndk() {
    # Check environment variable first
    if [ -n "$ANDROID_NDK_HOME" ]; then
        echo "$ANDROID_NDK_HOME"
        return 0
    fi
    if [ -n "$NDK_ROOT" ]; then
        echo "$NDK_ROOT"
        return 0
    fi
    
    # Check common locations
    local common_paths=(
        "$HOME/Android/Sdk/ndk/$NDK_VERSION"
        "$HOME/Library/Android/sdk/ndk/$NDK_VERSION"
        "/opt/android-sdk/ndk/$NDK_VERSION"
        "/usr/local/android-sdk/ndk/$NDK_VERSION"
    )
    
    for path in "${common_paths[@]}"; do
        if [ -d "$path" ]; then
            echo "$path"
            return 0
        fi
    done
    
    # Try to find any NDK version
    for ndk_path in "$HOME/Android/Sdk/ndk"/*; do
        if [ -d "$ndk_path" ]; then
            echo "$ndk_path"
            return 0
        fi
    done
    
    return 1
}

# Clone or update llama.cpp
checkout_llama_cpp() {
    log_info "Setting up llama.cpp..."
    
    if [ -d "$LLAMA_CPP_DIR" ]; then
        log_info "Updating existing llama.cpp repository..."
        cd "$LLAMA_CPP_DIR"
        git fetch origin --tags
        if ! git diff --quiet --ignore-submodules HEAD --; then
            log_warn "Existing llama.cpp checkout has local changes; using a clean temporary checkout for source build"
            LLAMA_CPP_DIR="$(mktemp -d /tmp/llama.cpp-${LLAMA_CPP_VERSION}-XXXXXX)"
            git clone --depth 1 --branch "$LLAMA_CPP_VERSION" https://github.com/ggml-org/llama.cpp.git "$LLAMA_CPP_DIR"
            BUILD_DIR="$LLAMA_CPP_DIR/build-android"
            cd "$LLAMA_CPP_DIR"
            return 0
        fi
        git checkout --detach "tags/$LLAMA_CPP_VERSION"
    else
        log_info "Cloning llama.cpp repository..."
        git clone --depth 1 --branch "$LLAMA_CPP_VERSION" https://github.com/ggml-org/llama.cpp.git "$LLAMA_CPP_DIR"
        cd "$LLAMA_CPP_DIR"
    fi
}

# Build llama.cpp for Android
build_android() {
    log_info "Building llama.cpp for Android..."
    
    NDK_PATH=$(find_ndk)
    if [ -z "$NDK_PATH" ]; then
        log_error "Android NDK not found!"
        log_error "Please install Android NDK or set ANDROID_NDK_HOME environment variable."
        log_error "You can install it via Android Studio or sdkmanager."
        exit 1
    fi
    
    log_info "Using NDK at: $NDK_PATH"
    
    # Create build directory
    mkdir -p "$BUILD_DIR"
    cd "$BUILD_DIR"
    
 # Configure with CMake (using GGML_* options for newer llama.cpp)
log_info "Configuring with CMake..."
  cmake \
  -DCMAKE_TOOLCHAIN_FILE="$NDK_PATH/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI="$ANDROID_ABI" \
  -DANDROID_PLATFORM="$ANDROID_PLATFORM" \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_BUILD_TESTS=OFF \
  -DGGML_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_SERVER=ON \
  -DGGML_CUDA=OFF \
  -DGGML_METAL=OFF \
  -DGGML_OPENBLAS=OFF \
  -DGGML_LTO=OFF \
  -DGGML_CPU=ON \
  -DGGML_CPU_ISA=ALL \
  -DGGML_STATIC=OFF \
  -DCMAKE_C_FLAGS="-Wl,-z,max-page-size=16384" \
  -DCMAKE_CXX_FLAGS="-Wl,-z,max-page-size=16384" \
  -DCMAKE_EXE_LINKER_FLAGS="-Wl,-z,max-page-size=16384" \
  -DCMAKE_SHARED_LINKER_FLAGS="-Wl,-z,max-page-size=16384" \
  .. || {
      log_error "CMake configuration failed!"
      exit 1
  }
    
    # Build
    log_info "Compiling (this may take several minutes)..."
    cmake --build . --config Release -j$(nproc) || {
        log_error "Build failed!"
        exit 1
    }
    
    log_info "Build successful!"
}

# Copy binary to assets
copy_to_assets() {
    log_info "Copying binary to Android assets..."
    
    # Create assets directory
    mkdir -p "$ASSETS_DIR/bin"
    
    # Find the binary - try multiple possible locations
    local BINARY_PATH=""
    local POSSIBLE_PATHS=(
        "$BUILD_DIR/bin/llama-server"
        "$BUILD_DIR/llama-server"
        "$BUILD_DIR/examples/server/llama-server"
        "$BUILD_DIR/release/llama-server"
    )
    
    for path in "${POSSIBLE_PATHS[@]}"; do
        if [ -f "$path" ]; then
            BINARY_PATH="$path"
            break
        fi
    done
    
    # If not found, search for it
    if [ -z "$BINARY_PATH" ]; then
        log_warn "Binary not in expected locations, searching..."
        BINARY_PATH=$(find "$BUILD_DIR" -name "llama-server" -type f 2>/dev/null | head -1)
    fi
    
    if [ -f "$BINARY_PATH" ]; then
        cp "$BINARY_PATH" "$ASSETS_DIR/bin/llama-server"
        chmod +x "$ASSETS_DIR/bin/llama-server"
        PACKAGED_BINARY_PATH="$BINARY_PATH"
        log_info "Binary copied from: $BINARY_PATH"
        log_info "Binary location: $ASSETS_DIR/bin/llama-server"
        
        # Show file info
        file "$ASSETS_DIR/bin/llama-server"
        ls -lh "$ASSETS_DIR/bin/llama-server"
    else
        log_error "Binary not found!"
        log_error "Searched in: ${POSSIBLE_PATHS[*]}"
        log_error "Build directory contents:"
        find "$BUILD_DIR" -name "llama*" -type f 2>/dev/null || true
        ls -la "$BUILD_DIR/" 2>/dev/null || true
        exit 1
    fi
}

reset_native_bundle() {
    mkdir -p "$JNI_LIBS_DIR"
    rm -f \
        "$JNI_LIBS_DIR/libllama_server.so" \
        "$JNI_LIBS_DIR/lib_llama_server.so" \
        "$JNI_LIBS_DIR/libllama-common.so" \
        "$JNI_LIBS_DIR/libllama.so" \
        "$JNI_LIBS_DIR/libggml.so" \
        "$JNI_LIBS_DIR/libggml-base.so" \
        "$JNI_LIBS_DIR/libggml-cpu.so" \
        "$JNI_LIBS_DIR/libmtmd.so" \
        "$JNI_LIBS_DIR/libomp.so"
}

sync_native_bundle() {
    local SOURCE_ROOT="$1"
    local SERVER_BINARY="$2"

    if [ ! -f "$SERVER_BINARY" ]; then
        log_error "Server binary not found for native bundle sync: $SERVER_BINARY"
        exit 1
    fi

    if ! command -v readelf >/dev/null 2>&1; then
        log_error "readelf is required to package the llama native bundle"
        exit 1
    fi

    log_info "Syncing llama native bundle into $JNI_LIBS_DIR"
    reset_native_bundle

    cp "$SERVER_BINARY" "$JNI_LIBS_DIR/libllama_server.so"
    chmod +x "$JNI_LIBS_DIR/libllama_server.so"

    # Add SONAME so Android's package manager reliably extracts the library to nativeLibraryDir.
    # Without SONAME, some Android versions/OEMs skip extraction, making findNativeServerBinary() fail.
    if command -v patchelf >/dev/null 2>&1; then
        patchelf --set-soname libllama_server.so "$JNI_LIBS_DIR/libllama_server.so" 2>/dev/null || {
            log_warn "patchelf --set-soname failed; binary may not extract to nativeLibraryDir on some devices"
        }
    else
        log_warn "patchelf not found; cannot set SONAME. Binary may not extract to nativeLibraryDir on some devices."
        log_warn "Install patchelf (e.g., sudo apt install patchelf) for better Android compatibility."
    fi

    local queue_file
    queue_file="$(mktemp)"
    local seen_file
    seen_file="$(mktemp)"

    readelf -d "$SERVER_BINARY" | awk -F'[][]' '/NEEDED/ { print $2 }' \
        | grep -vE '^(libc|libdl|libm)\.so$' > "$queue_file" || true

    while [ -s "$queue_file" ]; do
        local LIB_NAME
        LIB_NAME="$(head -n 1 "$queue_file")"
        tail -n +2 "$queue_file" > "$queue_file.tmp" && mv "$queue_file.tmp" "$queue_file"

        if grep -qx "$LIB_NAME" "$seen_file" 2>/dev/null; then
            continue
        fi
        echo "$LIB_NAME" >> "$seen_file"

        local LIB_PATH
        LIB_PATH="$(find "$SOURCE_ROOT" -name "$LIB_NAME" -type f 2>/dev/null | head -1)"
        if [ -z "$LIB_PATH" ] && [ "$LIB_NAME" = "libomp.so" ]; then
            local NDK_SEARCH_ROOT="${NDK_PATH:-$(find_ndk 2>/dev/null || true)}"
            if [ -n "$NDK_SEARCH_ROOT" ] && [ -d "$NDK_SEARCH_ROOT" ]; then
                LIB_PATH="$(find "$NDK_SEARCH_ROOT" -path '*/aarch64/libomp.so' -type f 2>/dev/null | head -1)"
            fi
        fi
        if [ -z "$LIB_PATH" ]; then
            log_error "Missing native dependency $LIB_NAME under $SOURCE_ROOT"
            exit 1
        fi

        cp "$LIB_PATH" "$JNI_LIBS_DIR/$LIB_NAME"
        chmod +x "$JNI_LIBS_DIR/$LIB_NAME" || true
        log_info "Copied native lib: $LIB_NAME"

        readelf -d "$LIB_PATH" | awk -F'[][]' '/NEEDED/ { print $2 }' \
            | grep -vE '^(libc|libdl|libm)\.so$' >> "$queue_file" || true
    done

    rm -f "$queue_file" "$seen_file"

    log_info "Final native bundle contents:"
    ls -lh "$JNI_LIBS_DIR"
}

download_prebuilt_bundle() {
    PREBUILT_ROOT="$PREBUILT_CACHE_DIR/llama-${LLAMA_CPP_VERSION}"

    if [ -f "$PREBUILT_ROOT/llama-server" ]; then
        log_info "Using cached prebuilt Android bundle: $PREBUILT_ROOT"
        return 0
    fi

    log_info "Downloading official llama.cpp Android bundle: $PREBUILT_URL"
    mkdir -p "$PREBUILT_CACHE_DIR"

    local tmpdir
    tmpdir="$(mktemp -d)"

    if ! curl -fL --connect-timeout 30 --max-time 300 "$PREBUILT_URL" -o "$tmpdir/llama.tar.gz"; then
        log_warn "Could not download prebuilt Android bundle"
        rm -rf "$tmpdir"
        return 1
    fi

    if ! tar -xzf "$tmpdir/llama.tar.gz" -C "$tmpdir"; then
        log_warn "Could not extract prebuilt Android bundle"
        rm -rf "$tmpdir"
        return 1
    fi

    local extracted_root
    extracted_root="$(find "$tmpdir" -maxdepth 1 -mindepth 1 -type d -name 'llama-*' | head -1)"
    if [ -z "$extracted_root" ] || [ ! -f "$extracted_root/llama-server" ]; then
        log_warn "Prebuilt Android bundle did not contain llama-server"
        rm -rf "$tmpdir"
        return 1
    fi

    rm -rf "$PREBUILT_ROOT"
    mv "$extracted_root" "$PREBUILT_ROOT"
    rm -rf "$tmpdir"

    log_info "Cached prebuilt Android bundle at: $PREBUILT_ROOT"
    return 0
}

install_prebuilt_bundle() {
    if [ -z "$PREBUILT_ROOT" ] || [ ! -f "$PREBUILT_ROOT/llama-server" ]; then
        log_error "Prebuilt bundle is not ready to install"
        exit 1
    fi

    mkdir -p "$ASSETS_DIR/bin"
    cp "$PREBUILT_ROOT/llama-server" "$ASSETS_DIR/bin/llama-server"
    chmod +x "$ASSETS_DIR/bin/llama-server"
    PACKAGED_BINARY_PATH="$PREBUILT_ROOT/llama-server"

    sync_native_bundle "$PREBUILT_ROOT" "$PREBUILT_ROOT/llama-server"

    log_info "Installed prebuilt llama-server from: $PREBUILT_ROOT"
    file "$ASSETS_DIR/bin/llama-server"
    ls -lh "$ASSETS_DIR/bin/llama-server"
}

# Create placeholder if NDK not available
create_placeholder() {
    log_warn "NDK not available, creating placeholder..."
    log_warn "The APK will be built but the llama server won't work."
    log_warn "To build with llama.cpp support, install Android NDK."
    
    mkdir -p "$ASSETS_DIR/bin"
    echo '#!/system/bin/sh
echo "llama-server placeholder - build with NDK for real binary"
exit 1' > "$ASSETS_DIR/bin/llama-server"
    chmod +x "$ASSETS_DIR/bin/llama-server"
}

# Print usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Build llama.cpp llama-server for Android ARM64

OPTIONS:
    -h, --help      Show this help message
    --skip-build    Skip building, just copy existing binary
    --clean         Clean build directory before building
    --from-source   Build from local llama.cpp source instead of the official Android bundle

ENVIRONMENT:
    ANDROID_NDK_HOME    Path to Android NDK (auto-detected if not set)

EXAMPLES:
    $0              # Full build
    $0 --clean      # Clean and rebuild
EOF
}

# Main function
main() {
    local skip_build=false
    local clean=false
    local from_source=false
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                usage
                exit 0
                ;;
            --skip-build)
                skip_build=true
                shift
                ;;
            --clean)
                clean=true
                shift
                ;;
            --from-source)
                from_source=true
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done
    
    log_info "=== Building llama.cpp for Android ==="
    log_info "Project root: $PROJECT_ROOT"
    
    # Create scripts directory if needed
    mkdir -p "$SCRIPT_DIR"

    if [ "$from_source" = false ]; then
        if download_prebuilt_bundle; then
            install_prebuilt_bundle
            log_info "=== Build complete ==="
            log_info "Installed official Android llama bundle for $LLAMA_CPP_VERSION."
            log_info "Rebuild the APK to include the updated server."
            exit 0
        fi
        log_warn "Falling back to local source build because the prebuilt bundle was unavailable."
    fi
    
    if [ "$clean" = true ]; then
        log_info "Cleaning build directory..."
        rm -rf "$LLAMA_CPP_DIR"
    fi
    
    # Check for NDK when building from source
    NDK_PATH=$(find_ndk)
    if [ -z "$NDK_PATH" ]; then
        log_warn "Android NDK not found!"
        log_warn "Please install NDK $NDK_VERSION or newer via Android Studio, or rerun without --from-source."
        create_placeholder
        exit 0
    fi
    
    if [ "$skip_build" = false ]; then
        checkout_llama_cpp
        build_android
    fi
    
    copy_to_assets
    sync_native_bundle "$BUILD_DIR" "$PACKAGED_BINARY_PATH"
    
    log_info "=== Build complete ==="
    log_info "The llama-server binary is now in the Android assets."
    log_info "Rebuild the APK to include the server."
}

# Run main function
main "$@"
