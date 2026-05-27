<h1 align="center">llms</h1>

<p align="center">llms is a unified interface for all the ai chat services you actually want to use. it aggregates chatgpt, claude, gemini, ollama, openrouter, and others into a single customizable dashboard built with vanilla javascript — no framework lock-in, no account synchronization across browsers.</p>

<p align="center">it runs as a web page, packages as electron builds for desktop, and builds as an android apk through capacitor. one codebase for all three.</p>

- **unified dashboard** — one view for every ai service you use. card grid, reorderable, themable.
- **webview models** — embedded chromium browser inside the app for gemini, chatgpt, claude, and others. oauth flows just work.
- **api models** — direct rest integration with ollama, openrouter, hugging face, google gemini api. streaming included.
- **streaming responses** — assistant text appears progressively for supported backends
- **image attachment** — attach images to api model calls for multimodal models
- **chat history** — per-model conversation history stored in localstorage
- **multi-platform** — web, linux appimage / deb via electron, android apk via capacitor, windows exe via electron, native android apk
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

<pre align="center"><code>npm install

npm run build

cd electron
npm run electron:make-linux

cd electron
npm run electron:make-win

cd android
./gradlew assembleDebug

./rebuild-all.sh
</code></pre>

<p align="center">configuration for api models lives in the app settings. store your openrouter key, gemini api key, and hugging face token there. no environment files to edit; the app handles it from the ui.</p>

<h2 align="center">rp (roleplay) module</h2>

<p align="center">a sillytavern-flavored roleplay surface lives inside the same app. open the rp card from the homepage. it talks to the nvidia nim api (kimi-k2.6 by default) and stores everything locally, with optional nocobase cloud sync.</p>

<p align="center"><strong>what's in the box</strong></p>

