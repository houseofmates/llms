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
