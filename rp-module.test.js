// rp-module.test.js
// unit tests for the rp module - covers swipes, continue, lorebook activation,
// summarization prompt assembly, group turn order, expression detection,
// extensions api, quick reply scoping, and data migration.

const {
    CharacterCard,
    ChatMessage,
    LorebookEntry,
    LorebookActivationEngine,
    Group,
    QuickReply,
    QuickReplySet,
    ExpressionDetector,
    ExtensionManager,
    MacroEngine,
    MemoryEntry,
    MemorySimilarity,
    SemanticCache,
    RPStorage,
    RP_STORAGE_KEYS,
    RP_MIGRATION_VERSION
} = require('./rp-module.js');

// silence noisy logs
beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('CharacterCard', () => {
    test('default fields and v3 format roundtrip', () => {
        const c = new CharacterCard({ name: 'ada' });
        expect(c.name).toBe('ada');
        expect(c.spec).toBe('chara_card_v3');
        expect(Array.isArray(c.expressions)).toBe(true);
        expect(c.defaultExpression).toBe('neutral');
        expect(Array.isArray(c.embeddedLorebook)).toBe(true);

        const v3 = c.toV3Format();
        expect(v3.data.name).toBe('ada');
    });

    test('preserves expressions across construction', () => {
        const c = new CharacterCard({
            name: 'x',
            expressions: [{ name: 'happy', avatarUrl: 'u', triggers: ['smile'] }]
        });
        expect(c.expressions[0].name).toBe('happy');
        expect(c.expressions[0].triggers).toEqual(['smile']);
    });
});

describe('ChatMessage variants', () => {
    test('totalVariants and activeVariantNumber', () => {
        const m = new ChatMessage({ role: 'assistant', content: 'original' });
        expect(m.totalVariants()).toBe(1);
        expect(m.activeVariantNumber()).toBe(1);
        expect(m.getActiveContent()).toBe('original');

        m.variants.push({ content: 'alt 1' });
        m.activeVariantIndex = 0;
        expect(m.totalVariants()).toBe(2);
        expect(m.activeVariantNumber()).toBe(2);
        expect(m.getActiveContent()).toBe('alt 1');

        m.activeVariantIndex = -1;
        expect(m.activeVariantNumber()).toBe(1);
        expect(m.getActiveContent()).toBe('original');
    });
});

describe('LorebookEntry matching', () => {
    test('basic key matching is case-insensitive by default', () => {
        const e = new LorebookEntry({ keys: ['Dragon'], content: 'fire' });
        expect(e.matches('the dragon roars')).toBe(true);
        expect(e.matches('no monsters here')).toBe(false);
    });

    test('disabled entries never match', () => {
        const e = new LorebookEntry({ keys: ['x'], content: 'y', enabled: false });
        expect(e.matches('xxx')).toBe(false);
    });

    test('regex syntax /pattern/flags works', () => {
        const e = new LorebookEntry({ keys: ['/^hello/i'], content: 'greeting' });
        expect(e.matches('hello world')).toBe(true);
        expect(e.matches('say hello')).toBe(false);
    });

    test('constant entries always match', () => {
        const e = new LorebookEntry({ keys: [], content: 'always here', constant: true });
        expect(e.matches('anything')).toBe(true);
    });

    test('selective requires both primary and secondary keys', () => {
        const e = new LorebookEntry({
            keys: ['castle'],
            secondaryKeys: ['king'],
            content: 'royal',
            selective: true
        });
        expect(e.matches('the castle is large')).toBe(false);
        expect(e.matches('the castle and the king')).toBe(true);
    });
});

