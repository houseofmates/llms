# llms - AI Model Aggregator

This is an AI model aggregator application that provides a unified interface for accessing multiple LLM services (ChatGPT, Claude, Gemini, Ollama, etc.) across web, desktop (Electron), and Android platforms.

## Project Overview

**llms** is a cross-platform web application built with vanilla JavaScript that aggregates multiple AI chat interfaces into a single customizable dashboard. The app supports:

- **Webview-based models**: Load external AI services (Gemini, ChatGPT, Claude, etc.) in embedded browsers
- **API-based models**: Direct API integration with Ollama, OpenRouter, HuggingFace, and Google Gemini
- **Multi-platform builds**: Web, Android (APK), and desktop (Linux AppImage/DEB, Windows EXE)

### Key Features

- Customizable homepage grid with drag-and-drop reordering
- Chat history management with localStorage persistence
- Streaming responses for supported APIs
- Image attachment support for multimodal models
- System prompt management with one-click copy
- API key management (OpenRouter, HuggingFace, Gemini)
- Card icon customization via URL or file upload

## Technology Stack

| Component | Technology |
|-----------|------------|
| Frontend | Vanilla JavaScript, HTML5, CSS3 |
| Styling | Tailwind CSS (CDN), Custom CSS |
| UI Components | Tom Select (dropdowns), SortableJS (drag-drop) |
| Cross-Platform | Capacitor v8 + Electron |
| Desktop | Electron v26 with BrowserView architecture |
| Android | Capacitor Android + Gradle |
| Build Tools | npm, electron-builder, Android Gradle Plugin |
| Icons | ImageMagick (for generation), custom PNG/ICO |

## Project Structure

```
llms/
├── index.html              # Main HTML entry point
├── script.js               # Core application logic (~1300 lines)
├── styles.css              # Custom styles + Tailwind overrides
├── package.json            # Node.js dependencies and scripts
├── capacitor.config.json   # Capacitor configuration
├── rebuild-all.sh          # Master build script for all platforms
│
├── electron/               # Desktop application
│   ├── package.json        # Electron-specific dependencies
│   ├── electron-builder.config.json  # Build targets (AppImage, DEB, EXE)
│   ├── build/src/          # Compiled TypeScript source
│   │   ├── index.js        # Main process with BrowserView management
│   │   ├── preload.js      # IPC preload script
│   │   └── webview-preload.js  # User-agent spoofing for webviews
│   ├── app/                # Copied web assets (build output)
│   └── assets/             # App icons (PNG, ICO, ICNS)
│
├── android/                # Android native application
│   ├── app/src/main/       # Android app source
│   │   ├── assets/public/  # Web assets copied by Capacitor
│   │   └── res/mipmap-*/   # Launcher icons
│   ├── build.gradle        # Android build configuration
│   └── gradlew             # Gradle wrapper
│
├── scripts/                # Build helper scripts
│   ├── build-all.sh        # Full build with APK signing
│   ├── generate-default-icon.sh  # Creates robot emoji icon
│   ├── update-icons.sh     # Resize source image to all platforms
│   └── install-watch-service.sh  # systemd service installer
│
├── dist/                   # Web build output (copied to electron/app/)
└── releases/               # Final binaries (AppImage, DEB, EXE, APK)
```

## Build and Development Commands

### Prerequisites

- Node.js and npm
- JDK (for Android builds)
- Android SDK (for Android builds)
- ImageMagick (for icon generation)
- `keytool`, `apksigner`, `zipalign` (for signed APK builds)

### Web Development

```bash
# Install dependencies
npm install

# Build web assets and sync with Capacitor
npm run build

# Watch mode - rebuilds on file changes
npm run watch
```

### Full Multi-Platform Build

```bash
# Build everything (web, electron-linux, electron-win, android)
./rebuild-all.sh

# Or via npm
npm run rebuild-all
```

### Platform-Specific Builds

```bash
# Android APK (debug)
cd android && ./gradlew assembleDebug

# Android APK (release, signed - via build-all.sh)
./scripts/build-all.sh

# Electron Linux (AppImage + DEB)
cd electron && npm run electron:make-linux

# Electron Windows (portable EXE)
cd electron && npm run electron:make-win

# Electron macOS (DMG) - config exists but untested
cd electron && npm run electron:make
```

### Output Locations

| Platform | Output Path |
|----------|-------------|
| Web | `dist/` |
| Linux | `releases/*.AppImage`, `releases/*.deb` |
| Windows | `releases/*.exe` |
| Android | `releases/llms-debug.apk`, `releases/llms.apk` (signed) |

## Architecture Details

### Webview vs API Models

The app distinguishes between two model types:

1. **Webview Models** (`type: 'webview'`): Load external URLs in embedded browsers
   - Electron: Uses `BrowserView` (not `<webview>`) for proper OAuth support
   - Android/Web: Falls back to `<iframe>`
   - Examples: Gemini, ChatGPT, Claude, DeepSeek, etc.

2. **API Models** (`type: 'api'`): Direct API integration
   - Custom chat interface with message history
   - Supports streaming responses
   - Examples: Ollama, OpenRouter, HuggingFace, Gemini API

