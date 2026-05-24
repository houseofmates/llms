// rp-module.js - roleplay module for llms aggregator
// a sillytavern-inspired character roleplay system

// =====================================================
// storage keys
// =====================================================
const RP_STORAGE_KEYS = {
    CHARACTERS: 'llms_rp_characters',
    PERSONAS: 'llms_rp_personas',
    CHATS: 'llms_rp_chats',
    SETTINGS: 'llms_rp_settings',
    LOREBOOKS: 'llms_rp_lorebooks',
    ACTIVE_PERSONA: 'llms_rp_active_persona',
    API_KEYS: 'llms_rp_api_keys',
    KEY_POOL_STATE: 'llms_rp_key_pool_state',
    GROUPS: 'llms_rp_groups',
    GROUP_CHATS: 'llms_rp_group_chats',
    QUICK_REPLY_SETS: 'llms_rp_quick_reply_sets',
    EXTENSIONS: 'llms_rp_extensions',
    MIGRATION_VERSION: 'llms_rp_migration_version'
};

// current data migration version. bump when models change.
const RP_MIGRATION_VERSION = 2;

// =====================================================
// nvidia nim api configuration
// =====================================================
const NVIDIA_NIM_CONFIG = {
    endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
    model: 'moonshotai/kimi-k2.6',
    maxRetries: 3,
    retryDelay: 1000
};

// =====================================================
// character card v3 spec
// =====================================================
class CharacterCard {
    constructor(data = {}) {
        this.id = data.id || this.generateId();
        this.spec = 'chara_card_v3';
        this.spec_version = '3.0';
        this.name = data.name || '';
        this.description = data.description || '';
        this.personality = data.personality || '';
        this.scenario = data.scenario || '';
        this.firstMes = data.firstMes || data.first_mes || '';
        this.mesExample = data.mesExample || data.mes_example || '';
        this.creatorNotes = data.creatorNotes || data.creator_notes || '';
        this.systemPrompt = data.systemPrompt || data.system_prompt || '';
        this.postHistoryInstructions = data.postHistoryInstructions || data.post_history_instructions || '';
        this.alternateGreetings = data.alternateGreetings || data.alternate_greetings || [];
        this.avatarUrl = data.avatarUrl || data.avatar || '';
        this.tags = data.tags || [];
        this.isFavorite = data.isFavorite || data.fav || false;
        this.lorebookId = data.lorebookId || data.character_book || null;
        this.talkativeness = data.talkativeness || 0.5;
        this.createdAt = data.createdAt || new Date().toISOString();
        this.updatedAt = data.updatedAt || new Date().toISOString();
        this.extensions = data.extensions || {};

        // expressions: array of { name, avatarUrl, triggers }
        // each expression represents a mood/emotion the character can show
        this.expressions = Array.isArray(data.expressions) ? data.expressions : [];
        this.defaultExpression = data.defaultExpression || 'neutral';

        // embedded lorebook entries (sillytavern character_book)
        // entries may also live in a shared lorebook keyed by lorebookId
        this.embeddedLorebook = Array.isArray(data.embeddedLorebook) ? data.embeddedLorebook : [];
    }

    generateId() {
        return 'char_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    toV3Format() {
        return {
            spec: this.spec,
            spec_version: this.spec_version,
            data: {
                name: this.name,
                description: this.description,
                personality: this.personality,
                scenario: this.scenario,
                first_mes: this.firstMes,
                mes_example: this.mesExample,
                creator_notes: this.creatorNotes,
                system_prompt: this.systemPrompt,
                post_history_instructions: this.postHistoryInstructions,
                alternate_greetings: this.alternateGreetings,
                character_book: this.lorebookId,
                extensions: {
                    talkativeness: this.talkativeness,
                    fav: this.isFavorite,
                    ...this.extensions
                }
            }
        };
    }

    static fromV2Format(v2Data) {
        // backward compatibility with v2 character cards
        const data = v2Data.data || v2Data;
        return new CharacterCard({
            name: data.name,
            description: data.description,
            personality: data.personality,
            scenario: data.scenario,
            first_mes: data.first_mes,
            mes_example: data.mes_example,
            creator_notes: data.creator_notes || '',
            system_prompt: data.system_prompt || '',
            post_history_instructions: data.post_history_instructions || '',
            alternate_greetings: data.alternate_greetings || [],
            avatar: data.avatar || '',
            tags: data.tags || [],
            fav: data.extensions?.fav || false,
            talkativeness: data.extensions?.talkativeness || 0.5,
            character_book: data.character_book || null
        });
    }
}

// =====================================================
// persona class
// =====================================================
class Persona {
    constructor(data = {}) {
        this.id = data.id || this.generateId();
        this.name = data.name || 'user';
        this.description = data.description || '';
        this.avatarUrl = data.avatarUrl || '';
        this.isDefault = data.isDefault || false;
        this.createdAt = data.createdAt || new Date().toISOString();
        this.updatedAt = data.updatedAt || new Date().toISOString();
    }

    generateId() {
        return 'persona_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }
}

// =====================================================
// chat message class
// =====================================================
class ChatMessage {
    constructor(data = {}) {
        this.id = data.id || this.generateId();
        this.role = data.role || 'user'; // 'user' | 'assistant' | 'system'
        this.content = data.content || '';
        this.images = data.images || [];
        this.timestamp = data.timestamp || new Date().toISOString();
        this.characterId = data.characterId || null;
        this.personaId = data.personaId || null;
        this.branchId = data.branchId || 'main';
        this.parentMessageId = data.parentMessageId || null;
        // variants: list of { content, generatedAt, model, temperature }
        this.variants = Array.isArray(data.variants) ? data.variants : [];
        // index of currently displayed variant within variants. -1 means use root content.
        this.activeVariantIndex = typeof data.activeVariantIndex === 'number' ? data.activeVariantIndex : -1;
        this.isEdited = data.isEdited || false;
        // expression name shown for this message (assistant messages only)
        this.expression = data.expression || null;
        // optional summary block (marks a message that replaces a swath of history)
        this.isSummary = !!data.isSummary;
        // for group chats: which character actually spoke this assistant turn
        this.speakerCharacterId = data.speakerCharacterId || null;
    }

    generateId() {
        return 'msg_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    // returns the active text content, accounting for active variant
    getActiveContent() {
        if (this.activeVariantIndex >= 0 && this.variants[this.activeVariantIndex]) {
            return this.variants[this.activeVariantIndex].content;
        }
        return this.content;
    }

    // total number of variants including the original
    totalVariants() {
        return 1 + this.variants.length;
    }

    // active variant number (1-indexed) for ui display
    activeVariantNumber() {
        return this.activeVariantIndex < 0 ? 1 : this.activeVariantIndex + 2;
    }
}

// =====================================================
// lorebook entry class (sillytavern-compatible)
// =====================================================
class LorebookEntry {
    constructor(data = {}) {
        this.id = data.id || this.generateId();
        this.keys = Array.isArray(data.keys) ? data.keys : [];
        // secondary keys must ALSO match when present (logic: secondary AND any primary)
        this.secondaryKeys = Array.isArray(data.secondaryKeys || data.keysecondary) ? (data.secondaryKeys || data.keysecondary) : [];
        this.content = data.content || '';
        this.enabled = data.enabled !== false;
        this.insertionOrder = data.insertionOrder ?? data.insertion_order ?? 0;
        this.caseSensitive = !!(data.caseSensitive || data.case_sensitive);
        // priority: higher means included first when budget is limited
        this.priority = data.priority || 0;
        this.comment = data.comment || '';
        // constant entries are always injected, ignoring keys
        this.constant = !!data.constant;
        // selective: only match when both primary AND secondary keys match
        // (default true if secondaryKeys exist to match sillytavern semantics)
        this.selective = data.selective !== undefined
            ? !!data.selective
            : (this.secondaryKeys.length > 0);
        // position: where to inject relative to chat
        // 'before' = prepended to system prompt, 'after' = appended after system,
        // 'system' = standalone system message, 'an' = author's note (after chat)
        this.position = data.position || 'before';
        // ordering: lower numbers inject earlier (deterministic), priority breaks ties
        this.order = data.order ?? data.insertionOrder ?? 0;
        // depth: how many recent messages to scan for matches (0 = unlimited)
        this.scanDepth = data.scanDepth || 0;
        // probability percent (0-100) that this entry triggers when matched
        this.probability = typeof data.probability === 'number' ? data.probability : 100;
    }

    generateId() {
        return 'lore_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    // returns true if any key (or regex /pattern/flags) matches the given text
    matchesAny(keyList, text) {
        const searchText = this.caseSensitive ? text : text.toLowerCase();
        for (const rawKey of keyList) {
            if (!rawKey) continue;
            const key = String(rawKey).trim();
            // regex syntax /pattern/flags
            const regexMatch = key.match(/^\/(.+)\/([gimsuy]*)$/);
            if (regexMatch) {
                try {
                    const re = new RegExp(regexMatch[1], regexMatch[2]);
                    if (re.test(searchText)) return true;
                } catch (e) {
                    // fall through to substring match
                }
                continue;
            }
            const searchKey = this.caseSensitive ? key : key.toLowerCase();
            if (searchText.includes(searchKey)) return true;
        }
        return false;
    }

    // returns true if this entry should be activated for the given context text
    matches(text) {
        if (!this.enabled) return false;
        if (this.constant) return true;
        const hasPrimary = this.matchesAny(this.keys, text);
        if (!hasPrimary) return false;
        if (this.selective && this.secondaryKeys.length > 0) {
            return this.matchesAny(this.secondaryKeys, text);
        }
        return true;
    }
}

// =====================================================
// lorebook activation engine
// =====================================================
class LorebookActivationEngine {
    // recent messages: array of objects with at least { role, content }
    // entries: array of LorebookEntry instances
    // returns: { systemBlocks: { before, after, system, an }, activated: [entries] }
    static activate(entries, recentMessages, opts = {}) {
        if (!Array.isArray(entries) || entries.length === 0) {
            return { before: '', after: '', system: '', an: '', activated: [] };
        }

        const tokenBudget = opts.tokenBudget || 1500; // approx, characters/4
        const activated = [];

        for (const entry of entries) {
            if (!entry || !entry.enabled) continue;
            // determine scan window
            const depth = entry.scanDepth && entry.scanDepth > 0
                ? entry.scanDepth
                : recentMessages.length;
            const scanText = recentMessages
                .slice(-depth)
                .map(m => (typeof m.content === 'string' ? m.content : ''))
                .join(' ');

            const isMatch = entry.constant || entry.matches(scanText);
            if (!isMatch) continue;

            // probability gate
            if (entry.probability < 100) {
                if (Math.random() * 100 > entry.probability) continue;
            }

            activated.push(entry);
        }

        // sort by priority desc, then order asc
        activated.sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            return (a.order || 0) - (b.order || 0);
        });

        // enforce a soft character budget
        const groups = { before: [], after: [], system: [], an: [] };
        let used = 0;
        const cap = tokenBudget * 4;
        for (const entry of activated) {
            const cost = (entry.content || '').length;
            if (used + cost > cap) continue;
            used += cost;
            const pos = ['before', 'after', 'system', 'an'].includes(entry.position) ? entry.position : 'before';
            groups[pos].push(entry.content);
        }

        return {
            before: groups.before.join('\n\n'),
            after: groups.after.join('\n\n'),
            system: groups.system.join('\n\n'),
            an: groups.an.join('\n\n'),
            activated
        };
    }
}

// =====================================================
// group (multi-character) class
// =====================================================
class Group {
    constructor(data = {}) {
        this.id = data.id || this.generateId();
        this.name = data.name || 'untitled group';
        this.description = data.description || '';
        this.avatarUrl = data.avatarUrl || '';
        this.characterIds = Array.isArray(data.characterIds) ? data.characterIds : [];
        this.settings = Object.assign({
            turnOrder: 'sequential', // 'sequential' | 'roundRobin' | 'random'
            autoAdvance: true,
            responseDelayMs: 0,
            systemPromptTemplate: ''
        }, data.settings || {});
        // per-character overrides: { [characterId]: { temperature, systemPromptOverride } }
        this.characterOverrides = data.characterOverrides || {};
        this.createdAt = data.createdAt || new Date().toISOString();
        this.updatedAt = data.updatedAt || new Date().toISOString();
    }

    generateId() {
        return 'group_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }
}

// =====================================================
// quick reply / quick reply set
// =====================================================
class QuickReply {
    constructor(data = {}) {
        this.id = data.id || ('qr_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6));
        this.label = data.label || '';
        this.text = data.text || '';
        this.sendImmediately = !!data.sendImmediately;
    }
}

class QuickReplySet {
    constructor(data = {}) {
        this.id = data.id || ('qrset_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6));
        this.name = data.name || 'untitled set';
        // scope: 'global' | 'character' | 'group'
        this.scope = data.scope || 'global';
        this.scopeId = data.scopeId || null;
        this.replies = (data.replies || []).map(r => new QuickReply(r));
        this.enabled = data.enabled !== false;
    }
}

// =====================================================
// expression detector
// detects the closest matching expression for a piece of text
// =====================================================
class ExpressionDetector {
    // default keyword maps for common moods
    static DEFAULT_TRIGGERS = {
        happy: ['smile', 'smiled', 'happy', 'laugh', 'giggl', 'grin', 'cheer', 'delight', 'joy'],
        sad: ['sad', 'cry', 'cried', 'tear', 'weep', 'sob', 'sorrow', 'lonely', 'gloom'],
        angry: ['angry', 'furious', 'rage', 'mad', 'growl', 'snarl', 'shout', 'yell', 'glare'],
        surprised: ['surprised', 'shock', 'gasp', 'startle', 'astonish', 'amazed', 'wow'],
        scared: ['afraid', 'scared', 'fear', 'tremble', 'shiver', 'panic', 'terrif'],
        thinking: ['think', 'wonder', 'ponder', 'consider', 'hmm', 'puzzled'],
        embarrassed: ['blush', 'blushed', 'embarrass', 'flustered', 'shy', 'awkward'],
        neutral: []
    };