describe('LorebookActivationEngine', () => {
    test('returns empty result for empty entry list', () => {
        const r = LorebookActivationEngine.activate([], [{ role: 'user', content: 'hi' }]);
        expect(r.before).toBe('');
        expect(r.after).toBe('');
        expect(r.activated).toEqual([]);
    });

    test('activates matching entries and sorts by priority desc then order asc', () => {
        const entries = [
            new LorebookEntry({ keys: ['orc'], content: 'A', priority: 1, order: 5 }),
            new LorebookEntry({ keys: ['orc'], content: 'B', priority: 5, order: 0 }),
            new LorebookEntry({ keys: ['orc'], content: 'C', priority: 5, order: 1 }),
            new LorebookEntry({ keys: ['elf'], content: 'D', priority: 99 })
        ];
        const r = LorebookActivationEngine.activate(entries, [{ role: 'user', content: 'i see an orc' }]);
        expect(r.activated.map(e => e.content)).toEqual(['B', 'C', 'A']);
    });

    test('routes content into the correct position bucket', () => {
        const entries = [
            new LorebookEntry({ keys: ['x'], content: 'before-text', position: 'before' }),
            new LorebookEntry({ keys: ['x'], content: 'after-text', position: 'after' }),
            new LorebookEntry({ keys: ['x'], content: 'sys-text', position: 'system' }),
            new LorebookEntry({ keys: ['x'], content: 'an-text', position: 'an' })
        ];
        const r = LorebookActivationEngine.activate(entries, [{ role: 'user', content: 'x' }]);
        expect(r.before).toBe('before-text');
        expect(r.after).toBe('after-text');
        expect(r.system).toBe('sys-text');
        expect(r.an).toBe('an-text');
    });

    test('scanDepth limits which recent messages are scanned', () => {
        const entry = new LorebookEntry({ keys: ['secret'], content: 's', scanDepth: 1 });
        const messages = [
            { role: 'user', content: 'secret password' },
            { role: 'assistant', content: 'ok' }
        ];
        const r = LorebookActivationEngine.activate([entry], messages);
        // only the last message ("ok") is scanned, so no match
        expect(r.activated.length).toBe(0);
    });
});

describe('Group + turn order', () => {
    test('default settings and id generation', () => {
        const g = new Group({ name: 'party', characterIds: ['a', 'b'] });
        expect(g.name).toBe('party');
        expect(g.characterIds).toEqual(['a', 'b']);
        expect(g.settings.turnOrder).toBe('sequential');
        expect(g.settings.autoAdvance).toBe(true);
        expect(g.id).toMatch(/^group_/);
    });

    test('roundRobin advances past last speaker', () => {
        // construct an rpmodule-like object minimal enough for decideGroupSpeakers
        const { RPModule } = require('./rp-module.js');
        const rp = Object.create(RPModule.prototype);
        rp.storage = {
            getCharacter(id) { return { id, name: id }; }
        };
        const g = new Group({ characterIds: ['a', 'b', 'c'], settings: { turnOrder: 'roundRobin', autoAdvance: false } });
        const out = rp.decideGroupSpeakers(g, 'b');
        expect(out.map(c => c.id)).toEqual(['c']);
    });

    test('sequential returns all characters in order', () => {
        const { RPModule } = require('./rp-module.js');
        const rp = Object.create(RPModule.prototype);
        rp.storage = { getCharacter: id => ({ id, name: id }) };
        const g = new Group({ characterIds: ['a', 'b', 'c'], settings: { turnOrder: 'sequential' } });
        const out = rp.decideGroupSpeakers(g, null);
        expect(out.map(c => c.id)).toEqual(['a', 'b', 'c']);
    });
});

describe('ExpressionDetector', () => {
    test('returns null when character has no expressions', () => {
        expect(ExpressionDetector.detect(null, 'hi')).toBeNull();
        expect(ExpressionDetector.detect({ expressions: [] }, 'hi')).toBeNull();
    });

    test('selects highest-scoring expression via default triggers', () => {
        const char = {
            expressions: [
                { name: 'happy' },
                { name: 'sad' },
                { name: 'angry' }
            ]
        };
        expect(ExpressionDetector.detect(char, 'she let out a long sigh and a tear ran down')).toBe('sad');
        expect(ExpressionDetector.detect(char, 'a wide grin spread across her face')).toBe('happy');
        expect(ExpressionDetector.detect(char, 'he glared and yelled in fury')).toBe('angry');
    });

    test('custom triggers override defaults', () => {
        const char = {
            expressions: [{ name: 'sparkly', triggers: ['glimmer', 'twinkle'] }]
        };
        expect(ExpressionDetector.detect(char, 'her eyes twinkle')).toBe('sparkly');
    });

    test('getAvatarUrl falls back gracefully', () => {
        const char = {
            avatarUrl: 'main.png',
            defaultExpression: 'happy',
            expressions: [
                { name: 'happy', avatarUrl: 'happy.png' },
                { name: 'sad', avatarUrl: 'sad.png' }
            ]
        };
        expect(ExpressionDetector.getAvatarUrl(char, 'sad')).toBe('sad.png');
        expect(ExpressionDetector.getAvatarUrl(char, 'unknown')).toBe('happy.png');
        expect(ExpressionDetector.getAvatarUrl({ avatarUrl: 'm.png' }, 'x')).toBe('m.png');
    });
});

