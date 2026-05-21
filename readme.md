# llms App

this repository contains the llms frontend/web/electron/android project. use the `scripts/update-icons.sh` helper to replace the default application icons with your own image (for desktop/linux/appimage/deb, android apk, and windows exe).

## updating the icon

by default the project now generates a little yellow robot emoji and uses it
for all builds (desktop grid, ubuntu dock, android launcher, windows exe).
if you prefer a different icon you can still override it as described below.

1. save the image you want to use (for example the robot icon you uploaded) to a local file, e.g. `~/Downloads/robot.png`.
2. run:
   ```bash
   ./scripts/update-icons.sh ~/Downloads/robot.png
   ```
   the script will resize and copy the image into `electron/assets` and every android mipmap folder.
3. rebuild the project (`npm run build` / `npm run electron:make`, or `./gradlew assembleDebug` for apk) to embed the new icons.

> **debug mode**  
> The frontend toggles verbose logging via a `DEBUG` flag. It is enabled
> automatically on `localhost`/`127.0.0.1`, or you can force it with
> `localStorage.setItem('llms_debug','true')` in the console. Before shipping
> set `DEBUG` to `false` or remove the key from localStorage.

icons are stored at:
- `electron/assets/appIcon.png` / `.ico` (used by appimage, deb, windows, electron tray)
- `android/app/src/main/res/mipmap-*/ic_launcher*.png` (apk launcher icons)

make sure your source image is square and high resolution (512x512+).

## chat enhancements

- the default ollama model is now `qwen2.5vl:7b-q4_K_M` (vllm multimodal version).
- chat messages support images; if your model is multimodal (eg. `qwen2.5vl:7b-q4_K_M` or any openrouter/huggingface model with `vision`/`vl`/`image` substring) an attachment button appears in the chat UI. the attachment icon is placed immediately next to the send button for easier access.
- the home button in the sidebar uses a custom svg house icon filled with the primary color instead of an emoji.
- the nano banana pro (gemini) API backend now shows the same chat sidebar and saved‑chat functionality as ollama/qwen. choose between `gemini-3-pro-image` (default), `gemini-3-flash-image`, or `veo-3.1` (video) via the model dropdown. when nano banana is active the sidebar text is slightly larger to accommodate video‑mode labels.
- selecting nano banana pro when no gemini key is stored will automatically prompt you to enter it, ensuring the service works.
- code blocks enclosed in triple backticks (```) are rendered as collapsible `<details>` sections.
- streaming responses are now supported for ollama and openrouter backends; assistant text appears progressively as chunks arrive.
- the OpenRouter integration now uses the free rotation endpoint (`openrouter/free`) only, so no model selection is required. ensure your key has access to the free tier.
- the homepage grid lays out cards in a responsive grid on tablet/desktop sized windows (cards stretch across the width of the available space). on narrow/mobile screens it still uses a vertical list. the grid will also automatically scale vertically if there are too many cards to fit.
- a few model labels are now normalized and prevented from wrapping: `perplexity`, `openwebui`, `huggingface`, and `openrouter` will always appear on one line exactly as spelled.
- you can now change a card's icon by **right‑clicking** (desktop) or **long‑pressing** (mobile) on it – this opens a file picker allowing upload from your device. previous URL prompt is still available via the system prompt modal.
- added new webview model `minimax` (https://agent.minimax.io/) with color `#ed2271`.

## building the android apk

you can build an apk directly from this repo as long as you have a jdk and
android sdk installed. from the workspace root run:

```bash
cd android
./gradlew assembleRelease      # unsigned apk at android/app/build/outputs/apk/release/
```

output file will be `app-release-unsigned.apk`. sign/zipalign with your own
keystore if you want a final installable package.

there’s also a convenience script that packages everything (web build, electron
linux/windows, and android) in one go:

```bash
./scripts/build-all.sh
```

by default the desktop installers now land in the `releases/` folder at the
root of the repository (electron-builder is configured to output there), so
you can simply run the script and then look inside `releases/` for the
AppImage/.deb/.exe.

### automatic rebuilding 📦⚙️
if you’re actively hacking on the app it can be tedious to re-run the build
each time. a new `watch` script will monitor the web files, android assets,
and electron app folder and invoke the full `rebuild-all.sh` whenever anything
changes. the rebuild script itself now serializes multiple invocations, so
even if file saves happen while a build is already running the watcher will
queue another run (you’ll see a brief delay while it waits for the first
build to finish). just install the additional dependency (`npm install` after
the package.json update) and start it with:

```bash
npm run watch  # watches web files and android assets, debounced by 2 seconds
```

it’ll keep regenerating the apk/exe/deb/appimage in `releases/` as you work,
so you don’t *have* to rebuild manually unless you want to.

#### running as a daemon

if you’d rather the watcher live in the background all the time (start on boot,
automatic restart, etc.) there’s a helper script which installs a systemd
service:

```bash
sudo ./scripts/install-watch-service.sh  # run as root; the script will
# pick a non-root user automatically if called with sudo
```

once run the service is named `llms-watch.service` and can be managed with
`systemctl` like any other unit (`status`, `stop`, `restart`). it simply
executes `npm run watch` from the project directory and will restart on
failure.

