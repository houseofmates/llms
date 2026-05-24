<h1 align="center">llms</h1>

llms is a unified interface for all the ai chat services you actually want to use. it aggregates chatgpt, claude, gemini, ollama, openrouter, and others into a single customizable dashboard built with vanilla javascript — no framework lock-in, no login wall, no account synchronization across browsers.

it runs as a web page, packages as electron builds for desktop, and builds as an android apk through capacitor. one codebase for all three.

<h2 align="center">featurmates license

copyright (c) 2026 house of mates

permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "software"), to fork the existing 
codebase or utilize the code from it in one's own projects so long as financial profit is 
not to be gained by said code/software created by the code.

PKM IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE HOUSE OF MATES
SYSTEM BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF 
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE. PKM WAS INITIALLY, AND ONLY MADE TO BE USED
BY THE HOUSE OF MATES SYSTEM. OTHER USERS WERE NEVER IN MIND FOR THIS PROJECT, AND YOU
ARE EXPECTED TO CHANGE SIGNIFICANT PARTS OF THE CODEBASE TO ADAPT TO YOUR OWN PREFERENCES
AND NEEDS BASED ON THE DIFFERENCES IN HOW YOUR BRAIN WORKS VS. THE HOUSE OF MATES SYSTEM'S.
es</h2>

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

<h2 align="center">rp (roleplay) module</h2>

a sillytavern-flavored roleplay surface lives inside the same app. open the rp card from the homepage. it talks to the nvidia nim api (kimi-k2.6 by default) and stores everything locally, with optional nocobase cloud sync.

**what's in the box**

- **characters** — v3 character cards, png/json import, persona switching, avatar uploads
- **groups** — multi-character conversations with sequential / round-robin / random turn order, per-character overrides, auto-advance
- **swipes** — generate alternate replies for any assistant message, cycle through them with ◀ / ▶, ↻ to add another
- **continue** — extend a truncated assistant message in place (⏩)
- **summarize** — compress old history into a recap that replaces or appends; optional auto-summarize when context grows past a threshold
- **quick replies** — global and per-character/per-group reply sets; chips above the chat input
- **lorebook** — full sillytavern semantics: primary + secondary keys, regex (`/pattern/flags`), constant, selective, position (before / after / system / author's note), order, priority, probability, scan-depth. entries inject when triggered.
- **expressions** — multiple avatars per character. auto-switches based on detected mood (happy / sad / angry / surprised / scared / thinking / embarrassed / neutral, or your own keywords), or pick manually via the 🎭 button on each message
- **extensions** — slash commands, ui slots, and chat hooks. drop manifests on `window.rpBundledExtensions` before init. bundled samples: `/roll`, `/clear`, mood toast

**slash commands (bundled)**

- `/roll d20` or `/roll 3d6+2` — dice roller
- `/clear` — wipe the active chat

**writing an extension**

```js
window.rpBundledExtensions.push({
    id: 'me.greeter',
    name: 'greeter',
    version: '1.0.0',
    description: 'adds /wave',
    permissions: [],     // 'http:request' to enable api.requestHttp
    install(api) {
        api.registerSlashCommand('wave', (args) => `*waves at ${args || 'the room'}*`);
        api.on('chat:beforeSend', (p) => ({ ...p, text: p.text + ' :)' }));
    }
});
```

events available to extensions: `chat:beforeSend`, `chat:afterReceive`, `character:selected`. handlers may mutate and return the payload; the final value is what the rest of the pipeline sees.

**data + migration**

all rp data lives in `localStorage` keys prefixed with `llms_rp_`. on first launch after upgrading, a migration runner backfills new fields (expressions, embedded lorebook, message variants) on existing characters and chats, bumps `llms_rp_migration_version`, and stashes a one-shot backup under `llms_rp_backup_v<n>_<ts>`.

<h1 align="center">license</h1>

[mates license](license)