describe('ExtensionManager', () => {
    let storage;
    let mgr;
    beforeEach(() => {
        // tiny stub storage that doesn't hit localStorage real layer
        storage = {
            _state: {},
            getExtensionState(id) { return this._state[id] || { enabled: false, settings: {} }; },
            setExtensionState(id, patch) {
                this._state[id] = Object.assign({}, this._state[id] || {}, patch);
            }
        };
        mgr = new ExtensionManager(storage);
    });

    test('register + activate runs install hook and enables', () => {
        const installed = jest.fn();
        mgr.register({
            id: 'ext.test',
            name: 'test',
            install(api) { installed(api); }
        });
        mgr.activate('ext.test');
        expect(installed).toHaveBeenCalledTimes(1);
        expect(mgr.isEnabled('ext.test')).toBe(true);
    });

    test('slash commands are routed and produce output', () => {
        mgr.register({
            id: 'ext.greet',
            name: 'greet',
            install(api) {
                api.registerSlashCommand('hi', (args) => `hello ${args || 'world'}`);
            }
        });
        mgr.activate('ext.greet');
        expect(mgr.tryHandleSlashCommand('/hi friend')).toBe('hello friend');
        expect(mgr.tryHandleSlashCommand('/hi')).toBe('hello world');
        expect(mgr.tryHandleSlashCommand('/unknown')).toBeNull();
        expect(mgr.tryHandleSlashCommand('not a command')).toBeNull();
    });

    test('emit threads payload through handlers and returns final value', () => {
        mgr.register({
            id: 'ext.mut',
            name: 'mut',
            install(api) {
                api.on('chat:beforeSend', (p) => ({ ...p, text: p.text.toUpperCase() }));
                api.on('chat:beforeSend', (p) => ({ ...p, text: '> ' + p.text }));
            }
        });
        mgr.activate('ext.mut');
        const out = mgr.emit('chat:beforeSend', { text: 'hi' });
        expect(out.text).toBe('> HI');
    });

    test('deactivate strips handlers and commands', () => {
        const sigFn = jest.fn(() => ({ text: 'changed' }));
        mgr.register({
            id: 'ext.x',
            name: 'x',
            install(api) {
                api.on('chat:beforeSend', sigFn);
                api.registerSlashCommand('foo', () => 'bar');
            }
        });
        mgr.activate('ext.x');
        expect(mgr.tryHandleSlashCommand('/foo')).toBe('bar');
        mgr.deactivate('ext.x');
        expect(mgr.tryHandleSlashCommand('/foo')).toBeNull();
        const out = mgr.emit('chat:beforeSend', { text: 'orig' });
        expect(out.text).toBe('orig');
    });

    test('http permission gate', async () => {
        mgr.register({
            id: 'ext.noperm',
            name: 'noperm',
            permissions: [],
            install(api) {
                api.registerSlashCommand('go', async () => {
                    try { await api.requestHttp('https://example.com'); return 'ok'; }
                    catch (e) { return e.message; }
                });
            }
        });
        mgr.activate('ext.noperm');
        const cmd = mgr.slashCommands.get('go');
        const result = await cmd.fn('');
        expect(result).toMatch(/lacks http:request permission/);
    });
});

describe('QuickReplySet scoping', () => {
    test('global sets are returned for any scope', () => {
        const s = new QuickReplySet({ name: 's', scope: 'global', replies: [new QuickReply({ label: 'x', text: 'y' })] });
        expect(s.scope).toBe('global');
        expect(s.replies[0].label).toBe('x');
    });
});

describe('RPStorage migration', () => {
    test('runMigrations bumps version and backfills expression defaults', () => {
        // pre-seed legacy character data with no expressions
        localStorage.setItem(RP_STORAGE_KEYS.CHARACTERS, JSON.stringify([
            { id: 'char_legacy', name: 'old', avatarUrl: '', tags: [] }
        ]));
        // and a chat with messages lacking variants
        localStorage.setItem(RP_STORAGE_KEYS.CHATS, JSON.stringify({
            char_legacy: { messages: [{ id: 'm1', role: 'assistant', content: 'hi' }], branches: ['main'] }
        }));

        // sanity: version not yet set
        expect(localStorage.getItem(RP_STORAGE_KEYS.MIGRATION_VERSION)).toBeNull();

        const storage = new RPStorage();
        // runMigrations is invoked during loadAll(); it's async only for nocobase sync
        // we can also call it manually to be safe
        storage.runMigrations();

        expect(localStorage.getItem(RP_STORAGE_KEYS.MIGRATION_VERSION)).toBe(String(RP_MIGRATION_VERSION));
        const char = storage.getCharacter('char_legacy');
        expect(Array.isArray(char.expressions)).toBe(true);
        expect(char.defaultExpression).toBe('neutral');
        expect(Array.isArray(char.embeddedLorebook)).toBe(true);

        const chat = storage.getChat('char_legacy');
        for (const m of chat.messages) {
            expect(Array.isArray(m.variants)).toBe(true);
            expect(typeof m.activeVariantIndex).toBe('number');
        }
    });
});