    static detect(character, text) {
        if (!character || !Array.isArray(character.expressions) || character.expressions.length === 0) {
            return null;
        }
        if (!text) return character.defaultExpression || null;
        const lower = text.toLowerCase();
        let best = null;
        let bestScore = 0;

        for (const exp of character.expressions) {
            const triggers = (exp.triggers && exp.triggers.length > 0)
                ? exp.triggers
                : (ExpressionDetector.DEFAULT_TRIGGERS[exp.name] || []);
            let score = 0;
            for (const t of triggers) {
                if (!t) continue;
                const key = String(t).toLowerCase();
                if (lower.includes(key)) score += 1;
            }
            if (score > bestScore) {
                best = exp.name;
                bestScore = score;
            }
        }

        return best || character.defaultExpression || (character.expressions[0] && character.expressions[0].name) || null;
    }

    // resolves an expression name to a usable avatar url, falling back to default/main
    static getAvatarUrl(character, expressionName) {
        if (!character) return '';
        if (expressionName && Array.isArray(character.expressions)) {
            const found = character.expressions.find(e => e.name === expressionName);
            if (found && found.avatarUrl) return found.avatarUrl;
        }
        if (character.defaultExpression) {
            const def = (character.expressions || []).find(e => e.name === character.defaultExpression);
            if (def && def.avatarUrl) return def.avatarUrl;
        }
        return character.avatarUrl || '';
    }
}

// =====================================================
// api key rotation manager
// =====================================================
class ApiKeyPool {
    constructor() {
        this.keys = [];
        this.currentIndex = 0;
        this.failedKeys = new Map(); // key -> failure count
        this.lastRotation = Date.now();
        this.loadState();
    }

    loadState() {
        try {
            const state = JSON.parse(localStorage.getItem(RP_STORAGE_KEYS.KEY_POOL_STATE) || '{}');
            this.currentIndex = state.currentIndex || 0;
            this.lastRotation = state.lastRotation || Date.now();
            this.failedKeys = new Map(state.failedKeys || []);
        } catch (e) {
            console.warn('[rp] failed to load key pool state:', e);
        }
    }

    saveState() {
        try {
            localStorage.setItem(RP_STORAGE_KEYS.KEY_POOL_STATE, JSON.stringify({
                currentIndex: this.currentIndex,
                lastRotation: this.lastRotation,
                failedKeys: Array.from(this.failedKeys.entries())
            }));
        } catch (e) {
            console.warn('[rp] failed to save key pool state:', e);
        }
    }

    setKeys(keysString) {
        // parse comma-separated keys
        if (!keysString) {
            this.keys = [];
            return;
        }
        this.keys = keysString.split(',').map(k => k.trim()).filter(k => k.length > 0);
        this.currentIndex = Math.min(this.currentIndex, Math.max(0, this.keys.length - 1));
        this.saveState();
    }

    getActiveKey() {
        if (this.keys.length === 0) return null;

        // find first non-failed key starting from current index
        for (let i = 0; i < this.keys.length; i++) {
            const idx = (this.currentIndex + i) % this.keys.length;
            const key = this.keys[idx];
            const failures = this.failedKeys.get(key) || 0;

            // allow key if failures < 3 or if it's been more than 5 minutes since last try
            if (failures < 3) {
                this.currentIndex = idx;
                return key;
            }
        }

        // all keys failed, reset and try first one
        this.failedKeys.clear();
        this.currentIndex = 0;
        this.saveState();
        return this.keys[0];
    }

    markKeyFailed(key, error) {
        const failures = (this.failedKeys.get(key) || 0) + 1;
        this.failedKeys.set(key, failures);
        console.warn(`[rp] api key failed (${failures} failures):`, error?.message || 'unknown error');

        // rotate to next key
        if (this.keys.length > 1) {
            this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        }

        this.saveState();
    }

    markKeySuccess(key) {
        this.failedKeys.delete(key);
        this.saveState();
    }

    rotate() {
        if (this.keys.length > 1) {
            this.currentIndex = (this.currentIndex + 1) % this.keys.length;
            this.lastRotation = Date.now();
            this.saveState();
        }
    }
}

// =====================================================
// nocobase sync manager for rp data
// =====================================================
class RPNocoBaseSync {
    constructor() {
        this.collectionName = 'rp_data';
        this.syncQueue = [];
        this.isSyncing = false;
        this.lastSyncTime = 0;
        this.syncDebounceMs = 1000;
        this.pendingSyncTimeouts = new Map(); // per-record timeouts keyed by composite key
        this.pendingPayloads = new Map(); // per-record payloads
        this.pendingResolvers = new Map(); // per-record promise resolvers
    }

    // get nocobase config from main app (reuse existing config)
    getConfig() {
        // use the main app's nocobase config
        const url = localStorage.getItem('llms_nocobase_url') || 'https://db.houseofmates.space';
        const apiKey = localStorage.getItem('llms_nocobase_key') || '';
        return { url: url.replace(/\/+$/, ''), apiKey };
    }

    isConfigured() {
        const { url, apiKey } = this.getConfig();
        return !!(url && apiKey);
    }

    async ensureCollection() {
        const { url, apiKey } = this.getConfig();
        if (!url || !apiKey) return false;

        try {
            // check if collection exists
            const check = await fetch(`${url}/api/collections/${this.collectionName}`, {
                headers: { Authorization: `Bearer ${apiKey}` }
            });
            if (check.ok) {
                console.log('[rp] nocobase collection exists');
                return true;
            }
        } catch (e) {
            console.log('[rp] collection check failed, will try to create');
        }

        // create collection with fields for rp data
        try {
            console.log('[rp] creating nocobase collection...');
            const createRes = await fetch(`${url}/api/collections`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: this.collectionName,
                    title: 'RP Data',
                    fields: [
                        { name: 'dataId', type: 'string', unique: true, required: true },
                        { name: 'dataType', type: 'string', required: true }, // 'character', 'persona', 'chat', 'lorebook', 'settings'
                        { name: 'data', type: 'text', required: true } // json stringified data
                    ]
                })
            });

            if (createRes.ok || createRes.status === 409) {
                console.log('[rp] nocobase collection ready');
                return true;
            } else {
                const err = await createRes.text();
                console.error('[rp] failed to create collection:', err);
                return false;
            }
        } catch (e) {
            console.error('[rp] failed to create nocobase collection', e);
            return false;
        }
    }

    async loadAll(dataType) {
        const { url, apiKey } = this.getConfig();
        if (!url || !apiKey) return [];

        try {
            await this.ensureCollection();
            const res = await fetch(
                `${url}/api/${this.collectionName}:list?filter[dataType]=${dataType}&pageSize=500`,
                { headers: { Authorization: `Bearer ${apiKey}` } }
            );

            if (!res.ok) {
                console.warn('[rp] failed to load from nocobase:', res.status);
                return [];
            }

            const result = await res.json();
            const records = result.data || [];
            console.log(`[rp] loaded ${records.length} ${dataType} records from nocobase`);

            return records.map(r => {
                try {
                    return { id: r.dataId, ...JSON.parse(r.data), _nocobaseId: r.id };
                } catch (e) {
                    console.warn('[rp] failed to parse record:', r.dataId);
                    return null;
                }
            }).filter(Boolean);
        } catch (e) {
            console.error('[rp] nocobase load error:', e);
            return [];
        }
    }