### Electron BrowserView Architecture

The Electron app uses a unique BrowserView-per-site architecture:

- Each AI site loads in its own `BrowserView` (top-level browsing context)
- BrowserViews are sized to fit the content area (sidebar + header accounted for)
- User-Agent is spoofed to Chrome to prevent blocking
- `contextIsolation: false` required for navigator spoofing to work
- OAuth popups are handled with `setWindowOpenHandler`

Key files:
- `electron/build/src/index.js`: Main process, BrowserView management
- `electron/build/src/webview-preload.js`: Preload script for UA spoofing

### Data Persistence

All data is stored in browser `localStorage`:

| Key | Purpose |
|-----|---------|
| `llms_system_prompt` | Custom system prompt |
| `llms_api_keys` | API keys (OpenRouter, HuggingFace, Gemini) |
| `llms_sidebar_order` | Custom model ordering |
| `llms_card_colors` | Custom card colors |
| `llms_card_icons` | Custom card icon URLs |
| `llms_chats_${modelId}` | Chat history per API model |

## Code Style Guidelines

### Text Formatting

- **All text is lowercase** - enforced via CSS: `text-transform: lowercase !important`
- This is a deliberate design choice; do not add uppercase text

### CSS Conventions

- Use Tailwind utility classes for layout (flex, grid, padding, margin)
- Use custom CSS for complex animations and component-specific styles
- Color scheme:
  - Background: `#050505` (near-black)
  - Primary: `#f5af12` (amber/gold)
  - Secondary: `#25a1da` (blue)

### JavaScript Conventions

- Vanilla JavaScript, no frameworks
- Event listeners attached after DOM elements are created
- Use `async/await` for API calls
- Error handling with try/catch blocks
- Comments use lowercase (consistent with design)

### Model Definition Format

```javascript
{
    id: 'unique-id',           // Unique identifier
    name: 'display name',      // Display name (lowercase)
    type: 'webview'|'api',     // Integration type
    url: 'https://...',        // For webview models
    domain: 'example.com',     // For icon fetching
    baseColor: '#hexcolor',    // Default card color
    supportsImages: true,      // API model supports vision
    supportsChats: true        // API model has chat sidebar
}
```

## Testing

There is currently no automated test suite. Testing is manual:

1. **Web**: Open `index.html` in browser or run `npm run build` and serve `dist/`
2. **Electron**: `cd electron && npm run electron:start`
3. **Android**: Build APK, install on device/emulator

### Manual Testing Checklist

- [ ] Homepage grid renders all model cards
- [ ] Drag-and-drop reordering works
- [ ] Sidebar navigation switches between models
- [ ] Webview models load correctly
- [ ] API chat interface works (requires API keys)
- [ ] Chat history persists after reload
- [ ] System prompt can be saved and copied
- [ ] Card icons can be customized
- [ ] Mobile responsive layout works

## Deployment

### Android APK Signing

The `build-all.sh` script handles APK signing automatically:

1. Generates debug keystore at `scripts/certs/debug.keystore` if missing
2. Signs APK with `jarsigner` or `apksigner` (preferred)
3. Zipaligns the final APK

For production releases, replace the debug keystore with your own.

### Desktop Distribution

Electron Builder produces:
- Linux: AppImage (portable) and DEB (installable)
- Windows: Portable EXE
- macOS: DMG (config exists but untested)

All outputs go to `releases/` directory.

## Security Considerations

### API Keys

- Stored in localStorage (client-side only)
- Never transmitted to any server except the intended API endpoints
- Keys are user-provided; no hardcoded credentials

### Electron Security

- `contextIsolation: false` is required for user-agent spoofing (known trade-off)
- `nodeIntegration: false` in webview contexts
- Content Security Policy set via `setupContentSecurityPolicy()`

### Android

- Uses standard Capacitor Android security model
- Web assets are local (file:// protocol)

## Common Tasks

### Adding a New Model

1. Add entry to `models` array in `script.js`:
   ```javascript
   { id: 'new-model', name: 'new model', type: 'webview', url: 'https://...', domain: 'example.com', baseColor: '#color' }
   ```

2. For API models, add handling in `sendApiMessage()` function

3. Rebuild: `npm run rebuild-all`

### Updating Icons

```bash
# Generate default robot icon
./scripts/generate-default-icon.sh

# Or use custom image
./scripts/update-icons.sh /path/to/source.png
```

### Setting Up Auto-Rebuild (Development)

```bash
# Install systemd service for continuous rebuild
sudo ./scripts/install-watch-service.sh

# Manage service
sudo systemctl status llms-watch.service
sudo systemctl restart llms-watch.service
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Electron shows white screen | Check that `dist/` exists and has files; run `npm run build` |
| Android build fails | Ensure `ANDROID_SDK_ROOT` is set and SDK is installed |
| Icons not showing | Run `./scripts/generate-default-icon.sh` to create default icons |
| OAuth login loops | Electron BrowserView handles this; if issues persist, clear `persist:llms` partition |
| APK not installing | Ensure APK is signed; unsigned APKs may be rejected |

## License

ISC License (see package.json)