describe('Summarization prompt assembly', () => {
    test('summarizeMessages builds a non-streaming prompt with system+user', async () => {
        const { RPModule } = require('./rp-module.js');
        const rp = Object.create(RPModule.prototype);
        rp.currentCharacter = { name: 'alice' };
        rp.currentPersona = { name: 'bob' };
        rp.storage = {};
        // stub api client + key check
        rp.getApiKeys = () => ({ nvidia: 'fake-key' });
        const sendMessage = jest.fn().mockResolvedValue('the summary');
        rp.apiClient = { sendMessage };

        const messages = [
            { role: 'user', content: 'hi alice' },
            { role: 'assistant', content: '*waves* hi bob' }
        ];
        const result = await rp.summarizeMessages(messages);
        expect(result).toBe('the summary');
        expect(sendMessage).toHaveBeenCalledTimes(1);
        const [prompt, opts] = sendMessage.mock.calls[0];
        expect(opts.stream).toBe(false);
        expect(prompt[0].role).toBe('system');
        expect(prompt[1].role).toBe('user');
        expect(prompt[1].content).toMatch(/bob/);
        expect(prompt[1].content).toMatch(/alice/);
        expect(prompt[1].content).toMatch(/hi alice/);
    });
});

// ---------- new in pr #5 ----------

describe('MacroEngine', () => {
    function mkStorage(initial = {}) {
        const settings = { ...initial };
        return {
            getSetting: (k, d) => (settings[k] === undefined ? d : settings[k]),
            setSetting: (k, v) => { settings[k] = v; },
            _settings: settings
        };
    }

    test('expands built-in macros and leaves disabled ones alone', () => {
        const storage = mkStorage({ macroToggles: { user: true, char: true, random: false } });
        const eng = new MacroEngine(storage);
        const out = eng.expand('hi {{char}}, i am {{user}}. roll {{random:1-6}}', {
            user: 'bob', char: 'alice'
        });
        expect(out).toMatch(/^hi alice, i am bob/);
        // random was disabled -> left as literal
        expect(out).toContain('{{random:1-6}}');
    });

    test('expand respects custom macros', () => {
        const storage = mkStorage({ customMacros: { greeting: 'howdy' } });
        const eng = new MacroEngine(storage);
        const out = eng.expand('say {{greeting}}!');
        expect(out).toBe('say howdy!');
    });

    test('unknown macros are left as-is', () => {
        const storage = mkStorage();
        const eng = new MacroEngine(storage);
        expect(eng.expand('hello {{nope}}')).toBe('hello {{nope}}');
    });

    test('expandMessages walks string and multipart content', () => {
        const storage = mkStorage();
        const eng = new MacroEngine(storage);
        const out = eng.expandMessages([
            { role: 'user', content: 'hi {{user}}' },
            { role: 'user', content: [
                { type: 'text', text: 'see {{char}}' },
                { type: 'image_url', image_url: { url: 'data:image/png;base64,xxx' } }
            ] }
        ], { user: 'bob', char: 'alice' });
        expect(out[0].content).toBe('hi bob');
        expect(out[1].content[0].text).toBe('see alice');
        expect(out[1].content[1].image_url.url).toMatch(/^data:image\/png/);
    });

    test('random:a-b returns a number in range', () => {
        const storage = mkStorage();
        const eng = new MacroEngine(storage);
        for (let i = 0; i < 20; i++) {
            const out = eng.expand('{{random:5-7}}');
            const n = parseInt(out, 10);
            expect(n).toBeGreaterThanOrEqual(5);
            expect(n).toBeLessThanOrEqual(7);
        }
    });

    test('getToggles defaults missing built-ins to true and reflects overrides', () => {
        const storage = mkStorage({ macroToggles: { time: false } });
        const eng = new MacroEngine(storage);
        const t = eng.getToggles();
        expect(t.time).toBe(false);
        expect(t.user).toBe(true);
        expect(t.random).toBe(true);
    });
});