    async saveRecord(dataType, dataId, data) {
        const { url, apiKey } = this.getConfig();
        if (!url || !apiKey) {
            console.log('[rp] nocobase not configured, skipping cloud save');
            return false;
        }

        // use composite key to track per-record debouncing
        const compositeKey = `${dataType}:${dataId}`;

        // clear existing timeout for this specific record
        if (this.pendingSyncTimeouts.has(compositeKey)) {
            clearTimeout(this.pendingSyncTimeouts.get(compositeKey));
        }

        // store the latest payload for this record
        this.pendingPayloads.set(compositeKey, { dataType, dataId, data });

        return new Promise((resolve) => {
            // store resolver for this record
            this.pendingResolvers.set(compositeKey, resolve);

            // set new timeout for this specific record
            const timeout = setTimeout(async () => {
                try {
                    await this.ensureCollection();

                    // get the latest payload for this record
                    const payload = this.pendingPayloads.get(compositeKey);
                    if (!payload) {
                        resolve(false);
                        return;
                    }

                    // check if record exists using composite key (both dataType and dataId)
                    const checkRes = await fetch(
                        `${url}/api/${this.collectionName}:list?filter[dataType]=${encodeURIComponent(payload.dataType)}&filter[dataId]=${encodeURIComponent(payload.dataId)}`,
                        { headers: { Authorization: `Bearer ${apiKey}` } }
                    );
                    const checkData = await checkRes.json();
                    const existing = (checkData.data || []).find(r => r.dataId === payload.dataId && r.dataType === payload.dataType);

                    const requestPayload = {
                        dataId: payload.dataId,
                        dataType: payload.dataType,
                        data: JSON.stringify(payload.data)
                    };

                    if (existing) {
                        // update
                        await fetch(`${url}/api/${this.collectionName}:update?filterByTk=${existing.id}`, {
                            method: 'POST',
                            headers: {
                                Authorization: `Bearer ${apiKey}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(requestPayload)
                        });
                    } else {
                        // create
                        await fetch(`${url}/api/${this.collectionName}:create`, {
                            method: 'POST',
                            headers: {
                                Authorization: `Bearer ${apiKey}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(requestPayload)
                        });
                    }

                    console.log(`[rp] saved ${payload.dataType}/${payload.dataId} to nocobase`);

                    // resolve the specific resolver for this record
                    const resolver = this.pendingResolvers.get(compositeKey);
                    if (resolver) resolver(true);

                    // clean up
                    this.pendingSyncTimeouts.delete(compositeKey);
                    this.pendingPayloads.delete(compositeKey);
                    this.pendingResolvers.delete(compositeKey);
                } catch (e) {
                    console.error('[rp] nocobase save error:', e);

                    // resolve with false on error
                    const resolver = this.pendingResolvers.get(compositeKey);
                    if (resolver) resolver(false);

                    // clean up
                    this.pendingSyncTimeouts.delete(compositeKey);
                    this.pendingPayloads.delete(compositeKey);
                    this.pendingResolvers.delete(compositeKey);
                }
            }, this.syncDebounceMs);

            this.pendingSyncTimeouts.set(compositeKey, timeout);
        });
    }

    async deleteRecord(dataId, dataType = null) {
        const { url, apiKey } = this.getConfig();
        if (!url || !apiKey) return false;

        try {
            // find record - if dataType not provided, find by dataId only (for backwards compat)
            let checkUrl = `${url}/api/${this.collectionName}:list?filter[dataId]=${encodeURIComponent(dataId)}`;
            if (dataType) {
                checkUrl += `&filter[dataType]=${encodeURIComponent(dataType)}`;
            }
            const checkRes = await fetch(checkUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
            const checkData = await checkRes.json();
            const existing = dataType
                ? (checkData.data || []).find(r => r.dataId === dataId && r.dataType === dataType)
                : (checkData.data || []).find(r => r.dataId === dataId);

            if (existing) {
                await fetch(`${url}/api/${this.collectionName}:destroy?filterByTk=${existing.id}`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${apiKey}` }
                });
                console.log(`[rp] deleted ${dataId} from nocobase`);
            }
            return true;
        } catch (e) {
            console.error('[rp] nocobase delete error:', e);
            return false;
        }
    }
}

// =====================================================
// rp storage manager (with nocobase sync)
// =====================================================
class RPStorage {
    constructor() {
        this.characters = new Map();
        this.personas = new Map();
        this.chats = new Map();
        this.lorebooks = new Map();
        this.settings = {};
        this.groups = new Map();
        this.groupChats = new Map();
        this.quickReplySets = new Map();
        this.extensionsState = {}; // { extensionId: { enabled, settings } }
        this.nocobase = new RPNocoBaseSync();
        this.isLoaded = false;
        this.loadAll();
    }

    async loadAll() {
        // load from localStorage first (fast)
        this.loadCharactersLocal();
        this.loadPersonasLocal();
        this.loadChatsLocal();
        this.loadLorebooksLocal();
        this.loadSettingsLocal();
        this.loadGroupsLocal();
        this.loadGroupChatsLocal();
        this.loadQuickReplySetsLocal();
        this.loadExtensionsLocal();

        // run any pending data migrations
        try {
            this.runMigrations();
        } catch (e) {
            console.warn('[rp] migration failed:', e);
        }

        // then try to sync from nocobase (if configured)
        if (this.nocobase.isConfigured()) {
            await this.syncFromNocoBase();
        }

        this.isLoaded = true;
    }

    // ---- migrations ----
    // ensures any older data on disk gets the new fields with safe defaults.
    runMigrations() {
        let currentVersion = 0;
        try {
            currentVersion = parseInt(localStorage.getItem(RP_STORAGE_KEYS.MIGRATION_VERSION) || '0', 10) || 0;
        } catch (e) {
            currentVersion = 0;
        }
        if (currentVersion >= RP_MIGRATION_VERSION) return;

        // back up any existing rp data before migrating
        try {
            const backupKey = 'llms_rp_backup_v' + currentVersion + '_' + Date.now();
            const backup = {};
            for (const k of Object.values(RP_STORAGE_KEYS)) {
                const v = localStorage.getItem(k);
                if (v !== null) backup[k] = v;
            }
            // only write a backup if we actually have data
            if (Object.keys(backup).length > 0) {
                try {
                    localStorage.setItem(backupKey, JSON.stringify(backup));
                } catch (e) {
                    // backup may exceed quota - safe to skip
                }
            }
        } catch (e) {
            // non-fatal
        }

        // v1: ensure characters have expressions/defaultExpression
        // v2: ensure messages have variants array + activeVariantIndex; ensure groups/quickReplySets exist
        for (const [id, char] of this.characters) {
            if (!Array.isArray(char.expressions)) char.expressions = [];
            if (!char.defaultExpression) char.defaultExpression = 'neutral';
            if (!Array.isArray(char.embeddedLorebook)) char.embeddedLorebook = [];
        }
        this.saveCharactersLocal();

        for (const [cid, chat] of this.chats) {
            if (!chat || !Array.isArray(chat.messages)) continue;
            for (const msg of chat.messages) {
                if (!Array.isArray(msg.variants)) msg.variants = [];
                if (typeof msg.activeVariantIndex !== 'number') msg.activeVariantIndex = -1;
            }
        }
        this.saveChatsLocal();

        try {
            localStorage.setItem(RP_STORAGE_KEYS.MIGRATION_VERSION, String(RP_MIGRATION_VERSION));
        } catch (e) {
            // non-fatal
        }
        console.log('[rp] migrations applied through version', RP_MIGRATION_VERSION);
    }

    async syncFromNocoBase() {
        try {
            console.log('[rp] syncing from nocobase...');

            // load characters
            const characters = await this.nocobase.loadAll('character');
            if (characters.length > 0) {
                characters.forEach(c => {
                    this.characters.set(c.id, new CharacterCard(c));
                });
                this.saveCharactersLocal(); // cache locally
                console.log(`[rp] synced ${characters.length} characters from cloud`);
            }

            // load personas
            const personas = await this.nocobase.loadAll('persona');
            if (personas.length > 0) {
                personas.forEach(p => {
                    this.personas.set(p.id, new Persona(p));
                });
                this.savePersonasLocal();
                console.log(`[rp] synced ${personas.length} personas from cloud`);
            }

            // load chats
            const chats = await this.nocobase.loadAll('chat');
            if (chats.length > 0) {
                chats.forEach(c => {
                    this.chats.set(c.id, c);
                });
                this.saveChatsLocal();
                console.log(`[rp] synced ${chats.length} chats from cloud`);
            }

            // load lorebooks
            const lorebooks = await this.nocobase.loadAll('lorebook');
            if (lorebooks.length > 0) {
                lorebooks.forEach(l => {
                    this.lorebooks.set(l.id, l.entries.map(e => new LorebookEntry(e)));
                });
                this.saveLorebooksLocal();
            }

            // load settings
            const settings = await this.nocobase.loadAll('settings');
            if (settings.length > 0) {
                this.settings = settings[0] || {};
                this.saveSettingsLocal();
            }

            if (typeof showToast === 'function' && (characters.length > 0 || personas.length > 0)) {
                showToast(`synced ${characters.length} characters from cloud`);
            }
        } catch (e) {
            console.error('[rp] nocobase sync error:', e);
        }
    }

    // ---- local storage methods (fast cache) ----

    loadCharactersLocal() {
        try {
            const data = JSON.parse(localStorage.getItem(RP_STORAGE_KEYS.CHARACTERS) || '[]');
            this.characters = new Map(data.map(c => [c.id, new CharacterCard(c)]));
        } catch (e) {
            console.warn('[rp] failed to load characters locally:', e);
            this.characters = new Map();
        }
    }

    saveCharactersLocal() {
        try {
            const data = Array.from(this.characters.values());
            localStorage.setItem(RP_STORAGE_KEYS.CHARACTERS, JSON.stringify(data));
        } catch (e) {
            console.error('[rp] failed to save characters locally:', e);
        }
    }

    loadPersonasLocal() {
        try {
            const data = JSON.parse(localStorage.getItem(RP_STORAGE_KEYS.PERSONAS) || '[]');
            this.personas = new Map(data.map(p => [p.id, new Persona(p)]));

            // create default persona if none exist
            if (this.personas.size === 0) {
                const defaultPersona = new Persona({ name: 'you', isDefault: true });
                this.personas.set(defaultPersona.id, defaultPersona);
                this.savePersonasLocal();
            }
        } catch (e) {
            console.warn('[rp] failed to load personas locally:', e);
            this.personas = new Map();
        }
    }

    savePersonasLocal() {
        try {
            const data = Array.from(this.personas.values());
            localStorage.setItem(RP_STORAGE_KEYS.PERSONAS, JSON.stringify(data));
        } catch (e) {
            console.error('[rp] failed to save personas locally:', e);
        }
    }

    loadChatsLocal() {
        try {
            const data = JSON.parse(localStorage.getItem(RP_STORAGE_KEYS.CHATS) || '{}');
            this.chats = new Map(Object.entries(data));
        } catch (e) {
            console.warn('[rp] failed to load chats locally:', e);
            this.chats = new Map();
        }
    }

    saveChatsLocal() {
        try {
            const data = Object.fromEntries(this.chats);
            localStorage.setItem(RP_STORAGE_KEYS.CHATS, JSON.stringify(data));
        } catch (e) {
            console.error('[rp] failed to save chats locally:', e);
        }
    }

    loadLorebooksLocal() {
        try {
            const data = JSON.parse(localStorage.getItem(RP_STORAGE_KEYS.LOREBOOKS) || '{}');
            this.lorebooks = new Map(Object.entries(data).map(([id, entries]) => [
                id,
                entries.map(e => new LorebookEntry(e))
            ]));
        } catch (e) {
            console.warn('[rp] failed to load lorebooks locally:', e);
            this.lorebooks = new Map();
        }
    }

    saveLorebooksLocal() {
        try {
            const data = Object.fromEntries(this.lorebooks);
            localStorage.setItem(RP_STORAGE_KEYS.LOREBOOKS, JSON.stringify(data));
        } catch (e) {
            console.error('[rp] failed to save lorebooks locally:', e);
        }
    }

    loadSettingsLocal() {
        try {
            this.settings = JSON.parse(localStorage.getItem(RP_STORAGE_KEYS.SETTINGS) || '{}');
        } catch (e) {
            this.settings = {};
        }
    }

    saveSettingsLocal() {
        try {
            localStorage.setItem(RP_STORAGE_KEYS.SETTINGS, JSON.stringify(this.settings));
        } catch (e) {
            console.error('[rp] failed to save settings locally:', e);
        }
    }

    loadGroupsLocal() {
        try {
            const data = JSON.parse(localStorage.getItem(RP_STORAGE_KEYS.GROUPS) || '[]');
            this.groups = new Map(data.map(g => [g.id, new Group(g)]));
        } catch (e) {
            console.warn('[rp] failed to load groups locally:', e);
            this.groups = new Map();
        }
    }

    saveGroupsLocal() {
        try {
            const data = Array.from(this.groups.values());
            localStorage.setItem(RP_STORAGE_KEYS.GROUPS, JSON.stringify(data));
        } catch (e) {
            console.error('[rp] failed to save groups locally:', e);
        }
    }

    loadGroupChatsLocal() {
        try {
            const data = JSON.parse(localStorage.getItem(RP_STORAGE_KEYS.GROUP_CHATS) || '{}');
            this.groupChats = new Map(Object.entries(data));
        } catch (e) {
            console.warn('[rp] failed to load group chats locally:', e);
            this.groupChats = new Map();
        }
    }

    saveGroupChatsLocal() {
        try {
            const data = Object.fromEntries(this.groupChats);
            localStorage.setItem(RP_STORAGE_KEYS.GROUP_CHATS, JSON.stringify(data));
        } catch (e) {
            console.error('[rp] failed to save group chats locally:', e);
        }
    }

    loadQuickReplySetsLocal() {
        try {
            const data = JSON.parse(localStorage.getItem(RP_STORAGE_KEYS.QUICK_REPLY_SETS) || '[]');
            this.quickReplySets = new Map(data.map(s => [s.id, new QuickReplySet(s)]));
        } catch (e) {
            console.warn('[rp] failed to load quick reply sets locally:', e);
            this.quickReplySets = new Map();
        }
    }

    saveQuickReplySetsLocal() {
        try {
            const data = Array.from(this.quickReplySets.values());
            localStorage.setItem(RP_STORAGE_KEYS.QUICK_REPLY_SETS, JSON.stringify(data));
        } catch (e) {
            console.error('[rp] failed to save quick reply sets locally:', e);
        }
    }

    loadExtensionsLocal() {
        try {
            this.extensionsState = JSON.parse(localStorage.getItem(RP_STORAGE_KEYS.EXTENSIONS) || '{}');
        } catch (e) {
            this.extensionsState = {};
        }
    }

    saveExtensionsLocal() {
        try {
            localStorage.setItem(RP_STORAGE_KEYS.EXTENSIONS, JSON.stringify(this.extensionsState));
        } catch (e) {
            console.error('[rp] failed to save extensions locally:', e);
        }
    }

    // ---- public api (saves to both local and cloud) ----

    getCharacter(id) {
        return this.characters.get(id);
    }

    getAllCharacters() {
        return Array.from(this.characters.values());
    }

    saveCharacter(character) {
        character.updatedAt = new Date().toISOString();
        this.characters.set(character.id, character);
        this.saveCharactersLocal();

        // sync to nocobase in background
        this.nocobase.saveRecord('character', character.id, character);

        return character;
    }

    deleteCharacter(id) {
        this.characters.delete(id);
        this.saveCharactersLocal();

        // delete from nocobase
        this.nocobase.deleteRecord(id);

        // also delete associated chats
        this.deleteChatsForCharacter(id);
    }

    getPersona(id) {
        return this.personas.get(id);
    }

    getAllPersonas() {
        return Array.from(this.personas.values());
    }

    getActivePersona() {
        try {
            const activeId = localStorage.getItem(RP_STORAGE_KEYS.ACTIVE_PERSONA);
            if (activeId && this.personas.has(activeId)) {
                return this.personas.get(activeId);
            }
            return Array.from(this.personas.values()).find(p => p.isDefault) || Array.from(this.personas.values())[0];
        } catch (e) {
            return Array.from(this.personas.values())[0];
        }
    }

    setActivePersona(id) {
        localStorage.setItem(RP_STORAGE_KEYS.ACTIVE_PERSONA, id);
    }

    savePersona(persona) {
        persona.updatedAt = new Date().toISOString();
        this.personas.set(persona.id, persona);
        this.savePersonasLocal();

        // sync to nocobase
        this.nocobase.saveRecord('persona', persona.id, persona);

        return persona;
    }

    deletePersona(id) {
        const persona = this.personas.get(id);
        if (persona?.isDefault) {
            console.warn('[rp] cannot delete default persona');
            return false;
        }
        this.personas.delete(id);
        this.savePersonasLocal();
        this.nocobase.deleteRecord(id);
        return true;
    }

    // chats
    getChat(characterId) {
        return this.chats.get(characterId) || { messages: [], branches: ['main'] };
    }

    saveChat(characterId, chatData) {
        this.chats.set(characterId, chatData);
        this.saveChatsLocal();
        // sync to nocobase
        this.nocobase.saveRecord('chat', characterId, { id: characterId, ...chatData });
    }

    addMessage(characterId, message) {
        const chat = this.getChat(characterId);
        chat.messages.push(message);

        // limit to 1000 messages
        if (chat.messages.length > 1000) {
            chat.messages = chat.messages.slice(-1000);
        }

        this.saveChat(characterId, chat);
        return message;
    }

    deleteChatsForCharacter(characterId) {
        this.chats.delete(characterId);
        this.saveChatsLocal();
        this.nocobase.deleteRecord(characterId);
    }

    clearChat(characterId) {
        this.chats.set(characterId, { messages: [], branches: ['main'] });
        this.saveChatsLocal();
        this.nocobase.saveRecord('chat', characterId, { id: characterId, messages: [], branches: ['main'] });
    }

    // lorebooks
    getLorebook(id) {
        return this.lorebooks.get(id) || [];
    }

    saveLorebook(id, entries) {
        this.lorebooks.set(id, entries);
        this.saveLorebooksLocal();
        this.nocobase.saveRecord('lorebook', id, { id, entries });
    }

    getMatchingLoreEntries(lorebookId, text) {
        const entries = this.getLorebook(lorebookId);
        return entries.filter(e => e.matches(text)).sort((a, b) => b.priority - a.priority);
    }

    // settings
    getSetting(key, defaultValue = null) {
        return this.settings[key] ?? defaultValue;
    }

    setSetting(key, value) {
        this.settings[key] = value;
        this.saveSettingsLocal();
        this.nocobase.saveRecord('settings', 'rp_settings', this.settings);
    }

    // ---- groups ----
    getAllGroups() {
        return Array.from(this.groups.values());
    }

    getGroup(id) {
        return this.groups.get(id);
    }

    saveGroup(group) {
        group.updatedAt = new Date().toISOString();
        this.groups.set(group.id, group);
        this.saveGroupsLocal();
        this.nocobase.saveRecord('group', group.id, group);
        return group;
    }

    deleteGroup(id) {
        this.groups.delete(id);
        this.saveGroupsLocal();
        this.nocobase.deleteRecord(id, 'group');
        // also delete group's chat history
        this.groupChats.delete(id);
        this.saveGroupChatsLocal();
        this.nocobase.deleteRecord(id, 'groupChat');
    }

    getGroupChat(groupId) {
        return this.groupChats.get(groupId) || { messages: [] };
    }

    saveGroupChat(groupId, chatData) {
        this.groupChats.set(groupId, chatData);
        this.saveGroupChatsLocal();
        this.nocobase.saveRecord('groupChat', groupId, { id: groupId, ...chatData });
    }

    clearGroupChat(groupId) {
        this.groupChats.set(groupId, { messages: [] });
        this.saveGroupChatsLocal();
        this.nocobase.saveRecord('groupChat', groupId, { id: groupId, messages: [] });
    }

    // ---- quick reply sets ----
    getAllQuickReplySets() {
        return Array.from(this.quickReplySets.values());
    }

    getQuickReplySetsForScope(scope, scopeId = null) {
        // returns all global sets plus any matching the scope+id
        return this.getAllQuickReplySets().filter(s => {
            if (!s.enabled) return false;
            if (s.scope === 'global') return true;
            return s.scope === scope && s.scopeId === scopeId;
        });
    }

    saveQuickReplySet(set) {
        if (!(set instanceof QuickReplySet)) set = new QuickReplySet(set);
        this.quickReplySets.set(set.id, set);
        this.saveQuickReplySetsLocal();
        this.nocobase.saveRecord('quickReplySet', set.id, set);
        return set;
    }

    deleteQuickReplySet(id) {
        this.quickReplySets.delete(id);
        this.saveQuickReplySetsLocal();
        this.nocobase.deleteRecord(id, 'quickReplySet');
    }

    // ---- extensions ----
    getExtensionState(id) {
        return this.extensionsState[id] || { enabled: false, settings: {} };
    }

    setExtensionState(id, state) {
        this.extensionsState[id] = Object.assign({}, this.extensionsState[id] || {}, state);
        this.saveExtensionsLocal();
    }

    getAllExtensionStates() {
        return Object.assign({}, this.extensionsState);
    }

    // force sync to cloud
    async forceSync() {
        if (!this.nocobase.isConfigured()) {
            if (typeof showToast === 'function') {
                showToast('nocobase not configured - go to settings to add your api key');
            }
            return false;
        }

        try {
            // push all data to cloud
            for (const [id, char] of this.characters) {
                await this.nocobase.saveRecord('character', id, char);
            }
            for (const [id, persona] of this.personas) {
                await this.nocobase.saveRecord('persona', id, persona);
            }
            for (const [id, chat] of this.chats) {
                await this.nocobase.saveRecord('chat', id, { id, ...chat });
            }

            if (typeof showToast === 'function') {
                showToast('synced all data to cloud');
            }
            return true;
        } catch (e) {
            console.error('[rp] force sync error:', e);
            return false;
        }
    }
}

// =====================================================
// nvidia nim api client
// =====================================================
class NvidiaAPIClient {
    constructor(keyPool) {
        this.keyPool = keyPool;
        this.maxRetries = NVIDIA_NIM_CONFIG.maxRetries;
    }

    async sendMessage(messages, options = {}) {
        const {
            temperature = 0.8,
            maxTokens = 2048,
            stream = true
        } = options;

        let lastError = null;

        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            const apiKey = this.keyPool.getActiveKey();

            if (!apiKey) {
                throw new Error('no api key configured. please add your nvidia nim api key in rp settings.');
            }

            try {
                const response = await this.makeRequest(apiKey, messages, {
                    temperature,
                    maxTokens,
                    stream
                });

                this.keyPool.markKeySuccess(apiKey);
                return response;
            } catch (error) {
                lastError = error;

                // check if it's an auth/rate limit error
                if (error.status === 401 || error.status === 403 || error.status === 429) {
                    this.keyPool.markKeyFailed(apiKey, error);

                    // wait before retry
                    if (attempt < this.maxRetries - 1) {
                        await new Promise(r => setTimeout(r, NVIDIA_NIM_CONFIG.retryDelay * (attempt + 1)));
                    }
                } else {
                    // non-recoverable error
                    throw error;
                }
            }
        }

        throw lastError || new Error('failed to send message after multiple retries');
    }

    async makeRequest(apiKey, messages, options) {
        const { temperature, maxTokens, stream } = options;

        const body = {
            model: NVIDIA_NIM_CONFIG.model,
            messages: messages,
            temperature: temperature,
            max_tokens: maxTokens,
            stream: stream
        };

        const response = await fetch(NVIDIA_NIM_CONFIG.endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const error = new Error(`api error: ${response.status}`);
            error.status = response.status;
            try {
                const errorBody = await response.text();
                error.message = `api error: ${response.status} - ${errorBody.substring(0, 200)}`;
            } catch (e) {
                // ignore
            }
            throw error;
        }

        if (stream) {
            return response; // return raw response for streaming
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
    }

    async *streamMessage(messages, options = {}) {
        const response = await this.sendMessage(messages, { ...options, stream: true });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;

                const data = trimmed.slice(6);
                if (data === '[DONE]') continue;

                try {
                    const parsed = JSON.parse(data);
                    const content = parsed.choices?.[0]?.delta?.content;
                    if (content) {
                        yield content;
                    }
                } catch (e) {
                    // skip malformed data
                }
            }
        }
    }
}

// =====================================================
// rp module main class
// =====================================================
class RPModule {
    constructor() {
        this.storage = new RPStorage();
        this.keyPool = new ApiKeyPool();
        this.apiClient = new NvidiaAPIClient(this.keyPool);
        this.currentCharacter = null;
        this.currentPersona = null;
        this.isActive = false;
        this.chatHistory = [];
        this.streamController = null;

        // load api keys from storage
        this.loadApiKeys();
    }

    loadApiKeys() {
        try {
            const keys = JSON.parse(localStorage.getItem(RP_STORAGE_KEYS.API_KEYS) || '{}');
            if (keys.nvidia) {
                this.keyPool.setKeys(keys.nvidia);
            }
        } catch (e) {
            console.warn('[rp] failed to load api keys:', e);
        }
    }

    saveApiKeys(keys) {
        try {
            localStorage.setItem(RP_STORAGE_KEYS.API_KEYS, JSON.stringify(keys));
            if (keys.nvidia) {
                this.keyPool.setKeys(keys.nvidia);
            }
        } catch (e) {
            console.error('[rp] failed to save api keys:', e);
        }
    }

    getApiKeys() {
        try {
            return JSON.parse(localStorage.getItem(RP_STORAGE_KEYS.API_KEYS) || '{}');
        } catch (e) {
            return {};
        }
    }

    // character management
    createCharacter(data) {
        const character = new CharacterCard(data);
        return this.storage.saveCharacter(character);
    }

    updateCharacter(id, data) {
        const character = this.storage.getCharacter(id);
        if (!character) return null;

        Object.assign(character, data);
        return this.storage.saveCharacter(character);
    }

    deleteCharacter(id) {
        this.storage.deleteCharacter(id);
        if (this.currentCharacter?.id === id) {
            this.currentCharacter = null;
        }
    }

    // persona management
    createPersona(data) {
        const persona = new Persona(data);
        return this.storage.savePersona(persona);
    }

    updatePersona(id, data) {
        const persona = this.storage.getPersona(id);
        if (!persona) return null;

        Object.assign(persona, data);
        return this.storage.savePersona(persona);
    }

    deletePersona(id) {
        return this.storage.deletePersona(id);
    }

    // chat management
    selectCharacter(characterId) {
        const character = this.storage.getCharacter(characterId);
        if (!character) return null;

        this.currentCharacter = character;
        this.currentPersona = this.storage.getActivePersona();

        // load chat history
        const chat = this.storage.getChat(characterId);
        this.chatHistory = chat.messages.map(m => new ChatMessage(m));

        return character;
    }

    // builds the context messages for a given character + history.
    // when speakerCharacter is provided (group chat) it is used in place of currentCharacter.
    // when speakerOverride is provided (group chat) it may carry per-character overrides.
    getContextMessages(opts = {}) {
        const character = opts.character || this.currentCharacter;
        if (!character) return [];

        const persona = opts.persona || this.currentPersona;
        const history = Array.isArray(opts.history) ? opts.history : this.chatHistory;
        const limit = typeof opts.historyLimit === 'number' ? opts.historyLimit : 20;
        const groupSystemPrompt = opts.groupSystemPrompt || '';
        const groupRoster = Array.isArray(opts.groupRoster) ? opts.groupRoster : null;
        const speakerOverride = opts.speakerOverride || null;

        // build system prompt
        let systemPrompt = (speakerOverride && speakerOverride.systemPromptOverride)
            ? speakerOverride.systemPromptOverride
            : (character.systemPrompt || '');

        if (groupSystemPrompt) {
            systemPrompt = groupSystemPrompt + '\n\n' + systemPrompt;
        }

        if (groupRoster && groupRoster.length > 1) {
            const others = groupRoster
                .filter(c => c.id !== character.id)
                .map(c => `- ${c.name}${c.description ? ': ' + c.description.split('\n')[0] : ''}`)
                .join('\n');
            systemPrompt += `\n\n[group roleplay]\nyou are ${character.name}. only respond as ${character.name}.\nother participants:\n${others}`;
        }

        if (character.description) {
            systemPrompt += `\n\n[character description]\n${character.description}`;
        }
        if (character.personality) {
            systemPrompt += `\n\n[character personality]\n${character.personality}`;
        }
        if (character.scenario) {
            systemPrompt += `\n\n[scenario]\n${character.scenario}`;
        }
        if (persona?.description) {
            systemPrompt += `\n\n[user persona]\nthe user is ${persona.name}. ${persona.description}`;
        }
        if (character.mesExample) {
            systemPrompt += `\n\n[example dialogue]\n${character.mesExample}`;
        }

        // collect lorebook entries from multiple sources:
        // 1) per-character embedded lorebook
        // 2) shared lorebook referenced by character.lorebookId
        const lorebookEntries = [];
        if (Array.isArray(character.embeddedLorebook) && character.embeddedLorebook.length > 0) {
            for (const e of character.embeddedLorebook) {
                lorebookEntries.push(e instanceof LorebookEntry ? e : new LorebookEntry(e));
            }
        }
        if (character.lorebookId) {
            const shared = this.storage.getLorebook(character.lorebookId) || [];
            for (const e of shared) {
                lorebookEntries.push(e instanceof LorebookEntry ? e : new LorebookEntry(e));
            }
        }

        let authorsNote = '';
        if (lorebookEntries.length > 0) {
            const recentMsgs = history.slice(-Math.max(5, opts.loreScanWindow || 8))
                .map(m => ({ role: m.role, content: (m.getActiveContent ? m.getActiveContent() : m.content) || '' }));
            const result = LorebookActivationEngine.activate(lorebookEntries, recentMsgs, { tokenBudget: 1500 });
            if (result.before) systemPrompt = result.before + '\n\n' + systemPrompt;
            if (result.after) systemPrompt += '\n\n[world info]\n' + result.after;
            if (result.system) systemPrompt += '\n\n' + result.system;
            if (result.an) authorsNote = result.an;
        }

        if (character.postHistoryInstructions) {
            systemPrompt += `\n\n[instructions]\n${character.postHistoryInstructions}`;
        }

        const messages = [
            { role: 'system', content: systemPrompt.trim() }
        ];

        // include chat history within limit
        const recent = limit > 0 ? history.slice(-limit) : history.slice();
        for (const msg of recent) {
            const role = msg.role === 'assistant' ? 'assistant' : (msg.role === 'system' ? 'system' : 'user');
            const content = typeof msg.getActiveContent === 'function' ? msg.getActiveContent() : msg.content;

            // for group chats, prefix assistant messages with the speaker's name
            // so models can keep track of who said what
            let prefixedContent = content;
            if (groupRoster && groupRoster.length > 1 && role === 'assistant' && msg.speakerCharacterId) {
                const speaker = groupRoster.find(c => c.id === msg.speakerCharacterId);
                if (speaker && !content.startsWith(speaker.name + ':')) {
                    prefixedContent = `${speaker.name}: ${content}`;
                }
            }

            if (msg.images && msg.images.length > 0) {
                const c = [{ type: 'text', text: prefixedContent }];
                for (const img of msg.images) {
                    c.push({ type: 'image_url', image_url: { url: img } });
                }
                messages.push({ role, content: c });
            } else {
                messages.push({ role, content: prefixedContent });
            }
        }

        // author's note goes after the recent messages as a system nudge
        if (authorsNote) {
            messages.push({ role: 'system', content: '[author\'s note]\n' + authorsNote });
        }

        return messages;
    }

    async sendMessage(text, images = []) {
        if (!this.currentCharacter) {
            throw new Error('no character selected');
        }

        const keys = this.getApiKeys();
        if (!keys.nvidia) {
            throw new Error('nvidia nim api key not configured. go to rp settings to add your key.');
        }

        // allow extensions to mutate the outgoing user message
        let payload = { text, images };
        if (window.rpExtensions && typeof window.rpExtensions.emit === 'function') {
            payload = window.rpExtensions.emit('chat:beforeSend', payload) || payload;
        }

        // create user message
        const userMessage = new ChatMessage({
            role: 'user',
            content: payload.text,
            images: payload.images || [],
            characterId: this.currentCharacter.id,
            personaId: this.currentPersona?.id
        });

        this.chatHistory.push(userMessage);
        this.storage.addMessage(this.currentCharacter.id, userMessage);

        // get context and send to api
        const contextMessages = this.getContextMessages();

        return {
            userMessage,
            stream: this.apiClient.streamMessage(contextMessages, {
                temperature: this.storage.getSetting('temperature', 0.8),
                maxTokens: this.storage.getSetting('maxTokens', 2048)
            })
        };
    }

    saveAssistantMessage(content) {
        if (!this.currentCharacter) return null;

        // detect expression from content for the active character
        let expression = null;
        try {
            expression = ExpressionDetector.detect(this.currentCharacter, content);
        } catch (e) {
            // non-fatal
        }

        const assistantMessage = new ChatMessage({
            role: 'assistant',
            content: content,
            characterId: this.currentCharacter.id,
            personaId: this.currentPersona?.id,
            expression
        });

        // allow extensions to react/mutate
        if (window.rpExtensions && typeof window.rpExtensions.emit === 'function') {
            const mutated = window.rpExtensions.emit('chat:afterReceive', { message: assistantMessage });
            if (mutated && mutated.message) {
                Object.assign(assistantMessage, mutated.message);
            }
        }

        this.chatHistory.push(assistantMessage);
        this.storage.addMessage(this.currentCharacter.id, assistantMessage);

        return assistantMessage;
    }

    // ---- swipes (alternate variants) ----
    // generate a new variant for the assistant message at messageIndex.
    // returns a stream + the target message reference. caller is responsible
    // for collecting the streamed text and calling commitSwipe with the result.
    async generateSwipe(messageIndex) {
        if (!this.currentCharacter) throw new Error('no character selected');
        const msg = this.chatHistory[messageIndex];
        if (!msg || msg.role !== 'assistant') {
            throw new Error('can only swipe assistant messages');
        }

        // build context from history up to (but not including) the target message
        const historyBefore = this.chatHistory.slice(0, messageIndex);
        const contextMessages = this.getContextMessages({ history: historyBefore });

        const temperature = this.storage.getSetting('temperature', 0.8);
        const maxTokens = this.storage.getSetting('maxTokens', 2048);

        return {
            message: msg,
            messageIndex,
            stream: this.apiClient.streamMessage(contextMessages, { temperature, maxTokens }),
            temperature
        };
    }

    // store the new variant on the message and make it active
    commitSwipe(messageIndex, content, meta = {}) {
        const msg = this.chatHistory[messageIndex];
        if (!msg) return null;
        msg.variants.push({
            content,
            generatedAt: new Date().toISOString(),
            model: NVIDIA_NIM_CONFIG.model,
            temperature: meta.temperature
        });
        msg.activeVariantIndex = msg.variants.length - 1;
        // re-detect expression for the active variant
        try {
            msg.expression = ExpressionDetector.detect(this.currentCharacter, content) || msg.expression;
        } catch (e) {}
        this.persistCurrentChat();
        return msg;
    }

    setActiveVariant(messageIndex, variantIndex) {
        const msg = this.chatHistory[messageIndex];
        if (!msg) return null;
        if (variantIndex < -1 || variantIndex >= msg.variants.length) return null;
        msg.activeVariantIndex = variantIndex;
        const active = msg.getActiveContent();
        try {
            msg.expression = ExpressionDetector.detect(this.currentCharacter, active) || msg.expression;
        } catch (e) {}
        this.persistCurrentChat();
        return msg;
    }

    // ---- continue generation ----
    // continues the assistant message at messageIndex by appending more text.
    async generateContinuation(messageIndex) {
        if (!this.currentCharacter) throw new Error('no character selected');
        const msg = this.chatHistory[messageIndex];
        if (!msg || msg.role !== 'assistant') {
            throw new Error('can only continue assistant messages');
        }

        // include the partial assistant message at the end so the model continues from there
        const historyUpToAndIncluding = this.chatHistory.slice(0, messageIndex + 1);
        const contextMessages = this.getContextMessages({ history: historyUpToAndIncluding });

        // append a brief nudge instructing the model to continue without a preamble
        contextMessages.push({
            role: 'system',
            content: 'continue the previous message naturally without restating it. do not add a preamble or quote it; just continue from where it ended.'
        });

        const temperature = Math.min(0.8, this.storage.getSetting('temperature', 0.8));
        const maxTokens = this.storage.getSetting('maxTokens', 2048);
        return {
            message: msg,
            messageIndex,
            stream: this.apiClient.streamMessage(contextMessages, { temperature, maxTokens })
        };
    }

    commitContinuation(messageIndex, additionalContent) {
        const msg = this.chatHistory[messageIndex];
        if (!msg) return null;
        // separate with a space if the existing content doesn't end with whitespace
        const joiner = /\s$/.test(msg.getActiveContent()) ? '' : ' ';
        if (msg.activeVariantIndex >= 0 && msg.variants[msg.activeVariantIndex]) {
            msg.variants[msg.activeVariantIndex].content += joiner + additionalContent;
        } else {
            msg.content += joiner + additionalContent;
        }
        msg.isEdited = true;
        this.persistCurrentChat();
        return msg;
    }

    // ---- summarization ----
    // generates a summary text for the given messages.
    async summarizeMessages(messages) {
        const keys = this.getApiKeys();
        if (!keys.nvidia) {
            throw new Error('nvidia nim api key not configured.');
        }

        const charName = this.currentCharacter?.name || 'character';
        const personaName = this.currentPersona?.name || 'user';

        const historyText = messages
            .map(m => {
                const speaker = m.role === 'assistant' ? charName : personaName;
                const text = typeof m.getActiveContent === 'function' ? m.getActiveContent() : m.content;
                return `${speaker}: ${text}`;
            })
            .join('\n');

        const prompt = [
            { role: 'system', content: 'you are a helpful assistant that summarizes roleplay conversations.' },
            { role: 'user', content:
                `below is the chat history between ${personaName} and ${charName}.\n` +
                'produce a concise summary (max 200 tokens) that captures the key events, emotional state, relationships, and any unresolved plot points.\n' +
                'write in third person present tense.\n\n' +
                'chat history:\n' + historyText + '\n\nsummary:' }
        ];

        // non-streaming for summary
        const result = await this.apiClient.sendMessage(prompt, {
            temperature: 0.5,
            maxTokens: 400,
            stream: false
        });
        return (result || '').toString().trim();
    }

    // replace the first n messages with a single system "recap" message
    applySummaryReplace(summaryText, replaceCount) {
        if (!this.currentCharacter) return;
        const recap = new ChatMessage({
            role: 'system',
            content: '[recap]\n' + summaryText,
            characterId: this.currentCharacter.id,
            isSummary: true
        });
        this.chatHistory.splice(0, Math.max(1, replaceCount), recap);
        this.persistCurrentChat();
    }

    // append summary as its own system message without removing history
    applySummaryAppend(summaryText) {
        if (!this.currentCharacter) return;
        const recap = new ChatMessage({
            role: 'system',
            content: '[recap]\n' + summaryText,
            characterId: this.currentCharacter.id,
            isSummary: true
        });
        this.chatHistory.push(recap);
        this.storage.addMessage(this.currentCharacter.id, recap);
    }

    // rough token estimate (chars/4) for the active chat
    estimateChatTokens() {
        let chars = 0;
        for (const m of this.chatHistory) {
            chars += (typeof m.getActiveContent === 'function' ? m.getActiveContent() : (m.content || '')).length;
        }
        return Math.ceil(chars / 4);
    }

    // persist the active chat after any in-place mutation
    persistCurrentChat() {
        if (!this.currentCharacter) return;
        this.storage.saveChat(this.currentCharacter.id, {
            messages: this.chatHistory,
            branches: ['main']
        });
    }

    // ---- group chats ----
    createGroup(data) {
        const group = new Group(data);
        return this.storage.saveGroup(group);
    }

    updateGroup(id, patch) {
        const group = this.storage.getGroup(id);
        if (!group) return null;
        Object.assign(group, patch);
        return this.storage.saveGroup(group);
    }

    deleteGroup(id) {
        this.storage.deleteGroup(id);
        if (this.currentGroup?.id === id) {
            this.currentGroup = null;
            this.groupChatHistory = [];
        }
    }

    selectGroup(groupId) {
        const group = this.storage.getGroup(groupId);
        if (!group) return null;
        this.currentGroup = group;
        this.currentCharacter = null; // mutually exclusive view
        this.currentPersona = this.storage.getActivePersona();
        const chat = this.storage.getGroupChat(groupId);
        this.groupChatHistory = (chat.messages || []).map(m => new ChatMessage(m));
        return group;
    }

    persistCurrentGroupChat() {
        if (!this.currentGroup) return;
        this.storage.saveGroupChat(this.currentGroup.id, {
            messages: this.groupChatHistory
        });
    }

    // returns the list of characters in the group (resolved + ordered)
    getGroupRoster(group = this.currentGroup) {
        if (!group) return [];
        const roster = [];
        for (const id of group.characterIds) {
            const c = this.storage.getCharacter(id);
            if (c) roster.push(c);
        }
        return roster;
    }

    // determines the next speaker(s) for a group turn.
    decideGroupSpeakers(group, lastSpeakerId = null) {
        const roster = this.getGroupRoster(group);
        if (roster.length === 0) return [];
        const order = group.settings?.turnOrder || 'sequential';
        if (order === 'random') {
            const idx = Math.floor(Math.random() * roster.length);
            return [roster[idx]];
        }
        if (order === 'roundRobin' && lastSpeakerId) {
            const lastIdx = roster.findIndex(c => c.id === lastSpeakerId);
            const next = roster[(lastIdx + 1) % roster.length];
            return [next];
        }
        // sequential: return all in order (auto-advance mode will iterate)
        return roster;
    }

    // sends a user message into a group and returns one stream per character.
    // caller drives the streams sequentially and calls commitGroupAssistantMessage for each.
    async sendGroupMessage(text, images = []) {
        if (!this.currentGroup) throw new Error('no group selected');
        const keys = this.getApiKeys();
        if (!keys.nvidia) {
            throw new Error('nvidia nim api key not configured. go to rp settings to add your key.');
        }

        let payload = { text, images };
        if (window.rpExtensions && typeof window.rpExtensions.emit === 'function') {
            payload = window.rpExtensions.emit('chat:beforeSend', payload) || payload;
        }

        const userMessage = new ChatMessage({
            role: 'user',
            content: payload.text,
            images: payload.images || [],
            personaId: this.currentPersona?.id
        });
        this.groupChatHistory.push(userMessage);
        this.persistCurrentGroupChat();
        return { userMessage };
    }

    // generates one assistant response for the given speaker character within the group.
    async generateGroupTurn(character) {
        if (!this.currentGroup || !character) throw new Error('invalid group turn');
        const roster = this.getGroupRoster(this.currentGroup);
        const speakerOverride = this.currentGroup.characterOverrides?.[character.id] || null;
        const groupSystemPrompt = this.currentGroup.settings?.systemPromptTemplate || '';

        const contextMessages = this.getContextMessages({
            character,
            persona: this.currentPersona,
            history: this.groupChatHistory,
            groupSystemPrompt,
            groupRoster: roster,
            speakerOverride
        });

        const temperature = speakerOverride?.temperature ?? this.storage.getSetting('temperature', 0.8);
        const maxTokens = this.storage.getSetting('maxTokens', 2048);
        return {
            character,
            stream: this.apiClient.streamMessage(contextMessages, { temperature, maxTokens })
        };
    }

    commitGroupAssistantMessage(character, content) {
        let expression = null;
        try { expression = ExpressionDetector.detect(character, content); } catch (e) {}

        const msg = new ChatMessage({
            role: 'assistant',
            content,
            characterId: character.id,
            speakerCharacterId: character.id,
            personaId: this.currentPersona?.id,
            expression
        });

        if (window.rpExtensions && typeof window.rpExtensions.emit === 'function') {
            window.rpExtensions.emit('chat:afterReceive', { message: msg });
        }

        this.groupChatHistory.push(msg);
        this.persistCurrentGroupChat();
        return msg;
    }

    clearGroupChat() {
        if (!this.currentGroup) return;
        this.groupChatHistory = [];
        this.storage.clearGroupChat(this.currentGroup.id);
    }

    clearChat() {
        if (!this.currentCharacter) return;
        this.chatHistory = [];
        this.storage.clearChat(this.currentCharacter.id);
    }

    // character import/export
    async importCharacterFromPng(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    const uint8Array = new Uint8Array(arrayBuffer);

                    // extract png text chunks
                    const characterData = this.extractPngTextChunk(uint8Array);

                    if (!characterData) {
                        reject(new Error('no character data found in png'));
                        return;
                    }

                    // decode base64 json
                    let jsonData;
                    try {
                        const decoded = atob(characterData);
                        jsonData = JSON.parse(decoded);
                    } catch {
                        // might be plain json
                        jsonData = JSON.parse(characterData);
                    }

                    // create character from data
                    let character;
                    if (jsonData.spec === 'chara_card_v3') {
                        character = new CharacterCard(jsonData.data);
                    } else {
                        character = CharacterCard.fromV2Format(jsonData);
                    }

                    // extract avatar from png
                    const avatarUrl = await this.fileToDataUrl(file);
                    character.avatarUrl = avatarUrl;

                    // save character
                    this.storage.saveCharacter(character);

                    resolve(character);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = () => reject(new Error('failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }

    extractPngTextChunk(uint8Array) {
        // png signature check
        const signature = [137, 80, 78, 71, 13, 10, 26, 10];
        for (let i = 0; i < 8; i++) {
            if (uint8Array[i] !== signature[i]) {
                throw new Error('invalid png file');
            }
        }

        let offset = 8;
        while (offset < uint8Array.length) {
            const length = (uint8Array[offset] << 24) | (uint8Array[offset + 1] << 16) |
                          (uint8Array[offset + 2] << 8) | uint8Array[offset + 3];
            const type = String.fromCharCode(uint8Array[offset + 4], uint8Array[offset + 5],
                                            uint8Array[offset + 6], uint8Array[offset + 7]);

            if (type === 'tEXt' || type === 'iTXt') {
                const dataStart = offset + 8;
                const data = uint8Array.slice(dataStart, dataStart + length);

                // find null separator
                let nullIndex = Array.from(data).indexOf(0);
                if (nullIndex > 0) {
                    const keyword = String.fromCharCode(...data.slice(0, nullIndex));

                    if (keyword === 'chara' || keyword === 'ccv3') {
                        // handle iTXt format
                        let textStart = nullIndex + 1;
                        if (type === 'iTXt') {
                            // skip compression flag, method, lang tag, translated keyword
                            textStart += 4;
                            while (textStart < data.length && data[textStart] !== 0) textStart++;
                            textStart++;
                            while (textStart < data.length && data[textStart] !== 0) textStart++;
                            textStart++;
                        }

                        const textData = data.slice(textStart);
                        return new TextDecoder().decode(textData);
                    }
                }
            }

            offset += 12 + length;
        }

        return null;
    }

    async importCharacterFromJson(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const jsonData = JSON.parse(e.target.result);

                    let character;
                    if (jsonData.spec === 'chara_card_v3') {
                        character = new CharacterCard(jsonData.data);
                    } else {
                        character = CharacterCard.fromV2Format(jsonData);
                    }

                    this.storage.saveCharacter(character);
                    resolve(character);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = () => reject(new Error('failed to read file'));
            reader.readAsText(file);
        });
    }

    async fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('failed to read file'));
            reader.readAsDataURL(file);
        });
    }

    exportCharacterAsJson(characterId) {
        const character = this.storage.getCharacter(characterId);
        if (!character) return null;

        const v3Data = character.toV3Format();
        return JSON.stringify(v3Data, null, 2);
    }

    // legacy: flat quick replies stored as a setting. retained for backward compatibility.
    getQuickReplies() {
        return this.storage.getSetting('quickReplies', [
            { id: 'continue', label: 'continue...', text: 'please continue.' },
            { id: 'elaborate', label: 'elaborate', text: 'can you elaborate on that?' },
            { id: 'shorter', label: 'shorter', text: '*gestures for a shorter response*' }
        ]);
    }

    saveQuickReplies(replies) {
        this.storage.setSetting('quickReplies', replies);
    }

    // returns the merged set of quick replies for the current chat scope.
    // includes global sets, plus any character/group-scoped sets, plus legacy.
    getActiveQuickReplies() {
        const out = [];
        // legacy first (these are global)
        for (const r of this.getQuickReplies()) {
            out.push({ id: r.id || ('legacy_' + Math.random().toString(36).slice(2, 7)), label: r.label, text: r.text, sendImmediately: false });
        }
        let scope = 'global';
        let scopeId = null;
        if (this.currentGroup) { scope = 'group'; scopeId = this.currentGroup.id; }
        else if (this.currentCharacter) { scope = 'character'; scopeId = this.currentCharacter.id; }
        const sets = this.storage.getQuickReplySetsForScope(scope, scopeId);
        for (const s of sets) {
            for (const r of s.replies) {
                out.push({ id: r.id, label: r.label, text: r.text, sendImmediately: !!r.sendImmediately, setName: s.name });
            }
        }
        return out;
    }
}

// =====================================================
// extensions / plugin system
// =====================================================
// extensions are simple javascript objects (or factory functions) that subscribe
// to events and may register slash commands or ui-slot components.
//
// minimal manifest shape (in-memory):
// {
//   id, name, version,
//   permissions: ['chat:read', 'chat:send', 'ui:inject'],
//   install(api): registers handlers using the provided api
// }
//
// the api passed to install():
//   api.on(event, handler)
//   api.off(event, handler)
//   api.registerSlashCommand(name, handler)  // handler(args, ctx) -> string | null
//   api.registerUIComponent(slot, renderer)  // renderer(container)
//   api.getSetting(key) / api.setSetting(key, value)
//   api.notify(message)
//   api.requestHttp(url, options) // proxied through /api/rp/extensions/proxy (no-op stub)
class ExtensionManager {
    constructor(storage) {
        this.storage = storage;
        this.extensions = new Map();
        this.handlers = new Map(); // event -> Set<fn>
        this.slashCommands = new Map(); // name -> { fn, extensionId }
        this.uiSlots = new Map(); // slot -> [{ extensionId, render }]
    }

    register(manifest) {
        if (!manifest || !manifest.id) {
            console.warn('[rp] extension missing id');
            return false;
        }
        if (this.extensions.has(manifest.id)) {
            // already registered - replace
            this.unregister(manifest.id);
        }
        const state = this.storage.getExtensionState(manifest.id);
        this.extensions.set(manifest.id, { manifest, enabled: !!state.enabled });
        if (state.enabled) this.activate(manifest.id);
        return true;
    }

    unregister(id) {
        this.deactivate(id);
        this.extensions.delete(id);
    }

    activate(id) {
        const ext = this.extensions.get(id);
        if (!ext) return false;
        const api = this.makeApi(id);
        try {
            if (typeof ext.manifest.install === 'function') {
                ext.manifest.install(api);
            }
            ext.enabled = true;
            this.storage.setExtensionState(id, { enabled: true, settings: this.storage.getExtensionState(id).settings || {} });
        } catch (e) {
            console.error('[rp] extension activation failed:', id, e);
            return false;
        }
        return true;
    }

    deactivate(id) {
        // strip all handlers/commands/slots registered by this extension
        for (const [event, set] of this.handlers) {
            for (const h of Array.from(set)) {
                if (h.__extensionId === id) set.delete(h);
            }
        }
        for (const [name, { extensionId }] of Array.from(this.slashCommands)) {
            if (extensionId === id) this.slashCommands.delete(name);
        }
        for (const [slot, list] of this.uiSlots) {
            this.uiSlots.set(slot, list.filter(r => r.extensionId !== id));
        }
        const ext = this.extensions.get(id);
        if (ext) ext.enabled = false;
        this.storage.setExtensionState(id, { enabled: false, settings: this.storage.getExtensionState(id).settings || {} });
    }

    isEnabled(id) {
        return !!this.extensions.get(id)?.enabled;
    }

    listExtensions() {
        return Array.from(this.extensions.values()).map(({ manifest, enabled }) => ({
            id: manifest.id,
            name: manifest.name || manifest.id,
            version: manifest.version || '0.0.0',
            description: manifest.description || '',
            permissions: manifest.permissions || [],
            enabled
        }));
    }

    makeApi(extensionId) {
        const mgr = this;
        return {
            on(event, handler) {
                if (typeof handler !== 'function') return;
                handler.__extensionId = extensionId;
                if (!mgr.handlers.has(event)) mgr.handlers.set(event, new Set());
                mgr.handlers.get(event).add(handler);
            },
            off(event, handler) {
                if (mgr.handlers.has(event)) mgr.handlers.get(event).delete(handler);
            },
            registerSlashCommand(name, handler) {
                if (!name || typeof handler !== 'function') return;
                mgr.slashCommands.set(name.toLowerCase().replace(/^\//, ''), { fn: handler, extensionId });
            },
            registerUIComponent(slot, renderer) {
                if (!mgr.uiSlots.has(slot)) mgr.uiSlots.set(slot, []);
                mgr.uiSlots.get(slot).push({ extensionId, render: renderer });
            },
            getSetting(key) {
                return (mgr.storage.getExtensionState(extensionId).settings || {})[key];
            },
            setSetting(key, value) {
                const state = mgr.storage.getExtensionState(extensionId);
                const next = Object.assign({}, state.settings || {});
                next[key] = value;
                mgr.storage.setExtensionState(extensionId, { settings: next });
            },
            notify(message) {
                if (typeof showToast === 'function') showToast(message);
            },
            requestHttp(url, options = {}) {
                // permission gate
                const perms = (mgr.extensions.get(extensionId)?.manifest?.permissions) || [];
                if (!perms.includes('http:request')) {
                    return Promise.reject(new Error('extension lacks http:request permission'));
                }
                return fetch(url, options);
            }
        };
    }

    // emit an event to all listeners.
    // listeners may mutate and return a new payload (used for chat:beforeSend).
    emit(event, payload) {
        const set = this.handlers.get(event);
        if (!set || set.size === 0) return payload;
        let result = payload;
        for (const h of set) {
            try {
                const r = h(result);
                if (r !== undefined) result = r;
            } catch (e) {
                console.warn(`[rp] extension handler error in event "${event}":`, e);
            }
        }
        return result;
    }

    // parses a chat input line; if it looks like a slash command, runs it
    // and returns the textual output (or '' to consume silently).
    // returns null if the input isn't a slash command.
    tryHandleSlashCommand(input, ctx = {}) {
        if (!input || typeof input !== 'string') return null;
        const trimmed = input.trim();
        if (!trimmed.startsWith('/')) return null;
        const space = trimmed.indexOf(' ');
        const cmd = (space === -1 ? trimmed.slice(1) : trimmed.slice(1, space)).toLowerCase();
        const args = space === -1 ? '' : trimmed.slice(space + 1);
        const entry = this.slashCommands.get(cmd);
        if (!entry) return null;
        try {
            const result = entry.fn(args, ctx);
            return result == null ? '' : String(result);
        } catch (e) {
            console.error('[rp] slash command error:', cmd, e);
            return `error running /${cmd}: ${e.message}`;
        }
    }

    renderSlot(slot, container) {
        const list = this.uiSlots.get(slot);
        if (!list || list.length === 0) return;
        for (const item of list) {
            try { item.render(container); } catch (e) { console.warn('[rp] slot render failed:', e); }
        }
    }
}

// =====================================================
// rp ui controller
// =====================================================
class RPUIController {
    constructor(rpModule) {
        this.rp = rpModule;
        this.elements = {};
        this.isRendering = false;
        this._rpInitialized = false;
    }

    init() {
        // return early if already initialized to prevent event listener stacking
        if (this._rpInitialized) {
            return;
        }

        // check if rp container exists
        this.elements.container = document.getElementById('rp-container');
        if (!this.elements.container) {
            console.warn('[rp] rp-container element not found');
            return;
        }

        this.bindElements();
        this.bindEvents();
        this.renderCharacterGrid();

        // mark as initialized
        this._rpInitialized = true;
    }

    bindElements() {
        // main views
        this.elements.characterGrid = document.getElementById('rp-character-grid');
        this.elements.chatView = document.getElementById('rp-chat-view');
        this.elements.settingsView = document.getElementById('rp-settings-view');
        this.elements.characterEditor = document.getElementById('rp-character-editor');
        this.elements.personaEditor = document.getElementById('rp-persona-editor');

        // chat elements
        this.elements.chatMessages = document.getElementById('rp-chat-messages');
        this.elements.chatInput = document.getElementById('rp-chat-input');
        this.elements.sendBtn = document.getElementById('rp-send-btn');
        this.elements.attachBtn = document.getElementById('rp-attach-btn');
        this.elements.attachInput = document.getElementById('rp-attach-input');
        this.elements.characterInfo = document.getElementById('rp-character-info');

        // header elements
        this.elements.backBtn = document.getElementById('rp-back-btn');
        this.elements.settingsBtn = document.getElementById('rp-settings-btn');
        this.elements.addCharacterBtn = document.getElementById('rp-add-character-btn');
        this.elements.importBtn = document.getElementById('rp-import-btn');
        this.elements.importInput = document.getElementById('rp-import-input');
    }

    bindEvents() {
        // navigation
        this.elements.backBtn?.addEventListener('click', () => this.goBack());
        this.elements.settingsBtn?.addEventListener('click', () => this.showSettings());
        this.elements.addCharacterBtn?.addEventListener('click', () => this.showCharacterEditor());

        // import
        this.elements.importBtn?.addEventListener('click', () => this.elements.importInput?.click());
        this.elements.importInput?.addEventListener('change', (e) => this.handleImport(e));

        // chat
        this.elements.sendBtn?.addEventListener('click', () => this.sendMessage());
        this.elements.chatInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // image attachment
        this.elements.attachBtn?.addEventListener('click', () => this.elements.attachInput?.click());
        this.elements.attachInput?.addEventListener('change', (e) => this.handleImageAttach(e));
    }

    // view management
    showView(viewName) {
        const views = ['characterGrid', 'chatView', 'settingsView', 'characterEditor', 'personaEditor'];

        views.forEach(view => {
            const el = this.elements[view];
            if (el) {
                el.classList.toggle('hidden', view !== viewName);
            }
        });
    }

    goBack() {
        if (this.rp.currentCharacter) {
            this.rp.currentCharacter = null;
            this.showView('characterGrid');
            this.renderCharacterGrid();
        } else {
            // go to llms home
            if (typeof goHome === 'function') {
                goHome();
            }
        }
    }

    showSettings() {
        this.showView('settingsView');
        this.renderSettings();
    }

    showCharacterEditor(characterId = null) {
        this.showView('characterEditor');
        this.renderCharacterEditor(characterId);
    }

    showChat(characterId) {
        const character = this.rp.selectCharacter(characterId);
        if (!character) {
            showToast?.('character not found');
            return;
        }

        this.showView('chatView');
        this.renderChat();
    }

    // rendering
    renderCharacterGrid() {
        if (!this.elements.characterGrid) return;

        const characters = this.rp.storage.getAllCharacters();

        if (characters.length === 0) {
            this.elements.characterGrid.innerHTML = `
                <div class="rp-empty-state">
                    <div class="rp-empty-icon">🎭</div>
                    <div class="rp-empty-title">no characters yet</div>
                    <div class="rp-empty-desc">create or import a character to start roleplaying</div>
                    <button class="rp-btn rp-btn-primary" onclick="rpUI.showCharacterEditor()">
                        + create character
                    </button>
                </div>
            `;
            return;
        }

        // create grid container
        const grid = document.createElement('div');
        grid.className = 'rp-grid';

        // sort: favorites first, then by updated date
        const sortedCharacters = [...characters].sort((a, b) => {
            if (a.isFavorite && !b.isFavorite) return -1;
            if (!a.isFavorite && b.isFavorite) return 1;
            return new Date(b.updatedAt) - new Date(a.updatedAt);
        });

        for (const char of sortedCharacters) {
            // create card using DOM APIs to avoid XSS
            const card = document.createElement('div');
            card.className = 'rp-character-card';
            card.dataset.id = char.id;

            // create avatar
            const avatar = document.createElement('div');
            avatar.className = 'rp-character-avatar';
            if (char.avatarUrl) {
                // sanitize URL by encoding it properly
                const sanitizedUrl = char.avatarUrl.replace(/'/g, "\\'").replace(/"/g, '\\"');
                avatar.style.backgroundImage = `url('${sanitizedUrl}')`;
            } else {
                const placeholder = document.createElement('span');
                placeholder.className = 'rp-avatar-placeholder';
                placeholder.textContent = '🎭';
                avatar.appendChild(placeholder);
            }
            card.appendChild(avatar);

            // create name
            const nameDiv = document.createElement('div');
            nameDiv.className = 'rp-character-name';
            nameDiv.textContent = char.name;
            card.appendChild(nameDiv);

            // favorite indicator
            if (char.isFavorite) {
                const favDiv = document.createElement('div');
                favDiv.className = 'rp-character-fav';
                favDiv.textContent = '★';
                card.appendChild(favDiv);
            }

            // actions
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'rp-character-actions';

            const editBtn = document.createElement('button');
            editBtn.className = 'rp-action-btn';
            editBtn.dataset.action = 'edit';
            editBtn.title = 'edit';
            editBtn.textContent = '✏️';
            actionsDiv.appendChild(editBtn);

            const favBtn = document.createElement('button');
            favBtn.className = 'rp-action-btn';
            favBtn.dataset.action = 'favorite';
            favBtn.title = 'favorite';
            favBtn.textContent = char.isFavorite ? '★' : '☆';
            actionsDiv.appendChild(favBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'rp-action-btn rp-action-delete';
            deleteBtn.dataset.action = 'delete';
            deleteBtn.title = 'delete';
            deleteBtn.textContent = '🗑️';
            actionsDiv.appendChild(deleteBtn);

            card.appendChild(actionsDiv);
            grid.appendChild(card);
        }

        this.elements.characterGrid.innerHTML = '';
        this.elements.characterGrid.appendChild(grid);

        // bind events
        this.elements.characterGrid.querySelectorAll('.rp-character-card').forEach(card => {
            const id = card.dataset.id;

            // click to open chat
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.rp-action-btn')) {
                    this.showChat(id);
                }
            });

            // action buttons
            card.querySelectorAll('.rp-action-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;

                    if (action === 'edit') {
                        this.showCharacterEditor(id);
                    } else if (action === 'favorite') {
                        const char = this.rp.storage.getCharacter(id);
                        if (char) {
                            char.isFavorite = !char.isFavorite;
                            this.rp.storage.saveCharacter(char);
                            this.renderCharacterGrid();
                        }
                    } else if (action === 'delete') {
                        if (confirm('delete this character? this cannot be undone.')) {
                            this.rp.deleteCharacter(id);
                            this.renderCharacterGrid();
                            showToast?.('character deleted');
                        }
                    }
                });
            });
        });
    }

    renderChat() {
        if (!this.elements.chatMessages || !this.rp.currentCharacter) return;

        const character = this.rp.currentCharacter;
        const persona = this.rp.currentPersona;

        // update character info
        if (this.elements.characterInfo) {
            this.elements.characterInfo.innerHTML = `
                <div class="rp-chat-header-info">
                    <div class="rp-chat-avatar" style="background-image: url('${character.avatarUrl || ''}')">
                        ${!character.avatarUrl ? '🎭' : ''}
                    </div>
                    <div class="rp-chat-header-text">
                        <div class="rp-chat-character-name">${this.escapeHtml(character.name)}</div>
                        <div class="rp-chat-persona-name">chatting as ${this.escapeHtml(persona?.name || 'you')}</div>
                    </div>
                </div>
                <div class="rp-chat-header-actions">
                    <button class="rp-action-btn" id="rp-clear-chat" title="clear chat">🗑️</button>
                    <button class="rp-action-btn" id="rp-regenerate" title="regenerate">🔄</button>
                </div>
            `;

            // bind header actions
            document.getElementById('rp-clear-chat')?.addEventListener('click', () => {
                if (confirm('clear all messages in this chat?')) {
                    this.rp.clearChat();
                    this.renderChat();
                    showToast?.('chat cleared');
                }
            });

            document.getElementById('rp-regenerate')?.addEventListener('click', () => {
                this.regenerateLastMessage();
            });
        }

        // render messages
        let html = '';

        // show greeting if no messages
        if (this.rp.chatHistory.length === 0 && character.firstMes) {
            html += `
                <div class="rp-message rp-message-assistant rp-message-greeting">
                    <div class="rp-message-avatar" style="background-image: url('${character.avatarUrl || ''}')">
                        ${!character.avatarUrl ? '🎭' : ''}
                    </div>
                    <div class="rp-message-content">
                        <div class="rp-message-name">${this.escapeHtml(character.name)}</div>
                        <div class="rp-message-text">${this.formatMessage(character.firstMes)}</div>
                    </div>
                </div>
            `;
        }

        // render chat history
        for (const msg of this.rp.chatHistory) {
            const isUser = msg.role === 'user';
            const avatar = isUser ? (persona?.avatarUrl || '') : (character.avatarUrl || '');
            const name = isUser ? (persona?.name || 'you') : character.name;
            const placeholder = isUser ? '👤' : '🎭';

            html += `
                <div class="rp-message rp-message-${msg.role}" data-id="${msg.id}">
                    <div class="rp-message-avatar" style="background-image: url('${avatar}')">
                        ${!avatar ? placeholder : ''}
                    </div>
                    <div class="rp-message-content">
                        <div class="rp-message-name">${this.escapeHtml(name)}</div>
                        <div class="rp-message-text">${this.formatMessage(msg.content)}</div>
                        ${msg.images?.length ? this.renderMessageImages(msg.images) : ''}
                    </div>
                </div>
            `;
        }

        this.elements.chatMessages.innerHTML = html;
        this.scrollToBottom();
    }

    formatMessage(text) {
        if (!text) return '';

        // escape html
        let formatted = this.escapeHtml(text);

        // convert markdown-like formatting
        // *italics* and _italics_
        formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        formatted = formatted.replace(/_([^_]+)_/g, '<em>$1</em>');

        // **bold**
        formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // `code`
        formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

        // newlines
        formatted = formatted.replace(/\n/g, '<br>');

        return formatted;
    }

    renderMessageImages(images) {
        const container = document.createElement('div');
        container.className = 'rp-message-images';
        for (const img of images) {
            const imgEl = document.createElement('img');
            imgEl.className = 'rp-message-image';
            imgEl.src = img; // direct assignment is safe
            imgEl.addEventListener('click', () => this.showImageModal(img));
            container.appendChild(imgEl);
        }
        return container.outerHTML;
    }

    showImageModal(src) {
        const modal = document.createElement('div');
        modal.className = 'rp-image-modal';

        const backdrop = document.createElement('div');
        backdrop.className = 'rp-image-modal-backdrop';
        modal.appendChild(backdrop);

        const img = document.createElement('img');
        img.className = 'rp-image-modal-img';
        img.src = src; // direct assignment is safe
        modal.appendChild(img);

        modal.addEventListener('click', () => modal.remove());
        document.body.appendChild(modal);
    }

    scrollToBottom() {
        if (this.elements.chatMessages) {
            requestAnimationFrame(() => {
                this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
            });
        }
    }

    async sendMessage() {
        const input = this.elements.chatInput;
        if (!input) return;

        const text = input.value.trim();
        if (!text && !this.pendingImages?.length) return;

        input.value = '';

        try {
            const { userMessage, stream } = await this.rp.sendMessage(text, this.pendingImages || []);
            this.pendingImages = [];

            // render user message
            this.renderChat();

            // create assistant message element for streaming
            const assistantMsgDiv = document.createElement('div');
            assistantMsgDiv.className = 'rp-message rp-message-assistant rp-message-streaming';
            assistantMsgDiv.innerHTML = `
                <div class="rp-message-avatar" style="background-image: url('${this.rp.currentCharacter.avatarUrl || ''}')">
                    ${!this.rp.currentCharacter.avatarUrl ? '🎭' : ''}
                </div>
                <div class="rp-message-content">
                    <div class="rp-message-name">${this.escapeHtml(this.rp.currentCharacter.name)}</div>
                    <div class="rp-message-text"></div>
                </div>
            `;
            this.elements.chatMessages.appendChild(assistantMsgDiv);
            this.scrollToBottom();

            const textDiv = assistantMsgDiv.querySelector('.rp-message-text');
            let fullContent = '';

            // stream response
            for await (const chunk of stream) {
                fullContent += chunk;
                textDiv.innerHTML = this.formatMessage(fullContent);
                this.scrollToBottom();
            }

            // save assistant message
            this.rp.saveAssistantMessage(fullContent);

            // remove streaming class
            assistantMsgDiv.classList.remove('rp-message-streaming');

        } catch (error) {
            console.error('[rp] send message error:', error);
            showToast?.('error: ' + error.message);
        }
    }

    async regenerateLastMessage() {
        const history = this.rp.chatHistory;
        if (history.length === 0) return;

        // find last assistant message
        let lastAssistantIdx = -1;
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].role === 'assistant') {
                lastAssistantIdx = i;
                break;
            }
        }

        if (lastAssistantIdx === -1) return;

        // remove last assistant message
        history.splice(lastAssistantIdx, 1);
        this.rp.storage.saveChat(this.rp.currentCharacter.id, {
            messages: history,
            branches: ['main']
        });

        // find last user message to resend
        let lastUserMsg = null;
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].role === 'user') {
                lastUserMsg = history[i];
                break;
            }
        }

        if (lastUserMsg) {
            // remove from history (will be re-added by sendMessage)
            history.splice(history.indexOf(lastUserMsg), 1);
            this.rp.storage.saveChat(this.rp.currentCharacter.id, {
                messages: history,
                branches: ['main']
            });

            // set input and send
            this.elements.chatInput.value = lastUserMsg.content;
            this.pendingImages = lastUserMsg.images || [];
            await this.sendMessage();
        }
    }

    handleImageAttach(e) {
        const file = e.target.files[0];
        if (!file) return;

        // validate image
        if (!file.type.startsWith('image/')) {
            showToast?.('please select an image file');
            return;
        }

        // enforce 500KB file size limit to prevent localStorage quota errors
        const maxSize = 500 * 1024; // 500KB
        if (file.size > maxSize) {
            showToast?.('image must be under 500kb to prevent storage errors');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            this.pendingImages = this.pendingImages || [];
            this.pendingImages.push(e.target.result);
            showToast?.('image attached');
        };
        reader.readAsDataURL(file);

        e.target.value = '';
    }

    async handleImport(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            let character;

            if (file.name.endsWith('.png')) {
                character = await this.rp.importCharacterFromPng(file);
            } else if (file.name.endsWith('.json')) {
                character = await this.rp.importCharacterFromJson(file);
            } else {
                throw new Error('unsupported file format. use png or json.');
            }

            this.renderCharacterGrid();
            showToast?.(`imported: ${character.name}`);

        } catch (error) {
            console.error('[rp] import error:', error);
            showToast?.('import failed: ' + error.message);
        }

        e.target.value = '';
    }

    renderCharacterEditor(characterId = null) {
        const editor = this.elements.characterEditor;
        if (!editor) return;

        const character = characterId ? this.rp.storage.getCharacter(characterId) : null;
        const isNew = !character;

        editor.innerHTML = `
            <div class="rp-editor-header">
                <button class="rp-back-btn" id="rp-editor-back">←</button>
                <h2>${isNew ? 'create character' : 'edit character'}</h2>
            </div>
            <div class="rp-editor-content">
                <div class="rp-form-group">
                    <label>avatar</label>
                    <div class="rp-avatar-upload">
                        <div class="rp-avatar-preview" id="rp-avatar-preview" style="background-image: url('${character?.avatarUrl || ''}')">
                            ${!character?.avatarUrl ? '📷' : ''}
                        </div>
                        <input type="file" accept="image/*" id="rp-avatar-input" class="hidden">
                        <button class="rp-btn" onclick="document.getElementById('rp-avatar-input').click()">
                            upload avatar
                        </button>
                    </div>
                </div>

                <div class="rp-form-group">
                    <label>name *</label>
                    <input type="text" id="rp-char-name" value="${this.escapeHtml(character?.name || '')}" placeholder="character name">
                </div>

                <div class="rp-form-group">
                    <label>description</label>
                    <textarea id="rp-char-description" rows="4" placeholder="describe the character...">${this.escapeHtml(character?.description || '')}</textarea>
                </div>

                <div class="rp-form-group">
                    <label>personality</label>
                    <textarea id="rp-char-personality" rows="3" placeholder="personality traits...">${this.escapeHtml(character?.personality || '')}</textarea>
                </div>

                <div class="rp-form-group">
                    <label>scenario</label>
                    <textarea id="rp-char-scenario" rows="3" placeholder="the setting and context...">${this.escapeHtml(character?.scenario || '')}</textarea>
                </div>

                <div class="rp-form-group">
                    <label>first message</label>
                    <textarea id="rp-char-first-mes" rows="4" placeholder="the character's opening message...">${this.escapeHtml(character?.firstMes || '')}</textarea>
                </div>

                <div class="rp-form-group">
                    <label>example dialogue</label>
                    <textarea id="rp-char-mes-example" rows="4" placeholder="example conversation...">${this.escapeHtml(character?.mesExample || '')}</textarea>
                </div>

                <div class="rp-form-group">
                    <label>system prompt</label>
                    <textarea id="rp-char-system-prompt" rows="3" placeholder="additional instructions...">${this.escapeHtml(character?.systemPrompt || '')}</textarea>
                </div>

                <div class="rp-form-group">
                    <label>tags</label>
                    <input type="text" id="rp-char-tags" value="${(character?.tags || []).join(', ')}" placeholder="tag1, tag2, tag3">
                </div>

                <div class="rp-form-actions">
                    <button class="rp-btn" id="rp-editor-cancel">cancel</button>
                    <button class="rp-btn rp-btn-primary" id="rp-editor-save">
                        ${isNew ? 'create' : 'save'}
                    </button>
                </div>
            </div>
        `;

        // store avatar for saving
        let avatarUrl = character?.avatarUrl || '';

        // bind events
        document.getElementById('rp-editor-back')?.addEventListener('click', () => {
            this.showView('characterGrid');
            this.renderCharacterGrid();
        });

        document.getElementById('rp-editor-cancel')?.addEventListener('click', () => {
            this.showView('characterGrid');
            this.renderCharacterGrid();
        });

        document.getElementById('rp-avatar-input')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // enforce 500KB file size limit to prevent localStorage quota errors
            const maxSize = 500 * 1024; // 500KB
            if (file.size > maxSize) {
                showToast?.('avatar must be under 500kb to prevent storage errors');
                e.target.value = '';
                return;
            }

            try {
                avatarUrl = await this.rp.fileToDataUrl(file);
                const preview = document.getElementById('rp-avatar-preview');
                if (preview) {
                    preview.style.backgroundImage = `url('${avatarUrl}')`;
                    preview.textContent = '';
                }
            } catch (error) {
                showToast?.('failed to load image');
            }
        });

        document.getElementById('rp-editor-save')?.addEventListener('click', () => {
            const name = document.getElementById('rp-char-name')?.value.trim();
            if (!name) {
                showToast?.('name is required');
                return;
            }

            const data = {
                name,
                description: document.getElementById('rp-char-description')?.value || '',
                personality: document.getElementById('rp-char-personality')?.value || '',
                scenario: document.getElementById('rp-char-scenario')?.value || '',
                firstMes: document.getElementById('rp-char-first-mes')?.value || '',
                mesExample: document.getElementById('rp-char-mes-example')?.value || '',
                systemPrompt: document.getElementById('rp-char-system-prompt')?.value || '',
                tags: (document.getElementById('rp-char-tags')?.value || '').split(',').map(t => t.trim()).filter(t => t),
                avatarUrl
            };

            if (isNew) {
                this.rp.createCharacter(data);
                showToast?.('character created');
            } else {
                this.rp.updateCharacter(characterId, data);
                showToast?.('character saved');
            }

            this.showView('characterGrid');
            this.renderCharacterGrid();
        });
    }

    renderSettings() {
        const settings = this.elements.settingsView;
        if (!settings) return;

        const keys = this.rp.getApiKeys();
        const currentTemperature = this.rp.storage.getSetting('temperature', 0.8);
        const currentMaxTokens = this.rp.storage.getSetting('maxTokens', 2048);

        // check nocobase status
        const nocobaseConfigured = this.rp.storage.nocobase.isConfigured();
        const nocobaseUrl = localStorage.getItem('llms_nocobase_url') || 'https://db.houseofmates.space';
        const nocobaseKey = localStorage.getItem('llms_nocobase_key') || '';

        settings.innerHTML = `
            <div class="rp-settings-header">
                <button class="rp-back-btn" id="rp-settings-back">←</button>
                <h2>rp settings</h2>
            </div>
            <div class="rp-settings-content">
                <div class="rp-settings-section">
                    <h3>cloud sync (nocobase)</h3>
                    <div class="rp-sync-status ${nocobaseConfigured ? 'rp-sync-connected' : 'rp-sync-disconnected'}">
                        <span class="rp-sync-indicator"></span>
                        <span>${nocobaseConfigured ? 'connected to cloud' : 'not connected'}</span>
                    </div>
                    <div class="rp-form-group">
                        <label>nocobase url</label>
                        <input type="text" id="rp-nocobase-url" value="${this.escapeHtml(nocobaseUrl)}"
                            placeholder="https://db.houseofmates.space">
                        <small>your nocobase server url</small>
                    </div>
                    <div class="rp-form-group">
                        <label>nocobase api key</label>
                        <input type="password" id="rp-nocobase-key" value="${nocobaseKey}"
                            placeholder="enter your nocobase api key">
                        <small>characters and chats will sync automatically when configured</small>
                    </div>
                    <div class="rp-settings-actions">
                        <button class="rp-btn" id="rp-sync-now">↻ sync now</button>
                        <button class="rp-btn" id="rp-push-all">↑ push all to cloud</button>
                    </div>
                </div>

                <div class="rp-settings-section">
                    <h3>nvidia nim api</h3>
                    <div class="rp-form-group">
                        <label>api key(s)</label>
                        <input type="password" id="rp-nvidia-key" value="${keys.nvidia || ''}"
                            placeholder="enter your nvidia nim api key (comma-separated for multiple)">
                        <small>get your key at integrate.api.nvidia.com</small>
                    </div>
                </div>

                <div class="rp-settings-section">
                    <h3>generation settings</h3>
                    <div class="rp-form-group">
                        <label>temperature: <span id="rp-temp-value">${currentTemperature}</span></label>
                        <input type="range" id="rp-temperature" min="0" max="2" step="0.1" value="${currentTemperature}">
                        <small>higher = more creative, lower = more focused</small>
                    </div>
                    <div class="rp-form-group">
                        <label>max tokens</label>
                        <input type="number" id="rp-max-tokens" value="${currentMaxTokens}" min="256" max="8192">
                        <small>maximum response length (256-8192)</small>
                    </div>
                </div>

                <div class="rp-settings-section">
                    <h3>personas</h3>
                    <div id="rp-persona-list"></div>
                    <button class="rp-btn" id="rp-add-persona">+ add persona</button>
                </div>

                <div class="rp-settings-section">
                    <h3>data</h3>
                    <div class="rp-settings-actions">
                        <button class="rp-btn" id="rp-export-all">export all data</button>
                        <button class="rp-btn rp-btn-danger" id="rp-clear-all">clear all data</button>
                    </div>
                </div>

                <div class="rp-form-actions">
                    <button class="rp-btn rp-btn-primary" id="rp-settings-save">save settings</button>
                </div>
            </div>
        `;

        // render persona list
        this.renderPersonaList();

        // bind events
        document.getElementById('rp-settings-back')?.addEventListener('click', () => {
            this.showView('characterGrid');
            this.renderCharacterGrid();
        });

        document.getElementById('rp-temperature')?.addEventListener('input', (e) => {
            document.getElementById('rp-temp-value').textContent = e.target.value;
        });

        document.getElementById('rp-settings-save')?.addEventListener('click', () => {
            const nvidiaKey = document.getElementById('rp-nvidia-key')?.value.trim();
            const temperature = parseFloat(document.getElementById('rp-temperature')?.value) || 0.8;
            const maxTokens = parseInt(document.getElementById('rp-max-tokens')?.value) || 2048;

            // save nocobase config (uses main app's storage keys)
            const nocobaseUrl = document.getElementById('rp-nocobase-url')?.value.trim();
            const nocobaseKey = document.getElementById('rp-nocobase-key')?.value.trim();

            if (nocobaseUrl) {
                localStorage.setItem('llms_nocobase_url', nocobaseUrl.replace(/\/+$/, ''));
            }
            if (nocobaseKey) {
                localStorage.setItem('llms_nocobase_key', nocobaseKey);
            }

            this.rp.saveApiKeys({ nvidia: nvidiaKey });
            this.rp.storage.setSetting('temperature', temperature);
            this.rp.storage.setSetting('maxTokens', maxTokens);

            showToast?.('settings saved');

            // re-render to update sync status
            this.renderSettings();
        });

        // sync now button - pull from cloud
        document.getElementById('rp-sync-now')?.addEventListener('click', async () => {
            showToast?.('syncing from cloud...');
            await this.rp.storage.syncFromNocoBase();
            this.renderSettings();
            showToast?.('sync complete');
        });

        // push all to cloud button
        document.getElementById('rp-push-all')?.addEventListener('click', async () => {
            showToast?.('pushing to cloud...');
            await this.rp.storage.forceSync();
        });

        document.getElementById('rp-add-persona')?.addEventListener('click', () => {
            const name = prompt('persona name:');
            if (name) {
                this.rp.createPersona({ name });
                this.renderPersonaList();
                showToast?.('persona created');
            }
        });

        document.getElementById('rp-export-all')?.addEventListener('click', () => {
            const data = {
                characters: this.rp.storage.getAllCharacters(),
                personas: this.rp.storage.getAllPersonas(),
                settings: this.rp.storage.settings
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'rp-data-export.json';
            a.click();
            URL.revokeObjectURL(url);

            showToast?.('data exported');
        });

        document.getElementById('rp-clear-all')?.addEventListener('click', () => {
            if (confirm('this will delete all rp data including characters, chats, and personas. continue?')) {
                localStorage.removeItem(RP_STORAGE_KEYS.CHARACTERS);
                localStorage.removeItem(RP_STORAGE_KEYS.PERSONAS);
                localStorage.removeItem(RP_STORAGE_KEYS.CHATS);
                localStorage.removeItem(RP_STORAGE_KEYS.SETTINGS);
                localStorage.removeItem(RP_STORAGE_KEYS.LOREBOOKS);

                this.rp.storage.loadAll();
                showToast?.('all data cleared');
                this.showView('characterGrid');
                this.renderCharacterGrid();
            }
        });
    }

    renderPersonaList() {
        const list = document.getElementById('rp-persona-list');
        if (!list) return;

        const personas = this.rp.storage.getAllPersonas();
        const activePersona = this.rp.storage.getActivePersona();

        let html = '';
        for (const persona of personas) {
            html += `
                <div class="rp-persona-item ${persona.id === activePersona?.id ? 'rp-persona-active' : ''}" data-id="${persona.id}">
                    <div class="rp-persona-avatar" style="background-image: url('${persona.avatarUrl || ''}')">
                        ${!persona.avatarUrl ? '👤' : ''}
                    </div>
                    <div class="rp-persona-info">
                        <div class="rp-persona-name">${this.escapeHtml(persona.name)}</div>
                        ${persona.isDefault ? '<span class="rp-persona-badge">default</span>' : ''}
                    </div>
                    <div class="rp-persona-actions">
                        <button class="rp-action-btn" data-action="select" title="use this persona">✓</button>
                        ${!persona.isDefault ? '<button class="rp-action-btn rp-action-delete" data-action="delete" title="delete">🗑️</button>' : ''}
                    </div>
                </div>
            `;
        }

        list.innerHTML = html;

        // bind events
        list.querySelectorAll('.rp-persona-item').forEach(item => {
            const id = item.dataset.id;

            item.querySelectorAll('.rp-action-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;

                    if (action === 'select') {
                        this.rp.storage.setActivePersona(id);
                        this.renderPersonaList();
                        showToast?.('persona selected');
                    } else if (action === 'delete') {
                        if (confirm('delete this persona?')) {
                            this.rp.deletePersona(id);
                            this.renderPersonaList();
                            showToast?.('persona deleted');
                        }
                    }
                });
            });
        });
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// =====================================================
// global instances
// =====================================================
let rpModule = null;
let rpUI = null;
let rpExtensions = null;

function initRPModule() {
    if (rpModule) return;

    rpModule = new RPModule();
    rpExtensions = new ExtensionManager(rpModule.storage);
    rpUI = new RPUIController(rpModule);

    // expose globally
    window.rpModule = rpModule;
    window.rpUI = rpUI;
    window.rpExtensions = rpExtensions;

    // auto-register any bundled extensions exposed on window.rpBundledExtensions
    if (Array.isArray(window.rpBundledExtensions)) {
        for (const m of window.rpBundledExtensions) {
            try { rpExtensions.register(m); } catch (e) { console.warn('[rp] bundled extension failed:', e); }
        }
    }

    console.log('[rp] module initialized');
}

// auto-init when dom is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRPModule);
} else {
    initRPModule();
}

// =====================================================
// export
// =====================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        RPModule,
        RPUIController,
        CharacterCard,
        Persona,
        ChatMessage,
        LorebookEntry,
        LorebookActivationEngine,
        ApiKeyPool,
        RPStorage,
        NvidiaAPIClient,
        Group,
        QuickReply,
        QuickReplySet,
        ExpressionDetector,
        ExtensionManager,
        RP_STORAGE_KEYS,
        RP_MIGRATION_VERSION
    };
}
