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
    KEY_POOL_STATE: 'llms_rp_key_pool_state'
};

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
        this.variants = data.variants || [];
        this.isEdited = data.isEdited || false;
    }

    generateId() {
        return 'msg_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }
}

// =====================================================
// lorebook entry class
// =====================================================
class LorebookEntry {
    constructor(data = {}) {
        this.id = data.id || this.generateId();
        this.keys = data.keys || [];
        this.content = data.content || '';
        this.enabled = data.enabled !== false;
        this.insertionOrder = data.insertionOrder || 0;
        this.caseSensitive = data.caseSensitive || false;
        this.priority = data.priority || 0;
        this.comment = data.comment || '';
    }

    generateId() {
        return 'lore_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    matches(text) {
        if (!this.enabled) return false;
        const searchText = this.caseSensitive ? text : text.toLowerCase();
        return this.keys.some(key => {
            const searchKey = this.caseSensitive ? key : key.toLowerCase();
            return searchText.includes(searchKey);
        });
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

        // then try to sync from nocobase (if configured)
        if (this.nocobase.isConfigured()) {
            await this.syncFromNocoBase();
        }

        this.isLoaded = true;
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

    getContextMessages() {
        if (!this.currentCharacter) return [];

        const character = this.currentCharacter;
        const persona = this.currentPersona;

        // build system prompt
        let systemPrompt = character.systemPrompt || '';

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

        // add lorebook entries
        if (character.lorebookId) {
            const recentText = this.chatHistory.slice(-5).map(m => m.content).join(' ');
            const loreEntries = this.storage.getMatchingLoreEntries(character.lorebookId, recentText);
            if (loreEntries.length > 0) {
                systemPrompt += '\n\n[world info]\n' + loreEntries.map(e => e.content).join('\n');
            }
        }

        if (character.postHistoryInstructions) {
            systemPrompt += `\n\n[instructions]\n${character.postHistoryInstructions}`;
        }

        const messages = [
            { role: 'system', content: systemPrompt.trim() }
        ];

        // add chat history (last 20 messages for context window)
        const recentMessages = this.chatHistory.slice(-20);
        for (const msg of recentMessages) {
            const role = msg.role === 'assistant' ? 'assistant' : 'user';

            // handle multimodal messages
            if (msg.images && msg.images.length > 0) {
                const content = [
                    { type: 'text', text: msg.content }
                ];
                for (const img of msg.images) {
                    content.push({
                        type: 'image_url',
                        image_url: { url: img }
                    });
                }
                messages.push({ role, content });
            } else {
                messages.push({ role, content: msg.content });
            }
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

        // create user message
        const userMessage = new ChatMessage({
            role: 'user',
            content: text,
            images: images,
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

        const assistantMessage = new ChatMessage({
            role: 'assistant',
            content: content,
            characterId: this.currentCharacter.id,
            personaId: this.currentPersona?.id
        });

        this.chatHistory.push(assistantMessage);
        this.storage.addMessage(this.currentCharacter.id, assistantMessage);

        return assistantMessage;
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

    // quick replies
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

function initRPModule() {
    if (rpModule) return;

    rpModule = new RPModule();
    rpUI = new RPUIController(rpModule);

    // expose globally
    window.rpModule = rpModule;
    window.rpUI = rpUI;

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
        ApiKeyPool,
        RPStorage,
        NvidiaAPIClient
    };
}