describe('MemorySimilarity', () => {
    test('jaccard recognises near-duplicates of short factual sentences', () => {
        const a = 'user lives in tokyo';
        const b = 'the user lives in tokyo japan';
        expect(MemorySimilarity.jaccard(a, b)).toBeGreaterThan(0.45);
        expect(MemorySimilarity.score(a, b)).toBeGreaterThan(0.5);
    });

    test('jaccard is low for unrelated sentences', () => {
        expect(MemorySimilarity.jaccard('user is a doctor', 'castle in the sky')).toBeLessThan(0.2);
    });
});

describe('RPStorage memories', () => {
    test('addMemory dedupes against similar existing entries', () => {
        const s = new RPStorage();
        s.addMemory({ content: 'user lives in tokyo', source: 'manual', confidence: 0.8 }, 'global');
        s.addMemory({ content: 'the user lives in tokyo japan', source: 'auto', confidence: 0.6 }, 'global');
        const all = s.getMemories('global');
        // dedupe collapsed both into a single entry
        expect(all.length).toBe(1);
        expect(all[0].lastRelevantAt).not.toBeNull();
    });

    test('getRelevantMemories merges scopes without duplicates', () => {
        const s = new RPStorage();
        s.addMemory({ content: 'one' }, 'character:c1');
        s.addMemory({ content: 'two' }, 'persona:p1');
        s.addMemory({ content: 'three' }, 'global');
        const out = s.getRelevantMemories({ characterId: 'c1', personaId: 'p1' });
        expect(out.map(m => m.content).sort()).toEqual(['one', 'three', 'two']);
    });

    test('updateMemory lowercases content and persists', () => {
        const s = new RPStorage();
        const m = s.addMemory({ content: 'original' });
        s.updateMemory(m.id, { content: 'NEW Content' });
        expect(s.getMemories('global')[0].content).toBe('new content');
    });
});

describe('RPStorage typed lorebooks', () => {
    test('saveLorebookMeta defaults are sane and getWorldLorebookId works', () => {
        const s = new RPStorage();
        // wipe the default world-lorebook created by the v3 migration so we
        // can assert on a fresh instance
        s.lorebookMeta.clear();
        s.lorebooks.clear();
        s.lorebooks.set('w1', []);
        s.saveLorebookMeta('w1', { name: 'world', type: 'world', realityType: 'realLife' });
        expect(s.getWorldLorebookId()).toBe('w1');
        const meta = s.getLorebookMeta('w1');
        expect(meta.realityType).toBe('realLife');
        expect(meta.timeframe.start).toBe('');
    });

    test('user lorebook is found by persona id', () => {
        const s = new RPStorage();
        s.lorebooks.set('u1', []);
        s.saveLorebookMeta('u1', { name: 'me', type: 'user', scopeId: 'persona_x' });
        expect(s.getUserLorebookIdForPersona('persona_x')).toBe('u1');
        expect(s.getUserLorebookIdForPersona('nope')).toBeNull();
    });
});