- **characters** — v3 character cards, png/json import, persona switching, avatar uploads
- **groups** — multi-character conversations with sequential / round-robin / random turn order, per-character overrides, auto-advance
- **swipes** — generate alternate replies for any assistant message, cycle through them with ◀ / ▶, ↻ to add another
- **continue** — extend a truncated assistant message in place (⏩)
- **summarize** — compress old history into a recap that replaces or appends; optional auto-summarize when context grows past a threshold
- **quick replies** — global and per-character/per-group reply sets; chips above the chat input
- **lorebook** — full sillytavern semantics: primary + secondary keys, regex (`/pattern/flags`), constant, selective, position (before / after / system / author's note), order, priority, probability, scan-depth. entries inject when triggered.
- **expressions** — multiple avatars per character. auto-switches based on detected mood (happy / sad / angry / surprised / scared / thinking / embarrassed / neutral, or your own keywords), or pick manually via the 🎭 button on each message
- **extensions** — slash commands, ui slots, and chat hooks. drop manifests on `window.rpBundledExtensions` before init. bundled samples: `/roll`, `/clear`, mood toast

<p align="center"><strong>slash commands (bundled)</strong></p>

- `/roll d20` or `/roll 3d6+2` — dice roller
- `/clear` — wipe the active chat

<h3 align="center">writing an extension</h3>

<pre align="center"><code>window.rpBundledExtensions.push({
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
</code></pre>

<p align="center">events available to extensions: <code>chat:beforeSend</code>, <code>chat:afterReceive</code>, <code>character:selected</code>. handlers may mutate and return the payload; the final value is what the rest of the pipeline sees.</p>

<h3 align="center">data + migration</h3>

<p align="center">all rp data lives in <code>localStorage</code> keys prefixed with <code>llms_rp_</code>. on first launch after upgrading, a migration runner backfills new fields (expressions, embedded lorebook, message variants, default world lorebook) on existing characters and chats, bumps <code>llms_rp_migration_version</code>, and stashes a one-shot backup under <code>llms_rp_backup_v&lt;n&gt;_&lt;ts&gt;</code>.</p>

<h3 align="center">multimodal attachments</h3>

- 📎 supports multiple images per message (1 mb each); thumbnails appear in a preview tray with × buttons before send
- 🎬 experimental video attach: extracts a single frame (~1s in) via canvas and attaches it as an image — kimi has no native video support, so this is the simplest reasonable bridge
- payload is shaped as the standard openai multimodal `content: [{type:'text'...},{type:'image_url'...}]` and posted directly to `https://integrate.api.nvidia.com/v1/chat/completions`

<h3 align="center">macros (🪄)</h3>

<p align="center">insert <code>{{name}}</code> placeholders anywhere — system prompts, lorebook content, your own messages — and they're expanded at send time:</p>

<div align="center">
<table>
  <thead>
    <tr><th>macro</th><th>value</th></tr>
  </thead>
  <tbody>
    <tr><td><code>{{time}}</code></td><td>local time (configurable 12/24h)</td></tr>
    <tr><td><code>{{date}}</code></td><td>local date</td></tr>
    <tr><td><code>{{datetime}}</code></td><td>full timestamp</td></tr>
    <tr><td><code>{{user}}</code> / <code>{{char}}</code></td><td>active persona / character</td></tr>
    <tr><td><code>{{location}}</code></td><td>browser geolocation (opt-in)</td></tr>
    <tr><td><code>{{weather}}</code></td><td>wttr.in lookup (opt-in, no key needed)</td></tr>
    <tr><td><code>{{random:1-100}}</code></td><td>random integer in range</td></tr>
    <tr><td><code>{{your_custom_var}}</code></td><td>user-defined macros from the macros modal</td></tr>
  </tbody>
</table>
</div>

<p align="center">disabled macros remain as literal text. unknown macros are left untouched so you notice typos.</p>

<h3 align="center">memories</h3>

- side panel listing auto-extracted + manually added memories, scoped per character / persona / global
- auto-extract runs the kimi model every 4 assistant turns with a json-extraction prompt; results are lowercased and deduped against existing entries via a jaccard+substring similarity score
- ranked top-N (lock + confidence + relevance to last turn) memories are injected as `[relevant memories]` in the system prompt
- lock entries you want to keep forever; delete the rest

<h3 align="center">typed lorebooks: user / character / world (📚)</h3>

<p align="center">each lorebook now carries:</p>

- `type` — `user` (per-persona), `character`, or `world` (single global)
- `timeframe` — free-text start/end/description (e.g., "1885" → "1900", "victorian london")
- `realityType` — `realLife` or `fictional`

<p align="center">at send time, entries from all three sources are merged. when the same primary key set appears in multiple sources, character > user > world wins. the v3 migration auto-creates an empty world lorebook and tags any pre-existing shared lorebooks with default metadata.</p>

<h3 align="center">semantic caching (nvidia embeddings)</h3>

<p align="center">opt-in toggle in rp settings. uses <code>nvidia/llama-nemotron-embed-vl-1b-v2</code> over the same nvidia nim endpoint:</p>

1. before generating, embed the incoming user message
2. cosine-match against cached entries for the same (character, persona)
3. if similarity ≥ threshold (default 0.92), yield the cached response as a synthetic stream and skip the generation call entirely
4. on a miss, the embedding is reused when caching the new response so we don't pay for it twice

<p align="center">text-only messages are eligible (images bypass the cache cleanly). cache hits surface a <code>cached</code> badge next to the character name. configurable ttl + clear button live in settings.</p>

<h2 align="center">aggregator-wide additions</h2>

<h3 align="center">mobile tab management</h3>

- long-press (500ms) a tab on touch — or right-click on desktop — to pop an action sheet with **close / cancel**
- buttons sized 44px+ for fingers; backdrop dismisses on tap
- drag-to-reorder remains via sortablejs (delay is tuned so the long-press popup doesn't fight with drag detection)
- friendly tab names: each tab uses `model.name`, with sensible fallbacks for the two custom chat surfaces (`llama-offline` → `gemma 4b`, `rp`/`roleplay` → `kimi k2.6 rp`)

<h3 align="center">brave search for local gemma</h3>

- add your brave search api key in the api-keys modal (saved alongside the other keys)
- 🔍 button appears in the api chat input when the active model is **gemma 4b** — click to arm a one-shot search for the next message
- "auto" checkbox enables heuristic auto-search (fires when the message mentions "current", "latest", "today", "news", "weather", "price", "stock", or contains a 4-digit year)
- results are folded into a one-shot `[search results]` system message prepended to the next prompt (chat history stays clean)
- no logging: queries live only in an in-memory buffer that's cleared by the page lifetime or the clear button
- failures (missing key, brave rejection, network) fall through to a normal generation — never block the chat

<h2 align="center">personal builds: bake nvidia keys from .env</h2>

<p align="center">if you're building the web/electron/apk locally on your own machine and want the rp module to always use your own nvidia keys without typing them into the ui, drop them into <code>.env</code> at the repo root:</p>

<pre align="center"><code># .env (gitignored - never leaves your machine)
NVIDIA_API_KEY_1=nvapi-xxxxxxxxxxxxxxxxxxxxxxxx
NVIDIA_API_KEY_2=nvapi-yyyyyyyyyyyyyyyyyyyyyyyy
NVIDIA_API_KEY_3=nvapi-zzzzzzzzzzzzzzzzzzzzzzzz
</code></pre>

<p align="center">then run:</p>

<pre align="center"><code>npm run build       # bundles, runs cap sync, copies to electron/app/
# or, to regenerate just the keys file without a full build:
npm run bundle:env
</code></pre>

<p align="center">what happens:</p>

1. `scripts/bundle-env-keys.js` parses `.env`, collects every `NVIDIA_API_KEY_*` in numeric order, joins them with commas, and writes `dist/rp-keys.bundled.js`
2. the build pipeline propagates that file into the android apk (via `npx cap sync`) and into electron (via `cp -rf dist/* electron/app/`)
3. on every page load the rp module sees `window.rpBundledKeys.nvidia` and seeds its key-rotation pool from it — ignoring whatever was in `localStorage`
4. the rp settings panel shows a "using bundled keys from .env" badge and disables the manual nvidia input
5. public/ci builds with no `.env` still work fine — the script writes an empty stub so `<script src="rp-keys.bundled.js">` never 404s and the ui input becomes editable again

<p align="center">a <code>.env.example</code> is committed to document the format. the actual <code>.env</code> and the generated <code>rp-keys.bundled.js</code> are both gitignored.</p>

<h2 align="center">testing</h2>

<pre align="center"><code>npm test          # runs jest across rp-module + tab-utils suites
</code></pre>

<p align="center">current coverage: 65 passing unit tests across data models, macros, memory dedup, semantic cache cosine + lookup, brave search heuristic + formatting, lorebook activation, group turn order, extensions api, tab popup dom shape, and the .env → bundled-keys pipeline.</p>

<h2 align="center">license</h2>

<p align="center"><a href="./LICENSE">mates license</a></p>
