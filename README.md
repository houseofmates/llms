<h1 align="center">llms</h1>

llms is a unified interface for all the ai chat services you actually want to use. it aggregates chatgpt, claude, gemini, ollama, openrouter, and others into a single customizable dashboard built with vanilla javascript — no framework lock-in, no login wall, no account synchronization across browsers.

it runs as a web page, packages as electron builds for desktop, and builds as an android apk through capacitor. one codebase for all three.

<h2 align="center">features</h2>

- **unified dashboard** — one view for every ai service you use. card grid, reorderable, themable.
- **webview models** — embedded chromium browser inside the app for gemini, chatgpt, claude, and others. oauth flows just work.
- **api models** — direct rest integration with ollama, openrouter, hugging face, google gemini api. streaming included.
- **streaming responses** — assistant text appears progressively for supported backends
- **image attachment** — attach images to api model calls for multimodal models
- **chat history** — per-model conversation history stored in localstorage
- **multi-platform** — web, linux appimage / deb via electron, android apk via capacitor, windows exe via electron
- **icon customization** — change card icons by right-clicking (desktop) or long-pressing (mobile)
- **code block rendering** — triple-backtick blocks rendered as collapsible sections
- **dark amber aesthetic** — near-black background with an amber primary accent. not a generic dark theme.
- **auto-rebuild watcher** — systemd service that rebuilds the apk/exe/deb/appimage automatically when source files change

<h2 align="center">what it is not for</h2>

- **not a free ai service** — you need to supply your own api keys or run a local model. nothing here gives you access to ai without one.
- **not a model comparison tool** — there is no side-by-side evaluation grid or benchmark runner. this is a launcher.
- **not a token budget manager** — there is no usage tracking or cost dashboard. that lives in your provider's account panel.
- **electron desktop depends on electron-builder** — linux appimages and debs generate through electron-builder. if you only want the web and the android build, you do not need electron at all — just npm run build.

<h2 align="center">installation</h2>

```bash
npm install

npm run build

cd electron
npm run electron:make-linux

cd electron
npm run electron:make-win

cd android
./gradlew assembleDebug

./rebuild-all.sh
```

configuration for api models lives in the app settings. store your openrouter key, gemini api key, and hugging face token there. no environment files to edit; the app handles it from the ui.

<h1 align="center">license</h1>

isc license