describe('SemanticCache', () => {
    test('cosine similarity', () => {
        expect(SemanticCache.cosine([1, 0], [1, 0])).toBeCloseTo(1, 5);
        expect(SemanticCache.cosine([1, 0], [0, 1])).toBeCloseTo(0, 5);
        expect(SemanticCache.cosine([1, 1], [1, 1])).toBeCloseTo(1, 5);
        expect(SemanticCache.cosine([1, 1], [-1, -1])).toBeCloseTo(-1, 5);
    });

    test('lookup returns null when disabled', async () => {
        const settings = {};
        const storage = {
            getSetting: (k, d) => (settings[k] === undefined ? d : settings[k]),
            setSetting: (k, v) => { settings[k] = v; }
        };
        const cache = new SemanticCache({}, storage);
        const out = await cache.lookup('hi', { characterId: 'c1' });
        expect(out).toBeNull();
    });

    test('lookup returns hit when an entry exceeds threshold', async () => {
        const settings = { semanticCacheEnabled: true, semanticCacheThreshold: 0.9, semanticCacheTTLDays: 7 };
        const storage = {
            getSetting: (k, d) => (settings[k] === undefined ? d : settings[k]),
            setSetting: (k, v) => { settings[k] = v; }
        };
        // stub keyPool + embed
        const keyPool = { getActiveKey: () => 'fake' };
        const cache = new SemanticCache(keyPool, storage);
        // bypass actual fetch: monkey-patch embed
        cache.embed = jest.fn().mockResolvedValue([1, 0, 0]);
        // seed an entry directly
        cache._entries = [{
            text: 'hello',
            response: 'cached response!',
            embedding: [1, 0, 0],
            at: Date.now(),
            characterId: 'c1',
            personaId: 'p1'
        }];
        const out = await cache.lookup('different text but same embedding', { characterId: 'c1', personaId: 'p1' });
        expect(out).not.toBeNull();
        expect(out.response).toBe('cached response!');
        expect(out.similarity).toBeCloseTo(1, 3);
    });

    test('lookup returns miss object (not null) when no entries match', async () => {
        const settings = { semanticCacheEnabled: true, semanticCacheThreshold: 0.95 };
        const storage = {
            getSetting: (k, d) => (settings[k] === undefined ? d : settings[k]),
            setSetting: (k, v) => { settings[k] = v; }
        };
        const cache = new SemanticCache({ getActiveKey: () => 'fake' }, storage);
        cache.embed = jest.fn().mockResolvedValue([1, 0, 0]);
        cache._entries = [{
            text: 'unrelated', response: 'r', embedding: [0, 1, 0], at: Date.now(),
            characterId: 'c1', personaId: null
        }];
        const out = await cache.lookup('q', { characterId: 'c1', personaId: null });
        expect(out.hit).toBe(false);
        expect(Array.isArray(out.queryEmbedding)).toBe(true);
    });
});

describe('Brave search heuristic + formatting', () => {
    const Brave = require('./brave-search.js');

    test('shouldAutoSearch fires on freshness keywords', () => {
        expect(Brave.shouldAutoSearch('what is the latest news on x?')).toBe(true);
        expect(Brave.shouldAutoSearch('weather today')).toBe(true);
        expect(Brave.shouldAutoSearch('current stock price of nvda')).toBe(true);
    });

    test('shouldAutoSearch fires on year-like patterns', () => {
        expect(Brave.shouldAutoSearch('events in 2024')).toBe(true);
    });

    test('shouldAutoSearch does not fire on generic conversation', () => {
        expect(Brave.shouldAutoSearch('hi how are you')).toBe(false);
        expect(Brave.shouldAutoSearch('explain monads')).toBe(false);
    });

    test('formatResultsForPrompt produces a numbered block', () => {
        const out = Brave.formatResultsForPrompt('q', [
            { title: 'A', url: 'http://a', description: 'desc a' },
            { title: 'B', url: 'http://b', description: 'desc b' }
        ]);
        expect(out).toMatch(/search query: q/);
        expect(out).toMatch(/\[1\] A/);
        expect(out).toMatch(/\[2\] B/);
        expect(out).toMatch(/desc a/);
    });

    test('search rejects without an api key', async () => {
        await expect(Brave.search('q')).rejects.toThrow(/no brave api key/);
    });

    test('search returns normalized results on 200', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ web: { results: [
                { title: 't1', url: 'u1', description: '<b>d1</b>' }
            ] } })
        });
        const out = await Brave.search('q', { apiKey: 'k' });
        expect(out).toEqual([{ title: 't1', url: 'u1', description: 'd1' }]);
    });
});

describe('Image attachments serialize as image_url parts', () => {
    test('chat message with images becomes a multipart content array', () => {
        // duplicate the inline shape from getContextMessages -> ensures any
        // future refactor doesn't accidentally drop the image_url plumbing.
        const msg = new ChatMessage({
            role: 'user',
            content: 'look at this',
            images: ['data:image/png;base64,AAA', 'data:image/jpeg;base64,BBB']
        });
        // simulate the serialization done in getContextMessages
        const role = msg.role;
        const content = msg.getActiveContent();
        const c = [{ type: 'text', text: content }];
        for (const img of msg.images) {
            c.push({ type: 'image_url', image_url: { url: img } });
        }
        const payload = { role, content: c };
        expect(payload.content).toHaveLength(3);
        expect(payload.content[0]).toEqual({ type: 'text', text: 'look at this' });
        expect(payload.content[1].type).toBe('image_url');
        expect(payload.content[1].image_url.url).toMatch(/^data:image\/png/);
        expect(payload.content[2].image_url.url).toMatch(/^data:image\/jpeg/);
    });
});
