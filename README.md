<h1 align="center">llms</h1>

llms is a unified interface for all the ai chat services you actually want to use. it aggregates chatgpt, claude, gemini, ollama, openrouter, and others into a single customizable dashboard built with vanilla javascript — no framework lock-in, no account synchronization across browsers.

it runs as a web page, packages as electron builds for desktop, and builds as an android apk through capacitor. one codebase for all three.

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

- **not a free ai service** — just an aggregator for existing model-serving sites such as gemini.google.com.
- **not a model comparison tool** — there is no side-by-side evaluation grid or benchmark runner. this is moreso a launcher with web views.
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

all rp data lives in `localStorage` keys prefixed with `llms_rp_`. on first launch after upgrading, a migration runner backfills new fields (expressions, embedded lorebook, message variants, default world lorebook) on existing characters and chats, bumps `llms_rp_migration_version`, and stashes a one-shot backup under `llms_rp_backup_v<n>_<ts>`.

<h3>multimodal attachments</h3>

- 📎 supports multiple images per message (1 mb each); thumbnails appear in a preview tray with × buttons before send
- 🎬 experimental video attach: extracts a single frame (~1s in) via canvas and attaches it as an image — kimi has no native video support, so this is the simplest reasonable bridge
- payload is shaped as the standard openai multimodal `content: [{type:'text'...},{type:'image_url'...}]` and posted directly to `https://integrate.api.nvidia.com/v1/chat/completions`

<h3>macros (🪄)</h3>

insert `{{name}}` placeholders anywhere — system prompts, lorebook content, your own messages — and they're expanded at send time:

| macro | value |
|---|---|
| `{{time}}` | local time (configurable 12/24h) |
| `{{date}}` | local date |
| `{{datetime}}` | full timestamp |
| `{{user}}` / `{{char}}` | active persona / character |
| `{{location}}` | browser geolocation (opt-in) |
| `{{weather}}` | wttr.in lookup (opt-in, no key needed) |
| `{{random:1-100}}` | random integer in range |
| `{{your_custom_var}}` | user-defined macros from the macros modal |

disabled macros remain as literal text. unknown macros are left untouched so you notice typos.

<h3>memories</h3>

- side panel listing auto-extracted + manually added memories, scoped per character / persona / global
- auto-extract runs the kimi model every 4 assistant turns with a json-extraction prompt; results are lowercased and deduped against existing entries via a jaccard+substring similarity score
- ranked top-N (lock + confidence + relevance to last turn) memories are injected as `[relevant memories]` in the system prompt
- lock entries you want to keep forever; delete the rest

<h3>typed lorebooks: user / character / world (📚)</h3>

each lorebook now carries:

- `type` — `user` (per-persona), `character`, or `world` (single global)
- `timeframe` — free-text start/end/description (e.g., "1885" → "1900", "victorian london")
- `realityType` — `realLife` or `fictional`

at send time, entries from all three sources are merged. when the same primary key set appears in multiple sources, character > user > world wins. the v3 migration auto-creates an empty world lorebook and tags any pre-existing shared lorebooks with default metadata.

<h3>semantic caching (nvidia embeddings)</h3>

opt-in toggle in rp settings. uses `nvidia/llama-nemotron-embed-vl-1b-v2` over the same nvidia nim endpoint:

1. before generating, embed the incoming user message
2. cosine-match against cached entries for the same (character, persona)
3. if similarity ≥ threshold (default 0.92), yield the cached response as a synthetic stream and skip the generation call entirely
4. on a miss, the embedding is reused when caching the new response so we don't pay for it twice

text-only messages are eligible (images bypass the cache cleanly). cache hits surface a `cached` badge next to the character name. configurable ttl + clear button live in settings.

<h2 align="center">aggregator-wide additions</h2>

<h3>mobile tab management</h3>

- long-press (500ms) a tab on touch — or right-click on desktop — to pop an action sheet with **close / cancel**
- buttons sized 44px+ for fingers; backdrop dismisses on tap
- drag-to-reorder remains via sortablejs (delay is tuned so the long-press popup doesn't fight with drag detection)
- friendly tab names: each tab uses `model.name`, with sensible fallbacks for the two custom chat surfaces (`llama-offline` → `gemma 4b`, `rp`/`roleplay` → `kimi k2.6 rp`)

<h3>brave search for local gemma</h3>

- add your brave search api key in the api-keys modal (saved alongside the other keys)
- 🔍 button appears in the api chat input when the active model is **gemma 4b** — click to arm a one-shot search for the next message
- "auto" checkbox enables heuristic auto-search (fires when the message mentions "current", "latest", "today", "news", "weather", "price", "stock", or contains a 4-digit year)
- results are folded into a one-shot `[search results]` system message prepended to the next prompt (chat history stays clean)
- no logging: queries live only in an in-memory buffer that's cleared by the page lifetime or the clear button
- failures (missing key, brave rejection, network) fall through to a normal generation — never block the chat

<h2 align="center">personal builds: bake nvidia keys from .env</h2>

if you're building the web/electron/apk locally on your own machine and want the rp module to always use your own nvidia keys without typing them into the ui, drop them into `.env` at the repo root:

```bash
# .env (gitignored - never leaves your machine)
NVIDIA_API_KEY_1=nvapi-xxxxxxxxxxxxxxxxxxxxxxxx
NVIDIA_API_KEY_2=nvapi-yyyyyyyyyyyyyyyyyyyyyyyy
NVIDIA_API_KEY_3=nvapi-zzzzzzzzzzzzzzzzzzzzzzzz
```

then run:

```bash
npm run build       # bundles, runs cap sync, copies to electron/app/
# or, to regenerate just the keys file without a full build:
npm run bundle:env
```

what happens:

1. `scripts/bundle-env-keys.js` parses `.env`, collects every `NVIDIA_API_KEY_*` in numeric order, joins them with commas, and writes `dist/rp-keys.bundled.js`
2. the build pipeline propagates that file into the android apk (via `npx cap sync`) and into electron (via `cp -rf dist/* electron/app/`)
3. on every page load the rp module sees `window.rpBundledKeys.nvidia` and seeds its key-rotation pool from it — ignoring whatever was in `localStorage`
4. the rp settings panel shows a "using bundled keys from .env" badge and disables the manual nvidia input
5. public/ci builds with no `.env` still work fine — the script writes an empty stub so `<script src="rp-keys.bundled.js">` never 404s and the ui input becomes editable again

a `.env.example` is committed to document the format. the actual `.env` and the generated `rp-keys.bundled.js` are both gitignored.

<h2 align="center">testing</h2>

```bash
npm test          # runs jest across rp-module + tab-utils suites
```

current coverage: 65 passing unit tests across data models, macros, memory dedup, semantic cache cosine + lookup, brave search heuristic + formatting, lorebook activation, group turn order, extensions api, tab popup dom shape, and the .env → bundled-keys pipeline.

<h1 align="center">license</h1>

[mates license](license)
