// script.js

// development mode flag - can be toggled via localStorage or inferred from hostname
// set `localStorage.setItem('llms_debug','true')` during development if needed
const DEBUG = (() => {
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('llms_debug') === 'true') {
            return true;
        }
    } catch (e) {
        // accessing localStorage can throw in some contexts
    }
    // fallback to localhost hostnames
    return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
})();

// debug console wrapper - only logs in development mode
const dlog = {
    log: (...args) => DEBUG && console.log(...args),
    warn: (...args) => DEBUG && console.warn(...args),
    error: (...args) => DEBUG && console.error(...args),
    info: (...args) => DEBUG && console.info(...args)
};

const defaultPrompt = `you are a helpful assistant. respond in all lowercase. be direct and clear.`;

// dom elements
const sidebar = document.getElementById('sidebar');
const sidebarNav = document.getElementById('sidebar-nav');
const openSidebarBtn = document.getElementById('open-sidebar-btn');
const closeSidebarBtn = document.getElementById('close-sidebar-btn');
const swipeOverlay = document.getElementById('swipe-overlay');
let navBtns = []; // will be populated dynamically
const currentModelTitle = document.getElementById('current-model-title');
const newTabBtn = document.getElementById('new-tab-btn');
const _activeTabIndicator = null;
let webviewContainer = document.getElementById('webview-container');
const toast = document.getElementById('toast');
const tabStrip = document.getElementById('tab-strip');
const tabStripWrapper = document.getElementById('tab-strip-wrapper');
const tabScrollLeftBtn = document.getElementById('tab-scroll-left');
const tabScrollRightBtn = document.getElementById('tab-scroll-right');

const settingsModal = document.getElementById('settings-modal');
const openSettingsBtn = document.getElementById('open-settings-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const systemPromptText = document.getElementById('system-prompt-text');
const savePromptBtn = document.getElementById('save-prompt-btn');
const resetPromptBtn = document.getElementById('reset-prompt-btn');

const apiChatContainer = document.getElementById('api-chat-container');
const chatMessages = document.getElementById('chat-messages');
const apiChatInput = document.getElementById('api-chat-input');
const sendApiMessageBtn = document.getElementById('send-api-message');
const injectPromptApiBtn = document.getElementById('inject-prompt-api-btn');

const homepageContainer = document.getElementById('homepage-container');
const homepageGrid = document.getElementById('homepage-grid');
const homepageTabsHeader = document.getElementById('homepage-tabs-header');
const homepageTabStrip = document.getElementById('homepage-tab-strip');

const apiKeyModal = document.getElementById('api-key-modal');
const openrouterKeyInput = document.getElementById('openrouter-key-input');
const huggingfaceKeyInput = document.getElementById('huggingface-key-input');
const geminiKeyInput = document.getElementById('gemini-key-input');
const deepseekKeyInput = document.getElementById('deepseek-key-input');
const mistralKeyInput = document.getElementById('mistral-key-input');
const nocobaseUrlInput = document.getElementById('nocobase-url-input');
const nocobaseKeyInput = document.getElementById('nocobase-key-input');
const saveApiKeysBtn = document.getElementById('save-api-keys-btn');
const skipApiKeysBtn = document.getElementById('skip-api-keys-btn');
const _globalColorPicker = document.getElementById('global-color-picker');
const orModelDropdown = document.getElementById('or-model-dropdown');

// chat management
const chatSidebar = document.getElementById('chat-sidebar');
const chatList = document.getElementById('chat-list');
const newChatBtn = document.getElementById('new-chat-btn');
const exportChatBtn = document.getElementById('export-chat-btn');
const summarizeChatBtn = document.getElementById('summarize-chat-btn');
const openChatSidebarBtn = document.getElementById('open-chat-sidebar-btn');
const closeChatSidebarBtn = document.getElementById('close-chat-sidebar-btn');
const collapseChatSidebarBtn = document.getElementById('collapse-chat-sidebar-btn');
const browserLinkPlaceholder = document.getElementById('browser-link-placeholder');
const browserLinkButton = document.getElementById('browser-link-button');
const browserLinkTitle = document.getElementById('browser-link-title');
const browserLinkDesc = document.getElementById('browser-link-desc');
const browserLinkProviders = new Set([
    'claude',
    'chatgpt',
    'sora',
    'grok',
    'kimi',
    'copilot',
    'perplex',
    'youai',
    'duck',
    'consensus',
    'lumo',
    'blackbox',
    'arena',
    'gemini-flash-lite',
    'veo',
    'music',
    'labs'
]);
const browserApiOverrides = new Map([
    ['openrouter', 'openrouter-api'],
    ['gemini', 'gemini-api'],
    ['deepseek', 'deepseek-api'],
    ['mistral', 'mistral-api'],
    ['huggingface', 'huggingface-api']
]);

// models that should behave as bookmarks in browser when no API key is set
const browserBookmarkModels = new Set([
    'claude',
    'chatgpt',
    'sora',
    'grok',
    'kimi',
    'copilot',
    'perplex',
    'youai',
    'duck',
    'consensus',
    'lumo',
    'blackbox',
    'arena',
    'gemini-flash-lite',
    'veo',
    'music',
    'labs'
]);
const DEFAULT_OPENROUTER_MODEL = 'openrouter/free';
const OPENROUTER_MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_MODEL_STORAGE_KEY = 'llms_openrouter_model';
let openrouterModelsLoaded = false;
let openrouterModelsLoading = null;
let openrouterTomSelect = null;
let openrouterModelCache = [];

if (orModelDropdown) {
    orModelDropdown.addEventListener('change', (e) => {
        const value = e.target?.value || DEFAULT_OPENROUTER_MODEL;
        saveOpenrouterModel(value);
        updateAttachmentUI();
    });
}

function getSavedOpenrouterModel() {
    try {
        const stored = localStorage.getItem(OPENROUTER_MODEL_STORAGE_KEY);
        if (stored && typeof stored === 'string') {
            return stored;
        }
    } catch (err) {
        dlog.warn('failed to read openrouter model preference', err);
    }
    return DEFAULT_OPENROUTER_MODEL;
}

function saveOpenrouterModel(value = DEFAULT_OPENROUTER_MODEL) {
    const modelName = value || DEFAULT_OPENROUTER_MODEL;
    try {
        localStorage.setItem(OPENROUTER_MODEL_STORAGE_KEY, modelName);
    } catch (err) {
        dlog.warn('failed to save openrouter model preference', err);
    }
    return modelName;
}

function getActiveOpenrouterModel() {
    if (orModelDropdown?.value) {
        return orModelDropdown.value;
    }
    return getSavedOpenrouterModel();
}

function applyOpenrouterOptions(models = null) {
    if (!orModelDropdown) {
        return;
    }
    if (Array.isArray(models) && models.length > 0) {
        openrouterModelCache = models;
    }
    const source = (openrouterModelCache && openrouterModelCache.length > 0)
        ? openrouterModelCache
        : [{ id: DEFAULT_OPENROUTER_MODEL, name: DEFAULT_OPENROUTER_MODEL }];

    const deduped = [];
    const seen = new Set();
    source.forEach((model) => {
        const id = typeof model === 'string' ? model : model?.id;
        if (!id || seen.has(id)) {
            return;
        }
        seen.add(id);
        deduped.push({ id, name: model?.name || id });
    });

    const saved = getSavedOpenrouterModel();
    if (!seen.has(saved)) {
        deduped.unshift({ id: saved, name: saved });
    }

    if (openrouterTomSelect) {
        openrouterTomSelect.clearOptions();
        deduped.forEach((opt) => {
            openrouterTomSelect.addOption({ value: opt.id, text: opt.name });
        });
        openrouterTomSelect.refreshOptions(false);
        openrouterTomSelect.setValue(saved, true);
    } else {
        orModelDropdown.innerHTML = '';
        deduped.forEach((opt) => {
            const option = document.createElement('option');
            option.value = opt.id;
            option.textContent = opt.name;
            orModelDropdown.appendChild(option);
        });
        orModelDropdown.value = saved;
    }
}

async function ensureOpenrouterModels() {
    if (openrouterModelsLoaded) {
        applyOpenrouterOptions();
        return;
    }
    if (openrouterModelsLoading) {
        await openrouterModelsLoading;
        return;
    }
    openrouterModelsLoading = loadOpenrouterModels();
    try {
        await openrouterModelsLoading;
    } finally {
        openrouterModelsLoading = null;
    }
}

async function loadOpenrouterModels() {
    try {
        const headers = { Accept: 'application/json' };
        const keys = getApiKeys();
        if (keys?.openrouter) {
            headers.Authorization = `Bearer ${keys.openrouter}`;
        }
        const res = await fetchWithTimeout(OPENROUTER_MODELS_ENDPOINT, { headers }, 20000);
        if (!res.ok) {
            throw new Error(`openrouter model list failed: ${res.status}`);
        }
        const data = await res.json();
        const rawModels = data?.data || data?.models || [];
        const freeModels = rawModels
            .filter((model) => typeof model?.id === 'string' && model.id.includes(':free'))
            .map((model) => ({
                id: model.id,
                name: model?.name || model.id
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        if (freeModels.length === 0) {
            throw new Error('no :free models returned');
        }
        applyOpenrouterOptions(freeModels);
        openrouterModelsLoaded = true;
    } catch (err) {
        dlog.warn('unable to fetch openrouter models - falling back to default', err);
        showToast('openrouter: using default free rotation');
        applyOpenrouterOptions([{ id: DEFAULT_OPENROUTER_MODEL, name: DEFAULT_OPENROUTER_MODEL }]);
    }
}

let chats = {}; // { chatId: { title: '', messages: [] } }
let currentChatId = null;

// reserved for future context window limiting
// maximum number of messages to keep in API request context
// (system + user + assistant entries). older messages will be dropped
// from `chatHistory` but full chat logs (`chats[...]`) remain intact.
const MAX_CONTEXT_MESSAGES = 20;

// to prevent localStorage from growing without bound, each individual chat
// log is also bounded. once an entry list exceeds this count, the oldest
// messages are removed (for convenience we trim on append).
const MAX_STORED_CHAT_MESSAGES = 1000;

let models = [
    { id: 'rp', name: 'rp', type: 'rp', url: null, domain: 'roleplay', baseColor: '#e91e63', supportsChats: true, supportsImages: true },
    { id: 'lumo', name: 'lumo', type: 'webview', url: 'https://lumo.proton.me/', domain: 'proton.me', baseColor: '#ffffff' },
    { id: 'gemini', name: 'gemini', type: 'webview', url: 'https://gemini.google.com', domain: 'google.com', baseColor: '#006bcf', supportsChats: true },
    { id: 'chatgpt', name: 'chatgpt', type: 'webview', url: 'https://chatgpt.com/', domain: 'chatgpt.com', baseColor: '#00d6a1' },
    { id: 'claude', name: 'claude', type: 'webview', url: 'https://claude.ai/new', domain: 'claude.ai', baseColor: '#ff8b65' },
    { id: 'deepseek', name: 'deepseek', type: 'webview', url: 'https://chat.deepseek.com/', domain: 'deepseek.com', baseColor: '#516bfc', supportsChats: true },
    { id: 'duck', name: 'duck ai', type: 'webview', url: 'https://duck.ai', domain: 'duck.ai', baseColor: '#e44f3f' },
    { id: 'copilot', name: 'copilot', type: 'webview', url: 'https://copilot.microsoft.com', domain: 'microsoft.com', baseColor: '#2b39c8' },
    { id: 'grok', name: 'grok', type: 'webview', url: 'https://grok.com', domain: 'grok.com', baseColor: '#ffffff' },
    { id: 'llama-offline', name: 'gemma 4', type: 'api', url: 'http://127.0.0.1:11434', domain: 'ollama', baseColor: '#4285f4', supportsChats: true, supportsImages: false },
    { id: 'kimi', name: 'kimi', type: 'webview', url: 'https://kimi.com', domain: 'kimi.com', baseColor: '#0064dd' },
    { id: 'perplex', name: 'perplexity', type: 'webview', url: 'https://perplexity.ai', domain: 'perplexity.ai', baseColor: '#474647' },
    { id: 'mistral', name: 'mistral', type: 'webview', url: 'https://chat.mistral.ai', domain: 'mistral.ai', baseColor: '#ff510d', supportsChats: true },
    { id: 'blackbox', name: 'blackbox', type: 'webview', url: 'https://www.blackbox.ai', domain: 'blackbox.ai', baseColor: '#ffffff' },
    { id: 'huggingface', name: 'huggingface', type: 'webview', url: 'https://huggingface.co/chat', domain: 'huggingface.co', baseColor: '#f88816', supportsChats: true },
    { id: 'consensus', name: 'consensus', type: 'webview', url: 'https://consensus.app', domain: 'consensus.app', baseColor: '#005c6f' },
    { id: 'openrouter', name: 'openrouter', type: 'webview', url: 'https://openrouter.ai/chat', domain: 'openrouter.ai', baseColor: '#95a4b9', supportsChats: true },
    { id: 'youai', name: 'you.com', type: 'webview', url: 'https://you.com', domain: 'you.com', baseColor: '#5368ee' },
    { id: 'arena', name: 'ai arena', type: 'webview', url: 'https://arena.ai/text/direct', domain: 'arena.ai', baseColor: '#ffab00' },
    { id: 'gemini-flash-lite', name: 'ai studio', type: 'webview', url: 'https://aistudio.google.com/u/0/prompts/new_chat?model=gemini-3.1-flash-lite-preview&pli=1', domain: 'aistudio.google.com', baseColor: '#004fab' },
    { id: 'veo', name: 'veo', type: 'webview', url: 'https://geminigen.ai/app/video-gen/veo', domain: 'geminigen.ai', baseColor: '#004fab' },
    { id: 'music', name: 'music', type: 'webview', url: 'https://www.producer.ai/', domain: 'producer.ai', baseColor: '#004fab' },
    { id: 'labs', name: 'labs', type: 'webview', url: 'https://labs.google/fx/tools/flow/project/09207310-4fa9-418f-b2c8-17d88ab0db81', domain: 'labs.google', baseColor: '#004fab' },
    { id: 'dolphin', name: 'dolphin', type: 'webview', url: 'https://chat.dphn.ai/', domain: 'dphn.ai', baseColor: '#4a7fcd' },
];

const shouldIncludeLlamaOffline = (() => {
    // Check if running in Electron (desktop app)
    if (typeof window !== 'undefined' && window.electronAPI) {
        return false; // Desktop Electron doesn't support llama-offline
    }
    // Check for mobile user agent
    if (typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent)) {
        return true;
    }
    // Check for Capacitor (mobile wrapper)
    if (typeof Capacitor !== 'undefined' && typeof Capacitor.getPlatform === 'function') {
        const platform = Capacitor.getPlatform();
        return platform === 'android' || platform === 'ios';
    }
    return false;
})();

// detect if this is an android apk build and add class to body for css targeting
const isAndroidApk = typeof window.Capacitor !== 'undefined' ||
                    window.AndroidBridge !== undefined;
if (isAndroidApk) {
    document.body.classList.add('android-apk');
}

// android apk: scrollbar hide when not scrolling
if (isAndroidApk) {
    const scrollContainers = ['#chat-messages', '#chat-list', '#homepage-grid'];
    const HIDE_DELAY = 500; // ms before hiding

    scrollContainers.forEach(selector => {
        const el = document.querySelector(selector);
        if (!el) return;

        let scrollTimeout = null;
        // start with scrollbar hidden
        el.classList.add('scrollbar-hidden');

        el.addEventListener('scroll', () => {
            // show scrollbar immediately on scroll
            el.classList.remove('scrollbar-hidden');

            // clear existing timeout
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }

            // hide scrollbar after delay
            scrollTimeout = setTimeout(() => {
                el.classList.add('scrollbar-hidden');
            }, HIDE_DELAY);
        }, { passive: true });
    });
}

// remove qwen from all platforms (replaced by gemma on apk)
models = models.filter((m) => m.id !== 'qwen');
try {
    const savedOrder = JSON.parse(localStorage.getItem('llms_sidebar_order') || '[]');
    const filtered = savedOrder.filter(id => id !== 'qwen');
    if (filtered.length !== savedOrder.length) {
        localStorage.setItem('llms_sidebar_order', JSON.stringify(filtered));
    }
} catch (e) {
    // ignore
}

if (!shouldIncludeLlamaOffline) {
    models = models.filter((m) => m.id !== 'llama-offline');
    // Also remove from saved order to prevent it from appearing
    try {
        const savedOrder = JSON.parse(localStorage.getItem('llms_sidebar_order') || '[]');
        const filtered = savedOrder.filter(id => id !== 'llama-offline');
        if (filtered.length !== savedOrder.length) {
            localStorage.setItem('llms_sidebar_order', JSON.stringify(filtered));
        }
    } catch (e) {
        // ignore
    }
}

// load order from localstorage
let savedOrder = [];
try {
    savedOrder = JSON.parse(localStorage.getItem('llms_sidebar_order')) || [];
} catch (e) {
    localStorage.removeItem('llms_sidebar_order');
}
if (savedOrder.length > 0) {
    models.sort((a, b) => {
        const indexA = savedOrder.indexOf(a.id);
        const indexB = savedOrder.indexOf(b.id);
        if (indexA === -1 && indexB === -1) {
            return 0;
        }
        if (indexA === -1) {
            return 1;
        }
        if (indexB === -1) {
            return -1;
        }
        return indexA - indexB;
    });
}

function getModelById(id) {
    return models.find((m) => m.id === id);
}

const TAB_STORAGE_KEY = 'llms_open_tabs';
const ACTIVE_TAB_STORAGE_KEY = 'llms_active_tab';
const TAB_SESSIONS_KEY = 'llms_tab_sessions';
let openTabs = [];
let activeTabId = null;
let tabSessions = {};
let isSiteActive = false;
let tabStripSortable = null;
let tabScrollState = { maxScroll: 0, hasOverflow: false };
let tabScrollPositions = {}; // { tabId: scrollLeft }

function persistTabScrollPositions() {
    try {
        localStorage.setItem('llms_tab_scroll_positions', JSON.stringify(tabScrollPositions));
    } catch (e) {
        dlog.warn('failed to persist tab scroll state', e);
    }
}

function loadTabScrollPositions() {
    try {
        tabScrollPositions = JSON.parse(localStorage.getItem('llms_tab_scroll_positions')) || {};
    } catch (e) {
        tabScrollPositions = {};
        localStorage.removeItem('llms_tab_scroll_positions');
    }
}

function updateTabUiVisibility() {
    const isActuallyHome = !isSiteActive || !activeTabId;
    const activeSiteWrapper = document.getElementById('active-site-wrapper');
    
    if (isActuallyHome) {
        // hide tabs and other site-specific elements on homepage
        if (activeSiteWrapper) {
            activeSiteWrapper.classList.add('hidden');
        }
        if (tabStripWrapper) {
            tabStripWrapper.classList.add('hidden');
            tabStripWrapper.classList.remove('flex');
        }
        if (newTabBtn) { newTabBtn.classList.add('hidden'); }
        if (currentModelTitle) { currentModelTitle.textContent = ''; }
    } else {
        // show tabs and other site-specific elements when site is active
        if (activeSiteWrapper) {
            activeSiteWrapper.classList.remove('hidden');
        }
        
        if (tabStripWrapper && openTabs.length > 0) {
            tabStripWrapper.classList.remove('hidden');
            tabStripWrapper.classList.add('flex');
        } else if (tabStripWrapper) {
            tabStripWrapper.classList.add('hidden');
            tabStripWrapper.classList.remove('flex');
        }
        
        if (newTabBtn) { newTabBtn.classList.remove('hidden'); }
        
        updateTabStripOverflow();
    }

    // ensure homepage tab pills mirror current visibility
    renderHomepageTabs();
}

function updateTabStripOverflow() {
    // ensure overflow state updates happen after DOM paints
    requestAnimationFrame(updateTabOverflowState);
}

function parseAndroidShareDetail(detail) {
    if (!detail) {
        return null;
    }
    if (typeof detail === 'string') {
        try {
            return JSON.parse(detail);
        } catch (e) {
            dlog.warn('failed to parse share payload', e);
            return null;
        }
    }
    return detail;
}

function extractFirstUrlFromText(text = '') {
    if (!text) {
        return null;
    }
    const match = text.match(/https?:\/\/[^\s]+/i);
    if (!match) {
        return null;
    }
    try {
        const url = new URL(match[0]);
        return url.toString();
    } catch (e) {
        dlog.warn('invalid shared url', e);
        return null;
    }
}

function domainMatchesHost(host, domain) {
    if (!host || !domain) {
        return false;
    }
    const normalizedHost = host.toLowerCase();
    const normalizedDomain = domain.toLowerCase();
    return (
        normalizedHost === normalizedDomain ||
        normalizedHost.endsWith('.' + normalizedDomain)
    );
}

function findModelForHost(host) {
    if (!host) {
        return null;
    }
    return models.find((model) => model.type === 'webview' && domainMatchesHost(host, model.domain));
}

function handleAndroidSharePayload(detail) {
    const payload = parseAndroidShareDetail(detail);
    if (!payload) {
        showToast('invalid share payload');
        return;
    }
    const url = extractFirstUrlFromText(payload.text || payload.subject || '');
    if (!url) {
        showToast('shared text missing url');
        return;
    }
    let host;
    try {
        host = new URL(url).hostname;
    } catch (e) {
        showToast('invalid share url');
        return;
    }
    const targetModel = findModelForHost(host);
    if (!targetModel) {
        showToast('shared domain not supported yet');
        return;
    }

    ensureTabForModel({
        id: targetModel.id,
        label: getDisplayName(targetModel),
        type: targetModel.type,
        url
    });
    updateTabSession(targetModel.id, { lastUrl: url });
    selectModelById(targetModel.id);
    showToast('opened in ' + getDisplayName(targetModel));
}

function persistTabSessions() {
    try {
        localStorage.setItem(TAB_SESSIONS_KEY, JSON.stringify(tabSessions));
    } catch (e) {
        dlog.warn('failed to persist tab sessions', e);
    }
}

function ensureTabSessionEntry(id, defaults = {}) {
    if (!id) {
        return;
    }
    if (!tabSessions[id]) {
        tabSessions[id] = { ...defaults };
        persistTabSessions();
    }
}

function updateTabSession(id, data) {
    if (!id || !data) {
        return;
    }
    tabSessions[id] = { ...(tabSessions[id] || {}), ...data };
    persistTabSessions();
}

function captureActiveTabSession() {
    if (!activeTabId) {
        return;
    }
    const tabIndex = openTabs.findIndex((t) => t.id === activeTabId);
    if (tabIndex === -1) {
        return;
    }
    const activeTab = openTabs[tabIndex];

    const session = tabSessions[activeTabId] || {};
    session.pageScroll = window.scrollY || window.pageYOffset || 0;
    let tabStateChanged = false;

    if (activeTab.type === 'webview') {
        if (window.electronAPI) {
            session.lastUrl = activeTab.url || session.lastUrl;
        } else if (webviewContainer && !webviewContainer.classList.contains('hidden')) {
            session.lastUrl = webviewContainer.src || activeTab.url || session.lastUrl;
            try {
                const iframeDoc =
                    webviewContainer.contentDocument || webviewContainer.contentWindow?.document;
                if (iframeDoc) {
                    session.innerScroll =
                        iframeDoc.documentElement?.scrollTop ?? iframeDoc.body?.scrollTop ?? 0;
                }
            } catch (e) {
                // cross-origin, ignore scroll capture
            }
        }
        if (session.lastUrl) {
            openTabs[tabIndex] = { ...activeTab, url: session.lastUrl };
            tabStateChanged = true;
        }
    } else if (activeTab.type === 'api') {
        session.chatId = currentChatId;
        session.chatScroll = chatMessages?.scrollTop || 0;
    }

    tabSessions[activeTabId] = session;
    persistTabSessions();
    if (tabStateChanged) {
        persistTabState();
    }
}

function _getTabIconSource(tab) {
    const model = getModelById(tab.id) || {};
    return getCardIcon(tab.id, model.domain || 'example.com');
}

function loadTabSessions() {
    try {
        tabSessions = JSON.parse(localStorage.getItem(TAB_SESSIONS_KEY)) || {};
    } catch (e) {
        tabSessions = {};
        localStorage.removeItem(TAB_SESSIONS_KEY);
    }
}

function loadTabState() {
    try {
        openTabs = JSON.parse(localStorage.getItem(TAB_STORAGE_KEY)) || [];
    } catch (e) {
        openTabs = [];
        localStorage.removeItem(TAB_STORAGE_KEY);
    }
    try {
        activeTabId = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY) || null;
    } catch (e) {
        activeTabId = null;
        localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
    }
}

function persistTabState() {
    try {
        localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(openTabs));
    } catch (e) {
        dlog.warn('failed to persist tabs', e);
    }
    if (activeTabId) {
        localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTabId);
    } else {
        localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
    }
}

function attachTabLongPress(element, _tabId) {
    let pressTimer = null;
    let longPressTriggered = false;

    const clearTimer = () => {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    };

    element.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches.length > 1) {
            return;
        }
        longPressTriggered = false;
        clearTimer();
        pressTimer = setTimeout(() => {
            longPressTriggered = true;
            element.classList.add('show-delete');
            if (navigator.vibrate) {
                navigator.vibrate(40);
            }
        }, 600);
    }, { passive: true });

    element.addEventListener('touchend', (e) => {
        clearTimer();
        if (longPressTriggered) {
            e.preventDefault();
            longPressTriggered = false;
        }
    }, { passive: false });

    ['touchmove', 'touchcancel'].forEach((evt) => {
        element.addEventListener(evt, () => {
            // if we move, don't trigger the delete button
            clearTimer();
            if (evt === 'touchmove') {
                // If we move too much, clear longPressTriggered so drag can happen instead
                // Sortable will handle the actual dragging
            }
        }, { passive: true });
    });
}

function sendAndroidTabState() {
    if (!window.AndroidBridge || typeof window.AndroidBridge.syncTabs !== 'function') {
        return;
    }
    try {
        const payload = {
            activeTabId: activeTabId || null,
            tabs: openTabs.map((tab) => ({
                id: tab.id,
                label: tab.label,
                type: tab.type || 'webview'
            }))
        };
        window.AndroidBridge.syncTabs(JSON.stringify(payload));
    } catch (err) {
        dlog.error('android tab sync failed', err);
    }
}

function renderTabs() {
    sendAndroidTabState();
    if (!tabStrip) {
        return;
    }

    if (!openTabs.length) {
        if (tabStripWrapper) { tabStripWrapper.classList.add('hidden'); }
        tabStrip.innerHTML = '';
        return;
    }

    if (tabStripWrapper) { tabStripWrapper.classList.remove('hidden'); }
    tabStrip.innerHTML = '';

    openTabs.forEach((tab) => {
        const model = models.find(m => m.id === tab.modelId || m.id === tab.id);
        const nameText = model ? model.name : tab.label;

        const tabEl = document.createElement('div');
        tabEl.className = `tab-pill ${tab.id === activeTabId ? 'active-tab' : ''}`;
        tabEl.dataset.id = tab.id;

        tabEl.classList.add('relative', 'tab-item');
        tabEl.style.paddingLeft = '24px';

        const closeBtn = document.createElement('span');
        closeBtn.className = 'tab-close-btn';
        closeBtn.innerHTML = '&#10005;';
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            closeTab(tab.id);
        };
        closeBtn.addEventListener('touchend', (e) => {
            e.stopPropagation();
            e.preventDefault();
            closeTab(tab.id);
        }, { passive: false });

        const nameSpan = document.createElement('span');
        nameSpan.className = 'tab-pill-label';
        nameSpan.textContent = nameText;
        nameSpan.style.textAlign = 'center';
        nameSpan.style.margin = '0 auto';
        nameSpan.style.display = 'block';

        tabEl.style.display = 'inline-flex';
        tabEl.style.alignItems = 'center';
        tabEl.style.justifyContent = 'center';

        tabEl.prepend(closeBtn);
        tabEl.appendChild(nameSpan);
        
        tabEl.onclick = () => selectModelById(tab.id);
        
        let tabTouchMoved = false;
        tabEl.addEventListener('touchstart', () => { tabTouchMoved = false; }, { passive: true });
        tabEl.addEventListener('touchmove', () => { tabTouchMoved = true; }, { passive: true });
        tabEl.addEventListener('touchend', (e) => {
            if (!tabTouchMoved && e.target !== closeBtn) {
                e.preventDefault();
                selectModelById(tab.id);
            }
        });

        tabEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            closeTab(tab.id);
        });

        attachTabLongPress(tabEl, tab.id);
        tabStrip.appendChild(tabEl);
    });
    renderHomepageTabs();

    requestAnimationFrame(() => {
        const activeElement = tabStrip.querySelector('.tab-item--active');
        if (activeElement) {
            const offsetLeft = activeElement.offsetLeft;
            const offsetWidth = activeElement.offsetWidth;
            tabStrip.scrollLeft = Math.max(0, offsetLeft - tabStrip.clientWidth / 2 + offsetWidth / 2);
        }
        updateTabOverflowState();
        initTabSortable();
    });
}

function updateTabOverflowState() {
    if (!tabStrip || !tabStripWrapper) {
        return;
    }
    const maxScroll = Math.max(tabStrip.scrollWidth - tabStrip.clientWidth, 0);
    const hasOverflow = maxScroll > 4;
    tabScrollState = { maxScroll, hasOverflow };
    const atStart = tabStrip.scrollLeft <= 4;
    const atEnd = tabStrip.scrollLeft >= maxScroll - 4;

    if (hasOverflow) {
        tabStripWrapper.classList.add('has-overflow');
    } else {
        tabStripWrapper.classList.remove('has-overflow');
    }

    if (tabScrollLeftBtn) {
        tabScrollLeftBtn.classList.toggle('tab-scroll-btn--inactive', atStart || !hasOverflow);
    }
    if (tabScrollRightBtn) {
        tabScrollRightBtn.classList.toggle('tab-scroll-btn--inactive', atEnd || !hasOverflow);
    }
}

function scrollTabsBy(delta) {
    if (!tabStrip) {
        return;
    }
    tabStrip.scrollTo({
        left: Math.max(0, Math.min(tabStrip.scrollLeft + delta, tabScrollState.maxScroll)),
        behavior: 'smooth'
    });
}

function handleTabStripScroll() {
    if (!tabStrip) {
        return;
    }
    if (activeTabId) {
        tabScrollPositions[activeTabId] = tabStrip.scrollLeft;
        persistTabScrollPositions();
    }
    updateTabOverflowState();
}

function initTabScrollButtons() {
    if (!tabScrollLeftBtn || !tabScrollRightBtn) {
        return;
    }
    tabScrollLeftBtn.addEventListener('click', () => scrollTabsBy(-200));
    tabScrollRightBtn.addEventListener('click', () => scrollTabsBy(200));
    tabStrip?.addEventListener('scroll', handleTabStripScroll, { passive: true });
    window.addEventListener('resize', () => {
        requestAnimationFrame(updateTabOverflowState);
    });
}

function initTabSortable() {
    if (typeof Sortable === 'undefined' || !tabStrip) {
        return;
    }
    // Destroy existing instance if present to handle re-renders
    if (tabStripSortable) {
        tabStripSortable.destroy();
        tabStripSortable = null;
    }
    tabStripSortable = Sortable.create(tabStrip, {
        animation: 150,
        delay: 100,
        delayOnTouchOnly: true,
        touchStartThreshold: 5,
        ghostClass: 'tab-pill-ghost',
        chosenClass: 'tab-pill-chosen',
        dragClass: 'dragging-tabs',
        direction: 'horizontal',
        onStart: () => {
            document.body.classList.add('dragging-tabs');
        },
        onEnd: () => {
            document.body.classList.remove('dragging-tabs');
        },
        onUpdate: () => {
            const newOrder = Array.from(tabStrip.children)
                .map((el) => el.getAttribute('data-id'))
                .filter(Boolean);
            const reorderedTabs = [];
            newOrder.forEach((id) => {
                const tab = openTabs.find((t) => t.id === id);
                if (tab) {
                    reorderedTabs.push(tab);
                }
            });
            openTabs = reorderedTabs;
            persistTabState();
            renderTabs();
        }
    });
}

function openNewTabSlot() {
    captureActiveTabSession();
    activeTabId = null;
    persistTabState();
    renderTabs();
    if (currentModelTitle) { currentModelTitle.textContent = ''; }
    isSiteActive = false;
    updateTabUiVisibility();
    if (typeof window.goHome === 'function') {
        window.goHome();
    } else {
        homepageContainer?.classList.remove('hidden');
        webviewContainer?.classList.add('hidden');
        apiChatContainer?.classList.add('hidden');
    }
}

function ensureTabForModel({ id, label, type, url }) {
    if (!id) {
        return;
    }
    const normalizedLabel = (label || id).trim();
    const tabData = {
        id,
        label: normalizedLabel || id,
        type: type || 'webview',
        url: url || null
    };
    const existingIndex = openTabs.findIndex((t) => t.id === id);
    if (existingIndex >= 0) {
        openTabs[existingIndex] = { ...openTabs[existingIndex], ...tabData };
    } else {
        openTabs.push(tabData);
    }
    const defaultSession =
        type === 'api'
            ? { chatId: null, chatScroll: 0 }
            : { lastUrl: tabData.url };
    ensureTabSessionEntry(id, defaultSession);
    activeTabId = id;
    persistTabState();
    renderTabs();
}

function closeTab(tabId) {
    const idx = openTabs.findIndex((t) => t.id === tabId);
    if (idx === -1) {
        return;
    }
    const closingActive = tabId === activeTabId;
    if (closingActive) {
        captureActiveTabSession();
    }
    openTabs.splice(idx, 1);
    delete tabSessions[tabId];
    persistTabSessions();

    if (openTabs.length === 0) {
        activeTabId = null;
        persistTabState();
        renderTabs();
        if (typeof window.goHome === 'function') {
            window.goHome();
        }
        return;
    }

    if (closingActive) {
        const fallbackIndex = idx >= openTabs.length ? openTabs.length - 1 : idx;
        const fallback = openTabs[fallbackIndex];
        activeTabId = fallback.id;
        persistTabState();
        renderTabs();
        selectModelById(fallback.id);
    } else {
        persistTabState();
        renderTabs();
    }
}

function selectModelById(modelId) {
    if (!modelId) {
        return;
    }
    const currentNavBtns = document.querySelectorAll('.nav-btn');
    const navButtonList = Array.from(currentNavBtns || []);
    const btn = navButtonList.find((b) => b.getAttribute && b.getAttribute('data-id') === modelId);
    if (btn) {
        handleModelSelection(btn);
    } else {
        dlog.warn('tab target not found', modelId);
    }
}

function restoreLastActiveTab() {
    if (!activeTabId) {
        return;
    }
    setTimeout(() => {
        selectModelById(activeTabId);
    }, 0);
}

loadTabSessions();
loadTabState();
loadTabScrollPositions();
renderTabs();
updateTabUiVisibility();
initTabScrollButtons();

window.addEventListener('beforeunload', captureActiveTabSession);
window.addEventListener('pagehide', captureActiveTabSession);

newTabBtn?.addEventListener('click', openNewTabSlot);

window.nativeOpenNewTab = () => {
    openNewTabSlot();
};

window.nativeCloseTab = (tabId) => {
    if (!tabId) {
        return;
    }
    closeTab(tabId);
};

window.nativeSelectTab = (tabId) => {
    if (!tabId) {
        return;
    }
    selectModelById(tabId);
};

window.nativeReorderTabs = (newOrder) => {
    if (!Array.isArray(newOrder) || newOrder.length === 0) {
        return;
    }
    // Reorder openTabs based on newOrder
    const reorderedTabs = [];
    newOrder.forEach((id) => {
        const tab = openTabs.find((t) => t.id === id);
        if (tab) {
            reorderedTabs.push(tab);
        }
    });
    // Add any missing tabs (shouldn't happen but just in case)
    openTabs.forEach((tab) => {
        if (!reorderedTabs.find((t) => t.id === tab.id)) {
            reorderedTabs.push(tab);
        }
    });
    openTabs = reorderedTabs;
    persistTabState();
    renderTabs();
};

let currentApiMode = null;
// previously had an unused `currentOllamaModel` variable; removed to avoid
// extraneous globals.
let chatHistory = []; // store conversation {role: 'user'|'assistant', content: '...'}

// trim helper must come after chatHistory declaration so the variable exists
function trimChatHistory() {
    while (chatHistory.length > MAX_CONTEXT_MESSAGES) {
        chatHistory.shift();
    }
}

// sidebar toggling
function openSidebar() {
    sidebar.classList.remove('-translate-x-full');
    swipeOverlay.classList.remove('hidden');
}

function closeSidebar() {
    sidebar.classList.add('-translate-x-full');
    swipeOverlay.classList.add('hidden');
}

function toggleSidebar() {
    const isDesktop = window.innerWidth >= 768;
    
    if (isDesktop) {
        // On desktop, toggle by adding/removing a custom class that overrides md:translate-x-0
        if (sidebar.classList.contains('desktop-hidden')) {
            sidebar.classList.remove('desktop-hidden');
            swipeOverlay.classList.add('hidden'); // No overlay on desktop
        } else {
            sidebar.classList.add('desktop-hidden');
            swipeOverlay.classList.add('hidden');
        }
    } else {
        // On mobile, use the existing translate-x-full logic
        if (sidebar.classList.contains('-translate-x-full')) {
            openSidebar();
        } else {
            closeSidebar();
        }
    }
}

openSidebarBtn.addEventListener('click', toggleSidebar);
closeSidebarBtn.addEventListener('click', closeSidebar);
swipeOverlay.addEventListener('click', closeSidebar);

// gesture swipe handling
let touchStartX = 0;
let touchEndX = 0;
const SWIPE_THRESHOLD = 50;

document.addEventListener(
    'touchstart',
    (e) => {
        touchStartX = e.changedTouches[0].screenX;
    },
    false
);

document.addEventListener(
    'touchend',
    (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    },
    false
);

function handleSwipe() {
    // swipe right from left edge
    if (touchEndX - touchStartX > SWIPE_THRESHOLD && touchStartX <= 50) {
        openSidebar();
    }
    // swipe left
    if (touchStartX - touchEndX > SWIPE_THRESHOLD) {
        closeSidebar();
    }
}

function _showCustomConfirm(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className =
            'fixed inset-0 bg-black/80 z-[200] flex items-center justify-center p-4 backdrop-blur-sm';

        const modal = document.createElement('div');
        modal.className =
            'bg-[#111] w-full max-w-md rounded-2xl border border-secondary/30 p-6 flex flex-col gap-4 shadow-2xl';

        const text = document.createElement('p');
        text.className = 'text-white text-lg font-bold';
        text.textContent = message;

        const btnContainer = document.createElement('div');
        btnContainer.className = 'flex justify-end gap-3 mt-2';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'cancel';
        cancelBtn.className = 'px-4 py-2 text-gray-400 hover:text-white transition-colors';

        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'ok';
        confirmBtn.className =
            'px-6 py-2 bg-secondary text-white font-bold rounded-lg hover:scale-105 transition-transform';

        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(confirmBtn);

        modal.appendChild(text);
        modal.appendChild(btnContainer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const cleanup = () => {
            document.body.removeChild(overlay);
        };

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                cleanup();
                resolve(false);
            }
        });

        cancelBtn.addEventListener('click', () => {
            cleanup();
            resolve(false);
        });

        confirmBtn.addEventListener('click', () => {
            cleanup();
            resolve(true);
        });
    });
}

function _showCustomPrompt(message, defaultValue = '') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className =
            'fixed inset-0 bg-black/80 z-[200] flex items-center justify-center p-4 backdrop-blur-sm';

        const modal = document.createElement('div');
        modal.className =
            'bg-[#111] w-full max-w-md rounded-2xl border border-secondary/30 p-6 flex flex-col gap-4 shadow-2xl';

        const text = document.createElement('p');
        text.className = 'text-white text-lg font-bold';
        text.textContent = message;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = defaultValue;
        input.className =
            'w-full bg-background text-white p-3 rounded-xl border border-gray-800 outline-none focus:border-secondary transition-colors';

        const btnContainer = document.createElement('div');
        btnContainer.className = 'flex justify-end gap-3 mt-2';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'cancel';
        cancelBtn.className = 'px-4 py-2 text-gray-400 hover:text-white transition-colors';

        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'ok';
        confirmBtn.className =
            'px-6 py-2 bg-secondary text-white font-bold rounded-lg hover:scale-105 transition-transform';

        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(confirmBtn);

        modal.appendChild(text);
        modal.appendChild(input);
        modal.appendChild(btnContainer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        input.focus();
        if (defaultValue) {
            input.select();
        }

        const cleanup = () => {
            document.body.removeChild(overlay);
        };

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                cleanup();
                resolve(null);
            }
        });

        cancelBtn.addEventListener('click', () => {
            cleanup();
            resolve(null);
        });

        confirmBtn.addEventListener('click', () => {
            cleanup();
            resolve(input.value);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                cleanup();
                resolve(input.value);
            }
            if (e.key === 'Escape') {
                cleanup();
                resolve(null);
            }
        });
    });
}

// view switching
async function handleModelSelection(btn) {
    const targetId = btn.getAttribute('data-id');
    const model = getModelById(targetId);
    
    if (!model) {
        console.error(`[llms] model not found for ID: ${targetId}`);
        return;
    }

    if (activeTabId && activeTabId !== targetId) {
        captureActiveTabSession();
    }

    // get type/url metadata from button (fallback to model definition)
    // IMPORTANT: check model.type first as primary source of truth if not on button
    const type = btn.getAttribute('data-type') || model?.type || 'webview';
    const browserOverride = getBrowserApiOverride(targetId);
    const effectiveType = browserOverride ? 'api' : type;
    const url = btn.getAttribute('data-url') || model?.url || null;

    const tabLabel = btn.textContent.trim() || model?.name || targetId;
    const tabUrl = url || model?.url || null;
    const session = tabSessions[targetId] || {};
    let sessionUrl = session.lastUrl;
    if (type === 'webview' && sessionUrl && model?.domain) {
        try {
            const sessionHost = new URL(sessionUrl).hostname;
            if (!domainMatchesHost(sessionHost, model.domain)) {
                sessionUrl = null;
            }
        } catch (e) {
            sessionUrl = null;
        }
    }
    const resolvedUrl = type === 'webview' ? sessionUrl || tabUrl : tabUrl;
    if (type === 'webview' && !sessionUrl && tabUrl) {
        updateTabSession(targetId, { lastUrl: tabUrl });
    }

    const bookmarkOnly = type === 'webview' && shouldOpenAsBookmark(model);

    if (bookmarkOnly) {
        const externalUrl = resolvedUrl || tabUrl || model?.url;
        if (externalUrl) {
            window.open(externalUrl, '_blank', 'noopener,noreferrer');
        } else {
            dlog.warn('bookmark model missing url', targetId);
        }
    }

    const shouldStayHome = bookmarkOnly && !window.electronAPI && !isNativePlatform();
    if (shouldStayHome) {
        return;
    }

    // create or activate tab for this model
    ensureTabForModel({
        id: targetId,
        label: tabLabel,
        type: effectiveType,
        url: resolvedUrl
    });

    // hide homepage and surface active site context
    homepageContainer.classList.add('hidden');
    if (currentModelTitle) { currentModelTitle.textContent = tabLabel; }

    updateTabUiVisibility();

    if (effectiveType === 'webview') {
        // in electron: use BrowserView managed by main process (real browser tab)
        // mobile capacitor: use native in-app browser (bypasses x-frame-options)
        // elsewhere: use iframe fallback
        if (window.electronAPI) {
            window.electronAPI.showSite(targetId, resolvedUrl);
            webviewContainer.style.display = 'none';
            webviewContainer.classList.add('hidden');
            browserLinkPlaceholder?.classList.add('hidden');
        } else {
            const native = isNativePlatform();

            if (native) {
                apiChatContainer.style.display = 'none';
                apiChatContainer.classList.add('hidden');
                webviewContainer.style.display = 'none';
                webviewContainer.classList.add('hidden');
                browserLinkPlaceholder?.classList.add('hidden');

                const overlayOpened = await openAndroidOverlay(resolvedUrl, tabLabel);
                if (!overlayOpened) {
                    window.open(resolvedUrl, '_blank', 'noopener,noreferrer');
                }

                currentApiMode = null;
                isSiteActive = true;
                updateTabUiVisibility();
                return;
            } else {
                if (shouldOpenAsBookmark(model)) {
                    // open directly as bookmark
                    window.open(resolvedUrl, '_blank', 'noopener,noreferrer');
                    // set site active so tab is visible even though content opens externally
                    isSiteActive = true;
                    updateTabUiVisibility();
                    return;
                } else if (shouldShowBrowserLink(model)) {
                    showBrowserLink(model, resolvedUrl);
                } else {
                    hideBrowserLink();
                    loadWebviewIframe(resolvedUrl, session);
                }
            }
        }
        // force hide api chat container and reset currentApiMode to ensure webview has focus
        if (apiChatContainer) {
            apiChatContainer.style.display = 'none';
            apiChatContainer.classList.add('hidden');
        }
        if (webviewContainer) {
            webviewContainer.style.display = 'block';
            webviewContainer.classList.remove('hidden');
        }
        hideBrowserLink();
        currentApiMode = null;
    } else if (effectiveType === 'api') {
        if (window.electronAPI) {
            window.electronAPI.hideAllSites();
        }
        webviewContainer.style.display = 'none';
        webviewContainer.classList.add('hidden');
        apiChatContainer.style.display = 'flex';
        apiChatContainer.classList.remove('hidden');
        hideBrowserLink();
        const apiMode = browserOverride || targetId;
        currentApiMode = apiMode;
        // adjust attachment button visibility if model supports images
        updateAttachmentUI();

        // toggle visibility of API selectors
        const hfSelector = document.getElementById('hf-model-selector');
        const orSelector = document.getElementById('or-model-selector');
        const geminiSelector = document.getElementById('gemini-model-selector');
        const selectorWrapper = document.getElementById('model-selector-wrapper');

        // first hide and detach all selectors into the column
        [hfSelector, orSelector, geminiSelector].forEach((el) => {
            if (!el) {
                return;
            }
            el.classList.add('hidden');
            el.classList.remove('flex');
            // move to wrapper to keep layout consistent
            selectorWrapper.appendChild(el);
        });

        if (apiMode === 'huggingface-api') {
            hfSelector.classList.remove('hidden');
            hfSelector.classList.add('flex');
            const keys = getApiKeys();
            if (!keys.huggingface) {
                await showHuggingfaceKeyPrompt();
            }
        } else if (apiMode === 'openrouter-api') {
            orSelector.classList.remove('hidden');
            orSelector.classList.add('flex');
            await ensureOpenrouterModels();
        } else if (apiMode === 'nano-banana-pro') {
            geminiSelector.classList.remove('hidden');
            geminiSelector.classList.add('flex');
            // ensure gemini key is set; if not, prompt user
            const keys = getApiKeys();
            if (!keys.gemini) {
                // show only gemini input
                await showGeminiKeyPrompt();
            }
        } else if (apiMode === 'deepseek-api') {
            const keys = getApiKeys();
            if (!keys.deepseek) {
                await showDeepseekKeyPrompt();
            }
        } else if (apiMode === 'mistral-api') {
            const keys = getApiKeys();
            if (!keys.mistral) {
                await showMistralKeyPrompt();
            }
        } else if (apiMode === 'gemini-api') {
            const keys = getApiKeys();
            if (!keys.gemini) {
                await showGeminiKeyPrompt();
            }
        }

        chatMessages.innerHTML = `<div class="text-center text-gray-500 mt-10">connected to ${currentApiMode}. start typing below.</div>`;
        chatHistory = []; // reset history on switch

        // show chat sidebar for models that support chats
        const currentModel = models.find((m) => m.id === targetId);
        const chatsEnabled = browserOverride
            ? true
            : Boolean(currentModel && currentModel.supportsChats);
        if (chatsEnabled) {
            showChatSidebar();
            // enlarge sidebar text for nano banana pro
            if (targetId === 'nano-banana-pro') {
                chatSidebar.classList.add('nano-sidebar');
            } else {
                chatSidebar.classList.remove('nano-sidebar');
            }
            // if nocobase key not set yet, prompt user for it
            const ncfg = getNocoBaseConfig();
            if (!ncfg.apiKey) {
                await showNocoBasePrompt();
            }

            await loadChats();
            // create initial chat if none exist
            if (Object.keys(chats).length === 0) {
                await createNewChat();
            } else {
                // switch to first chat
                currentChatId = Object.keys(chats)[0];
                renderChatList();
                renderCurrentChat();
            }

            if (session.chatId && chats[session.chatId]) {
                switchToChat(session.chatId);
            }
            if (typeof session.chatScroll === 'number') {
                requestAnimationFrame(() => {
                    chatMessages.scrollTop = session.chatScroll;
                });
            }
        } else {
            hideChatSidebar();
            chats = {};
            currentChatId = null;
        }
    } else if (effectiveType === 'rp') {
        // rp (roleplay) module
        if (window.electronAPI) {
            window.electronAPI.hideAllSites();
        }
        webviewContainer.style.display = 'none';
        webviewContainer.classList.add('hidden');
        apiChatContainer.style.display = 'none';
        apiChatContainer.classList.add('hidden');
        hideBrowserLink();

        // show rp container
        const rpContainer = document.getElementById('rp-container');
        if (rpContainer) {
            rpContainer.classList.remove('hidden');
            // initialize rp ui if available
            if (window.rpUI) {
                window.rpUI.init();
            }
        }

        currentApiMode = 'rp';
    }

    // copy prompt button removed

    if (typeof tabScrollPositions[targetId] === 'number' && tabStrip) {
        requestAnimationFrame(() => {
            tabStrip.scrollLeft = tabScrollPositions[targetId];
            updateTabOverflowState();
        });
    }
}

// helper function to load webview in iframe (for non-native platforms)
function loadWebviewIframe(url, session = {}) {
    const container = document.getElementById('webview-container');
    if (!container) {
        dlog.error('webview container not found');
        return;
    }

    if (container.tagName && container.tagName.toLowerCase() !== 'iframe') {
        const newIframe = document.createElement('iframe');
        newIframe.id = 'webview-container';
        newIframe.className = container.className;
        container.parentNode.replaceChild(newIframe, container);
        webviewContainer = newIframe;
    } else if (!container.tagName) {
        // if tagName doesn't exist, create a new iframe
        const newIframe = document.createElement('iframe');
        newIframe.id = 'webview-container';
        newIframe.className = container.className;
        container.parentNode.replaceChild(newIframe, container);
        webviewContainer = newIframe;
    }

    // mobile: ensure fullscreen iframe with proper viewport settings
    const isMobile = isMobileDevice();

    if (isMobile) {
        // force fullscreen on mobile
        webviewContainer.style.position = 'fixed';
        webviewContainer.style.top = '0';
        webviewContainer.style.left = '0';
        webviewContainer.style.width = '100vw';
        webviewContainer.style.height = '100vh';
        webviewContainer.style.zIndex = '30';
        webviewContainer.style.border = 'none';
        webviewContainer.style.margin = '0';
        webviewContainer.style.padding = '0';
        webviewContainer.style.overflow = 'hidden';

        // completely hide homepage container on mobile
        homepageContainer.style.display = 'none';
        homepageContainer.classList.add('hidden');
    } else {
        // desktop: reset to relative positioning
        webviewContainer.style.position = '';
        webviewContainer.style.top = '';
        webviewContainer.style.left = '';
        webviewContainer.style.width = '';
        webviewContainer.style.height = '';
        webviewContainer.style.zIndex = '';
        webviewContainer.style.border = '';
    }

    // inject mobile viewport meta tag via sandbox for better mobile site rendering
    if (isMobile && !webviewContainer.hasAttribute('data-mobile-enhanced')) {
        webviewContainer.setAttribute('data-mobile-enhanced', 'true');
        webviewContainer.setAttribute('importance', 'high');
        // allow scripts and same-origin, enable fullscreen
        webviewContainer.setAttribute(
            'sandbox',
            'allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation allow-modals allow-orientation-lock allow-presentation'
        );
        // request mobile site via user-agent hint in iframe
        webviewContainer.setAttribute('loading', 'eager');
    }

    // grok-specific: clear stale auth data before loading
    if (url.includes('grok.com')) {
        try {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.includes('grok') || key.includes('auth') || key.includes('session'))) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
            dlog.log('[grok] cleared stale auth data before load');
        } catch (e) {
            dlog.error('[grok] failed to clear auth data:', e);
        }
    }

    webviewContainer.src = url;
    webviewContainer.style.display = 'block';
    webviewContainer.classList.remove('hidden');

    if (session && (session.innerScroll || session.innerScroll === 0)) {
        webviewContainer.addEventListener(
            'load',
            () => {
                try {
                    const iframeDoc =
                        webviewContainer.contentDocument || webviewContainer.contentWindow?.document;
                    if (iframeDoc) {
                        iframeDoc.documentElement.scrollTop = session.innerScroll;
                        iframeDoc.body.scrollTop = session.innerScroll;
                    }
                } catch (e) {
                    // cross-origin; can't set scroll
                }
            },
            { once: true }
        );
    }

    // grok-specific: detect login error page and offer reload
    if (url.includes('grok.com')) {
        webviewContainer.onload = () => {
            try {
                const iframe = webviewContainer;
                let iframeDoc;
                try {
                    iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                } catch (e) {
                    // cross-origin, can't inspect
                    return;
                }
                if (iframeDoc && iframeDoc.body) {
                    const bodyText = iframeDoc.body.innerText || '';
                    if (bodyText.includes('Could not log you in') || bodyText.includes('try again')) {
                        dlog.warn('[grok] login error detected');
                        // show a toast with reload option
                        showToast('grok login failed - clearing cache and reloading...');
                        // clear more aggressively
                        try {
                            const keysToRemove = [];
                            for (let i = 0; i < localStorage.length; i++) {
                                const key = localStorage.key(i);
                                if (key && (key.includes('grok') || key.includes('auth') || key.includes('session') || key.includes('cf_') || key.includes('turnstile'))) {
                                    keysToRemove.push(key);
                                }
                            }
                            keysToRemove.forEach(key => localStorage.removeItem(key));
                        } catch (_e) {
                            // empty catch - suppressing error
                        }
                        // reload after short delay
                        setTimeout(() => {
                            iframe.src = url + '?t=' + Date.now();
                        }, 2000);
                    }
                }
            } catch (e) {
                // ignore cross-origin errors
            }
        };
    }
}

function getCardColor(modelId, defaultColor) {
    let savedColors = {};
    try {
        savedColors = JSON.parse(localStorage.getItem('llms_card_colors')) || {};
    } catch (e) {
        localStorage.removeItem('llms_card_colors');
    }
    return savedColors[modelId] || defaultColor;
}

function _saveCardColor(modelId, color) {
    let savedColors = {};
    try {
        savedColors = JSON.parse(localStorage.getItem('llms_card_colors')) || {};
    } catch (e) {
        localStorage.removeItem('llms_card_colors');
    }
    savedColors[modelId] = color;
    localStorage.setItem('llms_card_colors', JSON.stringify(savedColors));
}

function getCardIcon(modelId, _defaultDomain) {
    // check saved custom icons first (prioritize user uploads)
    let savedIcons = {};
    try {
        savedIcons = JSON.parse(localStorage.getItem('llms_card_icons')) || {};
    } catch (e) {
        localStorage.removeItem('llms_card_icons');
    }

    // return saved custom icon if available
    if (savedIcons[modelId]) {
        return savedIcons[modelId];
    }

    // map model IDs to local icon files with cache busting
    const iconMap = {
        'lumo': 'assets/lumo.png?v=3',
        'gemini': 'assets/gemini.png?v=3',
        'chatgpt': 'assets/chatgpt.png?v=3',
        'claude': 'assets/claude.png?v=3',
        'deepseek': 'assets/deepseek.png?v=3',
        'duck': 'assets/duck ai.png?v=3',
        'copilot': 'assets/copilot.png?v=3',
        'grok': 'assets/grok.png?v=3',
        'kimi': 'assets/kimi.png?v=3',
        'perplex': 'assets/perplexity.png?v=3',
        'huggingface': 'assets/huggingface.png',
        'mistral': 'assets/mistral.png?v=3',
        'blackbox': 'assets/blackbox.png?v=3',
        'consensus': 'assets/consensus.png?v=3',
        'openrouter': 'assets/openrouter.png?v=3',
        'youai': 'assets/you.png?v=3',
        'gemini-flash-lite': 'assets/ai studio.png?v=3',
        'nano-banana-pro': 'assets/nano banana.png?v=3',
        'arena': 'assets/arena.png',
        'veo': 'assets/veo.svg',
        'music': 'assets/music.png',
        'labs': 'assets/labs.png',
        'sora': 'assets/sora.png',
        'dolphin': 'assets/dolphin.png'
    };

    // return local icon if available
    if (iconMap[modelId]) {
        return iconMap[modelId];
    }

    // fallback to local robot icon instead of external service
    return 'assets/robot-icon.svg';
}

function saveCardIcon(modelId, iconUrl) {
    // Check size - localStorage has ~5MB limit
    if (iconUrl && iconUrl.length > 2000000) { // 2MB limit per icon
        showToast('icon too large, please use a smaller image');
        return false;
    }
    
    let savedIcons = {};
    try {
        savedIcons = JSON.parse(localStorage.getItem('llms_card_icons')) || {};
    } catch (e) {
        localStorage.removeItem('llms_card_icons');
    }
    
    // Check total size
    const currentSize = JSON.stringify(savedIcons).length;
    const newSize = currentSize + (iconUrl?.length || 0);
    if (newSize > 4000000) { // 4MB total limit
        showToast('storage full, removing old icons...');
        // Keep only last 5 icons
        const keys = Object.keys(savedIcons);
        if (keys.length > 5) {
            for (let i = 0; i < keys.length - 5; i++) {
                delete savedIcons[keys[i]];
            }
        }
    }
    
    savedIcons[modelId] = iconUrl;
    
    try {
        localStorage.setItem('llms_card_icons', JSON.stringify(savedIcons));
        dlog.log('saved icon for', modelId, 'size:', iconUrl?.length);
        return true;
    } catch (e) {
        showToast('failed to save icon - storage full');
        return false;
    }
}

// api key storage helpers - use localStorage for persistence
// (user expects keys to persist after "save", sessionStorage clears on reload)
function getApiKeys() {
    // use localStorage for persistence
    const keys = localStorage.getItem('llms_api_keys');
    if (keys) {
        try {
            return JSON.parse(keys);
        } catch (e) {
            localStorage.removeItem('llms_api_keys');
        }
    }
    return {};
}

function saveApiKeys(keys) {
    // save to localStorage for persistence
    localStorage.setItem('llms_api_keys', JSON.stringify(keys));
}

// helper to decide what display name should be shown in UI
function getDisplayName(model) {
    // mobile over width use banana emoji
    if (isMobileDevice() && model.id === 'nano-banana-pro') {
        return 'nano 🍌';
    }
    return model.name;
}

// small utility used all over the place to determine if the current
// viewport/device should be treated as "mobile".  The previous code
// duplicated a regex/width check many times.  Consolidating makes the
// logic easier to maintain and also allows us to test it.
function isMobileDevice() {
    return (
        window.innerWidth < 768 ||
        /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
            navigator.userAgent.toLowerCase()
        )
    );
}

// detect if running as appimage (electron on linux)
function isAppImage() {
    return window.electronAPI && window.electronAPI.platform === 'linux';
}

function isNativePlatform() {
    try {
        if (window.electronAPI) {
            return true;
        }
        if (typeof Capacitor !== 'undefined') {
            if (typeof Capacitor.isNativePlatform === 'function') {
                return Capacitor.isNativePlatform();
            }
            if (Capacitor.isNative) {
                return true;
            }
            if (typeof Capacitor.getPlatform === 'function') {
                return Capacitor.getPlatform() !== 'web';
            }
        }
    } catch (err) {
        dlog.warn('native detection failed', err);
    }
    return false;
}

function isPureBrowser() {
    return !isNativePlatform();
}

function getBrowserApiOverride(modelId) {
    if (!modelId || !isPureBrowser()) {
        return null;
    }
    return browserApiOverrides.get(modelId) || null;
}

function shouldShowBrowserLink(model) {
    if (!model || model.type !== 'webview') {
        return false;
    }
    if (!isPureBrowser()) {
        return false;
    }
    return browserLinkProviders.has(model.id);
}

function shouldOpenAsBookmark(model) {
    if (!isPureBrowser()) { return false; }
    if (!model.url) { return false; }
    if (browserBookmarkModels.has(model.id)) { return true; }
    if (getBrowserApiOverride(model.id)) {
        const keys = getApiKeys();
        const apiMode = getBrowserApiOverride(model.id);
        if (apiMode === 'openrouter-api' && !keys.openrouter) { return true; }
        if (apiMode === 'gemini-api' && !keys.gemini) { return true; }
        if (apiMode === 'deepseek-api' && !keys.deepseek) { return true; }
        if (apiMode === 'mistral-api' && !keys.mistral) { return true; }
        if (apiMode === 'huggingface-api' && !keys.huggingface) { return true; }
    }
    return false;
}

function showBrowserLink(model, url) {
    if (!browserLinkPlaceholder) {
        return;
    }
    const title = model?.name || 'this site';
    browserLinkTitle.textContent = `${title} cannot load here`;
    browserLinkDesc.textContent = 'this provider blocks embeds in regular browsers. open it in a new tab instead.';
    browserLinkButton.onclick = () => {
        if (url) {
            window.open(url, '_blank', 'noopener');
        }
    };
    browserLinkPlaceholder.classList.remove('hidden');
    browserLinkPlaceholder.style.display = 'flex';
    if (webviewContainer) {
        webviewContainer.classList.add('hidden');
        webviewContainer.style.display = 'none';
    }
    if (apiChatContainer) {
        apiChatContainer.classList.add('hidden');
        apiChatContainer.style.display = 'none';
    }
}

function hideBrowserLink() {
    if (!browserLinkPlaceholder) {
        return;
    }
    browserLinkPlaceholder.classList.add('hidden');
    browserLinkPlaceholder.style.display = 'none';
    browserLinkButton.onclick = null;
}

// render open tabs as pills in header
function renderHomepageTabs() {
    if (!homepageTabsHeader || !homepageTabStrip) { return; }

    const onHomepage = !isSiteActive;

    homepageTabStrip.innerHTML = '';

    if (!openTabs.length || !onHomepage) {
        homepageTabsHeader.classList.add('hidden');
        homepageTabsHeader.style.display = 'none';
        return;
    }

    homepageTabsHeader.classList.remove('hidden');
    homepageTabsHeader.style.display = 'flex';

    openTabs.forEach((tab) => {
        const model = models.find((m) => m.id === tab.id) || tab;

        const pill = document.createElement('button');
        pill.className = 'tab-pill tab-pill--homepage';
        pill.textContent = getDisplayName(model);
        pill.onclick = () => selectModelById(tab.id);

        const closeBtn = document.createElement('span');
        closeBtn.className = 'tab-pill-close';
        closeBtn.innerHTML = '\u00d7';
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            closeTab(tab.id);
        };

        pill.appendChild(closeBtn);
        homepageTabStrip.appendChild(pill);
    });
}

// generate sidebar and homepage grid
function generateUI() {
    // navigation helper for returning to homepage
    window.goHome = () => {
        // restore homepage display (especially important on mobile)
        homepageContainer.style.display = '';
        homepageContainer.classList.remove('hidden');

        // hide webview - reset styles on mobile
        webviewContainer.classList.add('hidden');
        webviewContainer.style.display = 'none';

        // reset webview container styles for mobile
        const isMobile = isMobileDevice();
        if (isMobile) {
            webviewContainer.style.position = '';
            webviewContainer.style.top = '';
            webviewContainer.style.left = '';
            webviewContainer.style.width = '';
            webviewContainer.style.height = '';
            webviewContainer.style.zIndex = '';
        }

        apiChatContainer.classList.add('hidden');

        // hide rp container
        const rpContainer = document.getElementById('rp-container');
        if (rpContainer) {
            rpContainer.classList.add('hidden');
        }

        chatHistory = [];
        currentApiMode = null;
        if (currentModelTitle) { currentModelTitle.textContent = ''; }
        isSiteActive = false;
        updateTabUiVisibility();

        // remove active state from all nav buttons
        navBtns.forEach((b) => b.classList.remove('active-nav'));

        // in electron: hide all browserviews
        if (window.electronAPI) {
            window.electronAPI.hideAllSites();
        }
    };

    // add home button listener if exists
    const homeBtn = document.getElementById('home-btn');
    if (homeBtn) {
        homeBtn.addEventListener('click', goHome);
    }
    // also allow clicking the sidebar title "llms" to go home
    const sidebarTitle = document.querySelector('#sidebar h1');
    if (sidebarTitle) {
        sidebarTitle.style.cursor = 'pointer';
        sidebarTitle.addEventListener('click', goHome);
    }
    sidebarNav.innerHTML = '';
    homepageGrid.innerHTML = '';

    models.forEach((model, _index) => {
        // skip youai on appimage (only)
        if (isAppImage() && model.id === 'youai') {
            return;
        }

        // generate sidebar button
        const btn = document.createElement('button');
        btn.className = 'nav-btn'; // removed default active-nav - homepage is default
        btn.textContent = getDisplayName(model);
        btn.setAttribute('data-type', model.type);
        if (model.url) {
            btn.setAttribute('data-url', model.url);
        }
        if (model.id) {
            btn.setAttribute('data-id', model.id);
        }

        // click selection (replaces the drag block)
        btn.addEventListener('click', () => handleModelSelection(btn));
        sidebarNav.appendChild(btn);

        // generate homepage card
        const cardColor = getCardColor(model.id, model.baseColor);
        const card = document.createElement('div');
        card.className = 'homepage-card group';
        card.setAttribute('data-id', model.id);
        card.style.setProperty('--card-color', cardColor);

        const cardIcon = getCardIcon(model.id, model.domain);

        // large, clickable area for routing
        const iconImg = document.createElement('img');
        iconImg.src = cardIcon;
        iconImg.alt = getDisplayName(model) + ' icon';
        iconImg.style.width = '100%';
        iconImg.style.height = '100%';
        iconImg.style.objectFit = 'contain';
        iconImg.style.display = 'block';
        iconImg.dataset.modelId = model.id; // Store model ID for reference
        
        // Add error handler to use fallback robot icon if custom icon fails
        iconImg.onerror = function() {
            if (!this.src.includes('robot-icon.svg')) {
                this.src = 'assets/robot-icon.svg';
            }
        };
        
        const iconSquare = document.createElement('div');
        iconSquare.className = 'app-icon-square pointer-events-none';
        iconSquare.appendChild(iconImg);
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'app-name outline-text select-none text-center';
        nameSpan.textContent = getDisplayName(model);
        
        card.innerHTML = '';
        card.appendChild(iconSquare);
        card.appendChild(nameSpan);
        // ensure certain labels never wrap
        if (['perplexity', 'huggingface', 'openrouter'].includes(model.id)) {
            const nameSpan = card.querySelector('.app-name');
            if (nameSpan) {
                nameSpan.style.whiteSpace = 'nowrap';
                nameSpan.style.wordBreak = 'normal';
            }
        }
        homepageGrid.appendChild(card);

        // click to navigate (only if not dragging)
        // use shared global flag to track drag state across all cards
        // on touch devices, always allow click since sortable is disabled
        const isTouchDevice = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        // flag set by touchend handler to prevent duplicate navigation from subsequent click event
        let cardTouchHandled = false;
        card.addEventListener('click', (_e) => {
            if (cardTouchHandled) {
                cardTouchHandled = false;
                return; // already handled via touchend (fixes Android double-tap issue)
            }
            if (!isTouchDevice && window._homepageIsDragging) {
                return;
            }
            selectModelById(model.id);
        });
        
        // context menu for move, icon, color
        function showCardContextMenu(x, y, useCardPosition = false) {
            // Remove any existing menu
            const existingMenu = document.getElementById('card-context-menu');
            if (existingMenu) {
                existingMenu.remove();
            }

            const menu = document.createElement('div');
            menu.id = 'card-context-menu';
            menu.className = 'card-context-menu';
            
            // First append with visibility hidden to measure
            menu.style.cssText = `
                position: fixed;
                left: -9999px;
                top: 0;
                background: #1a1a1a;
                border: 1px solid #444;
                border-radius: 12px;
                padding: 8px 0;
                z-index: 1000;
                box-shadow: 0 8px 32px rgba(0,0,0,0.5);
                min-width: 140px;
                max-width: 200px;
            `;
            
            document.body.appendChild(menu);
            
            // Setup position variables
            let leftPos = x;
            let topPos = y;
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;
            
            // Add menu items first so we can measure
            const options = [
                { id: 'move', label: 'move', icon: '↔' },
                { id: 'icon', label: 'change icon', icon: '🖼' },
                { id: 'color', label: 'color', icon: '🎨' }
            ];

            options.forEach(opt => {
                const item = document.createElement('div');
                item.className = 'context-menu-item';
                item.style.cssText = `
                    padding: 12px 20px;
                    color: #fff;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-size: 14px;
                    transition: background 0.2s;
                    white-space: nowrap;
                `;
                item.innerHTML = `<span style="font-size: 16px;">${opt.icon}</span> ${opt.label}`;
                item.addEventListener('mouseenter', () => item.style.background = '#333');
                item.addEventListener('mouseleave', () => item.style.background = 'transparent');
                item.addEventListener('click', () => {
                    menu.remove();
                    // Capture model ID at click time to avoid closure issues
                    const currentModelId = model.id;
                    const currentModel = models.find(m => m.id === currentModelId);
                    const currentCard = document.querySelector(`.homepage-card[data-id="${currentModelId}"]`);
                    
                    if (opt.id === 'move') {
                        enableDragMode(currentCard || card, currentModel || model);
                    } else if (opt.id === 'icon') {
                        requestIconUpload(currentModel || model, currentCard || card);
                    } else if (opt.id === 'color') {
                        showColorPicker(currentModel || model, currentCard || card);
                    }
                });
                menu.appendChild(item);
            });
            
            // Now measure and position
            const menuRect = menu.getBoundingClientRect();
            const menuWidth = menuRect.width;
            
            // If using card position, center below the card
            if (useCardPosition) {
                const cardRect = card.getBoundingClientRect();
                leftPos = cardRect.left + (cardRect.width / 2) - (menuWidth / 2);
                topPos = cardRect.bottom + 8;
            }
            
            // Keep within screen bounds (left/right)
            if (leftPos < 8) {
                leftPos = 8;
            }
            if (leftPos + menuWidth > screenWidth - 8) {
                leftPos = screenWidth - menuWidth - 8;
            }
            
            // If would go off bottom, show above instead
            const menuHeight = menuRect.height;
            if (topPos + menuHeight > screenHeight - 8) {
                const cardRect = card.getBoundingClientRect();
                topPos = cardRect.top - menuHeight - 8;
            }
            
            menu.style.left = leftPos + 'px';
            menu.style.top = topPos + 'px';

            document.body.appendChild(menu);

            // Close menu on outside click
            setTimeout(() => {
                const closeMenu = (e) => {
                    if (!menu.contains(e.target)) {
                        menu.remove();
                        document.removeEventListener('click', closeMenu);
                    }
                };
                document.addEventListener('click', closeMenu);
            }, 100);
        }

        // custom touch drag implementation (copied from images app grid.js)
        // this replaces the glitchy SortableJS mobile drag mode
        let _draggedCard = null;
        let _originalNextSibling = null;
        let _frozenCards = null;
        let _indicatorCard = null;
        let _insertAfter = false;
        let _rafPending = false;
        let _lastCX = 0, _lastCY = 0;
        let _touchClone = null;
        let _touchActive = false;
        let _touchMoved = false;
        const TOUCH_PRIME_MS = 150;
        const TOUCH_MOVE_THRESHOLD = 8;

        function freezePositions(excludeCard) {
            const gr = homepageGrid.getBoundingClientRect();
            const sl = homepageGrid.scrollLeft, st = homepageGrid.scrollTop;
            _frozenCards = [];
            for (const c of homepageGrid.children) {
                if (c === excludeCard) { continue; }
                const r = c.getBoundingClientRect();
                _frozenCards.push({
                    el: c,
                    cx: r.left - gr.left + sl + r.width / 2,
                    cy: r.top - gr.top + st + r.height / 2,
                });
            }
        }

        function clearIndicator() {
            if (_indicatorCard) {
                _indicatorCard.classList.remove('drag-insert-before', 'drag-insert-after');
                _indicatorCard = null;
            }
        }

        function updateDropTarget(clientX, clientY) {
            if (!_frozenCards || !_frozenCards.length) { return; }
            const gr = homepageGrid.getBoundingClientRect();
            const cx = clientX - gr.left + homepageGrid.scrollLeft;
            const cy = clientY - gr.top + homepageGrid.scrollTop;
            let best = _frozenCards[0], bestDist = Infinity;
            for (const fc of _frozenCards) {
                const dx = cx - fc.cx, dy = cy - fc.cy;
                const d = dx * dx + dy * dy;
                if (d < bestDist) { bestDist = d; best = fc; }
            }
            const after = cy > best.cy;
            if (best.el === _indicatorCard && after === _insertAfter) { return; }
            clearIndicator();
            _indicatorCard = best.el;
            _insertAfter = after;
            _indicatorCard.classList.add(after ? 'drag-insert-after' : 'drag-insert-before');
        }

        async function finalizeDrop() {
            if (!_draggedCard) { return; }
            if (_indicatorCard) {
                if (_insertAfter) { _indicatorCard.after(_draggedCard); }
                else { _indicatorCard.before(_draggedCard); }
            } else if (_originalNextSibling) {
                homepageGrid.insertBefore(_draggedCard, _originalNextSibling);
            }
            clearIndicator();
            homepageGrid.classList.remove('is-dragging');
            _draggedCard.classList.remove('dragging');
            _draggedCard = null;
            _originalNextSibling = null;
            _frozenCards = null;
            _rafPending = false;
            // save new order
            const newOrderIds = Array.from(homepageGrid.querySelectorAll('.homepage-card')).map(c => c.getAttribute('data-id'));
            localStorage.setItem('llms_sidebar_order', JSON.stringify(newOrderIds));
            models.sort((a, b) => newOrderIds.indexOf(a.id) - newOrderIds.indexOf(b.id));
            showToast('reorder saved');
        }

        function cancelDrag() {
            clearIndicator();
            homepageGrid.classList.remove('is-dragging');
            if (_draggedCard) { _draggedCard.classList.remove('dragging'); }
            _draggedCard = null;
            _frozenCards = null;
            _originalNextSibling = null;
            _rafPending = false;
        }

        function cleanupTouch() {
            if (_touchClone) { _touchClone.remove(); _touchClone = null; }
            _touchActive = false;
            _touchMoved = false;
        }

        function activateTouchDrag(card, cx, cy) {
            _touchActive = true;
            _draggedCard = card;
            _originalNextSibling = card.nextElementSibling;
            freezePositions(card);
            homepageGrid.classList.add('is-dragging');
            _touchClone = card.cloneNode(true);
            _touchClone.className = 'touch-drag-clone';
            const rect = card.getBoundingClientRect();
            _touchClone.style.width = rect.width + 'px';
            _touchClone.style.height = rect.height + 'px';
            _touchClone.style.left = (cx - rect.width / 2) + 'px';
            _touchClone.style.top = (cy - 40) + 'px';
            document.body.appendChild(_touchClone);
            card.classList.add('dragging');
            if (navigator.vibrate) { navigator.vibrate(25); }
            window._homepageIsDragging = true;
            showToast('drag to reorder, release to drop');
        }

        // enable drag mode - now activates immediately for touch
        function enableDragMode(card, _model) {
            // on touch devices, we just set up the state - actual drag starts on touchmove
            // on desktop, enable Sortable
            const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
            if (!isTouchDevice && window.homepageSortable) {
                window.homepageSortable.option('disabled', false);
            }
        }

        // Disable drag mode
        function disableDragMode(card) {
            window._homepageIsDragging = false;
            const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
            if (!isTouchDevice && window.homepageSortable) {
                window.homepageSortable.option('disabled', false);
            }
        }

        // color picker
        function showColorPicker(model, card) {
            const picker = document.createElement('input');
            picker.type = 'color';
            picker.value = getCardColor(model.id, model.baseColor);
            picker.style.cssText = 'position: fixed; top: -1000px;';
            
            picker.addEventListener('change', (e) => {
                const color = e.target.value;
                card.style.setProperty('--card-color', color);
                _saveCardColor(model.id, color);
                picker.remove();
            });

            document.body.appendChild(picker);
            picker.click();
        }

        // right click for desktop
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showCardContextMenu(e.clientX, e.clientY);
        });

        // long press for mobile
        let pressTimer;
        let pressTimerFired = false;
        let cardTouchMoved = false;
        let dragPrimed = false;
        let dragPrimeTimer = null;
        let touchStartX = 0, touchStartY = 0;

        const startPress = (e) => {
            // Only respond to single finger touch
            if (e.touches && e.touches.length > 1) { return; }

            pressTimerFired = false;
            cardTouchMoved = false;
            dragPrimed = false;

            const t = e.touches[0];
            touchStartX = t.clientX;
            touchStartY = t.clientY;

            // Start long-press timer for context menu
            pressTimer = setTimeout(() => {
                pressTimerFired = true;
                showCardContextMenu(0, 0, true);
                if (navigator.vibrate) { navigator.vibrate(50); }
            }, 600);

            // Start drag-prime timer (shorter than long-press)
            dragPrimeTimer = setTimeout(() => {
                dragPrimed = true;
            }, TOUCH_PRIME_MS);
        };

        const cancelPress = () => {
            clearTimeout(pressTimer);
            clearTimeout(dragPrimeTimer);
            dragPrimeTimer = null;
        };

        const handleTouchMove = (e) => {
            if (!e.touches || !e.touches[0]) { return; }
            const t = e.touches[0];
            const dx = t.clientX - touchStartX;
            const dy = t.clientY - touchStartY;
            const dist = Math.abs(dx) + Math.abs(dy);

            // Cancel long press if moved
            if (dist > TOUCH_MOVE_THRESHOLD) {
                cardTouchMoved = true;
                cancelPress();
            }

            // Handle drag activation
            if (!dragPrimed && !_touchActive) {
                if (dist > TOUCH_MOVE_THRESHOLD) {
                    // Moved before primed - cancel everything
                    clearTimeout(dragPrimeTimer);
                    dragPrimeTimer = null;
                    dragPrimed = false;
                }
                return;
            }

            if (dragPrimed && !_touchActive && window._homepageIsDragging) {
                // Prime met and move threshold exceeded - start drag
                if (dist > TOUCH_MOVE_THRESHOLD) {
                    activateTouchDrag(card, t.clientX, t.clientY);
                }
                return;
            }

            if (!_touchActive) { return; }

            // Active drag - update clone position and drop target
            e.preventDefault();
            _touchMoved = true;

            if (_touchClone) {
                const w = parseInt(_touchClone.style.width) || 100;
                _touchClone.style.left = (t.clientX - w / 2) + 'px';
                _touchClone.style.top = (t.clientY - 40) + 'px';
            }

            _lastCX = t.clientX;
            _lastCY = t.clientY;
            if (!_rafPending) {
                _rafPending = true;
                requestAnimationFrame(() => {
                    _rafPending = false;
                    updateDropTarget(_lastCX, _lastCY);
                });
            }
        };

        const handleTouchEnd = (e) => {
            cancelPress();
            clearTimeout(dragPrimeTimer);
            dragPrimeTimer = null;
            dragPrimed = false;

            // Handle active drag completion
            if (_touchActive) {
                if (_touchMoved) {
                    finalizeDrop();
                } else {
                    cancelDrag();
                }
                cleanupTouch();
                return;
            }

            // Don't navigate if we just finished a drag operation
            if (window._dragJustFinished) { return; }

            // Normal tap - navigate to model
            if (!cardTouchMoved && !pressTimerFired && !window._homepageIsDragging) {
                if (window._selectingModel) { return; }
                window._selectingModel = true;
                setTimeout(() => { window._selectingModel = false; }, 500);

                const currentModelId = model.id;
                cardTouchHandled = true;
                setTimeout(() => { cardTouchHandled = false; }, 500);
                selectModelById(currentModelId);
            }
        };

        // Attach touch handlers
        card.addEventListener('touchstart', startPress, { passive: true });
        card.addEventListener('touchmove', handleTouchMove, { passive: false });
        card.addEventListener('touchend', handleTouchEnd, { passive: true });
        card.addEventListener('touchcancel', () => {
            cancelPress();
            cancelDrag();
            cleanupTouch();
        }, { passive: true });

        // card already appended to homepageGrid above
    });

    // render open tabs as homepage cards
    renderHomepageTabs();

    // populate navBtns query variable based on newly created buttons
    navBtns = document.querySelectorAll('.nav-btn');
    // make homepage grid sortable for drag-reorder (only if Sortable is loaded)
    if (typeof Sortable !== 'undefined') {
        if (window.homepageSortable) {
            window.homepageSortable.destroy();
        }
        // Only enable drag-to-reorder on desktop (mouse), not on touch devices
        const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
        
        window.homepageSortable = Sortable.create(homepageGrid, {
            animation: 80,
            delay: isTouchDevice ? 150 : 0,
            delayOnTouchOnly: true,
            disabled: isTouchDevice,
            preventOnFilter: false,
            touchStartThreshold: 5,
            swapThreshold: 0.65,
            invertSwap: false,
            forceFallback: false,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            onStart: function() {
                window._homepageIsDragging = true;
                document.querySelectorAll('.homepage-card').forEach(c => {
                    c.dispatchEvent(new Event('touchend'));
                });
            },
            onEnd: function(_evt) {
                setTimeout(() => {
                    window._homepageIsDragging = false;
                }, 80);
                const newOrderIds = Array.from(homepageGrid.querySelectorAll('.homepage-card')).map(
                    (c) => c.getAttribute('data-id')
                );
                localStorage.setItem('llms_sidebar_order', JSON.stringify(newOrderIds));
                models.sort((a, b) => newOrderIds.indexOf(a.id) - newOrderIds.indexOf(b.id));
            }
        });
        
        // Ensure click events work properly on touch devices
        // by preventing Sortable from blocking them
        if (isTouchDevice && window.homepageSortable) {
            homepageGrid.style.touchAction = 'pan-y';
        }

        // Add grid-level auto-scroll for custom touch drag (copied from images app)
        if (isTouchDevice) {
            let _touchScrollTimer = null;
            const scrollThreshold = 60;
            const scrollSpeed = 6;

            homepageGrid.addEventListener('touchmove', (e) => {
                if (!_touchActive) { return; }
                const t = e.touches[0];
                clearInterval(_touchScrollTimer);
                if (t.clientY < scrollThreshold) {
                    _touchScrollTimer = setInterval(() => window.scrollBy(0, -scrollSpeed), 16);
                } else if (t.clientY > window.innerHeight - scrollThreshold) {
                    _touchScrollTimer = setInterval(() => window.scrollBy(0, scrollSpeed), 16);
                }
            }, { passive: false });

            homepageGrid.addEventListener('touchend', () => {
                clearInterval(_touchScrollTimer);
                _touchScrollTimer = null;
            }, { passive: true });
        }

        // adjust scaling in case number of cards changed
        fitHomepage();

        // initialize sortable on sidebarNav for mobile support
        if (window.sidebarSortable) {
            window.sidebarSortable.destroy(); // cleanup if re-rendering
        }
        window.sidebarSortable = Sortable.create(sidebarNav, {
            animation: 150,
            delay: 100, // short delay to distinguish drag from click
            delayOnTouchOnly: true, // only delay on touch devices
            ghostClass: 'drag-ghost',
            chosenClass: 'chosen',
            onEnd: function (_evt) {
                // save new order
                const newOrderIds = Array.from(sidebarNav.querySelectorAll('.nav-btn')).map((b) =>
                    b.getAttribute('data-id')
                );
                localStorage.setItem('llms_sidebar_order', JSON.stringify(newOrderIds));

                // visually reorder homepage grid to match
                models.sort((a, b) => newOrderIds.indexOf(a.id) - newOrderIds.indexOf(b.id));
                models.forEach((m) => {
                    const matchedCard = homepageGrid.querySelector(`[data-id="${m.id}"]`);
                    if (matchedCard) {
                        homepageGrid.appendChild(matchedCard);
                    }
                });

                // update navBtns NodeList to reflect new order
                navBtns = document.querySelectorAll('.nav-btn');
            }
        });
    } else {
        // sortable.js not available (e.g. unit tests), skip drag features
        fitHomepage();
    }
}

// prompt management
function getSystemPrompt() {
    return localStorage.getItem('llms_system_prompt') || defaultPrompt;
}

function saveSystemPrompt(prompt) {
    localStorage.setItem('llms_system_prompt', prompt.toLowerCase());
}

// settings modal interactions
openSettingsBtn.addEventListener('click', () => {
    systemPromptText.value = getSystemPrompt();
    // hide any active webview/browserview so modal appears above
    if (window.electronAPI) {
        window.electronAPI.hideAllSites();
    }
    settingsModal.classList.remove('hidden');
    settingsModal.classList.add('flex');
    showPromptTab(); // default to prompt tab
});

closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    settingsModal.classList.remove('flex');
});

savePromptBtn.addEventListener('click', () => {
    saveSystemPrompt(systemPromptText.value);
    settingsModal.classList.add('hidden');
    settingsModal.classList.remove('flex');
    showToast('system prompt saved');
});

resetPromptBtn.addEventListener('click', () => {
    systemPromptText.value = defaultPrompt;
});

// settings tab switching
const promptTabBtn = document.getElementById('prompt-tab-btn');
const offlineTabBtn = document.getElementById('offline-tab-btn');
const promptSection = document.getElementById('prompt-section');
const offlineSection = document.getElementById('offline-section');

function showPromptTab() {
    promptSection.classList.remove('hidden');
    offlineSection.classList.add('hidden');
    promptTabBtn.classList.add('text-secondary', 'border-b-2', 'border-secondary', 'bg-white/5');
    promptTabBtn.classList.remove('text-gray-400');
    offlineTabBtn.classList.remove('text-secondary', 'border-b-2', 'border-secondary', 'bg-white/5');
    offlineTabBtn.classList.add('text-gray-400');
}

function showOfflineTab() {
    promptSection.classList.add('hidden');
    offlineSection.classList.remove('hidden');
    offlineTabBtn.classList.add('text-secondary', 'border-b-2', 'border-secondary', 'bg-white/5');
    offlineTabBtn.classList.remove('text-gray-400');
    promptTabBtn.classList.remove('text-secondary', 'border-b-2', 'border-secondary', 'bg-white/5');
    promptTabBtn.classList.add('text-gray-400');
    updateOfflineSettingsUI();
}

promptTabBtn?.addEventListener('click', showPromptTab);
offlineTabBtn?.addEventListener('click', showOfflineTab);

// offline settings UI elements
const llamaOfflineToggle = document.getElementById('llama-offline-toggle');
const offlineOfferToggle = document.getElementById('offline-offer-toggle');
const downloadLlamaBtn = document.getElementById('download-llama-btn');
const deleteLlamaBtn = document.getElementById('delete-llama-btn');
const resetOfflineSettingsBtn = document.getElementById('reset-offline-settings-btn');
const llamaDownloadedStatus = document.getElementById('llama-downloaded-status');
const llamaModelSize = document.getElementById('llama-model-size');
const llamaStorageUsed = document.getElementById('llama-storage-used');
const llamaDownloadProgress = document.getElementById('llama-download-progress');
const llamaProgressBar = document.getElementById('llama-progress-bar');
const llamaDownloadPercent = document.getElementById('llama-download-percent');

function updateOfflineSettingsUI() {
    if (typeof llamaOfflineManager === 'undefined') {
        llamaDownloadedStatus.textContent = 'not available';
        llamaDownloadedStatus.className = 'text-gray-500';
        downloadLlamaBtn.disabled = true;
        deleteLlamaBtn.disabled = true;
        return;
    }
    
    const manager = llamaOfflineManager;
    const settings = manager.getSettings();
    const status = manager.modelStatus;
    
    // Update toggle states
    llamaOfflineToggle.checked = settings.enabled;
    offlineOfferToggle.checked = settings.offerEnabled;
    
    // Update model status
    if (status.downloaded) {
        llamaDownloadedStatus.textContent = 'yes';
        llamaDownloadedStatus.className = 'text-green-400';
        llamaModelSize.textContent = status.modelSize || '~800 MB';
        llamaStorageUsed.textContent = status.storageUsed || status.modelSize || '~800 MB';
        downloadLlamaBtn.disabled = true;
        deleteLlamaBtn.disabled = false;
    } else {
        llamaDownloadedStatus.textContent = 'no';
        llamaDownloadedStatus.className = 'text-red-400';
        llamaModelSize.textContent = '-';
        llamaStorageUsed.textContent = '-';
        downloadLlamaBtn.disabled = !manager.isApkVariant;
        deleteLlamaBtn.disabled = true;
    }
}

// Llama offline toggle
llamaOfflineToggle?.addEventListener('change', () => {
    if (typeof llamaOfflineManager !== 'undefined') {
        const manager = llamaOfflineManager;
        const newEnabled = llamaOfflineToggle.checked;
        manager.saveSettings({ enabled: newEnabled });
        showToast(newEnabled ? 'llama offline enabled' : 'llama offline disabled');
    }
});

// Offline offer toggle
offlineOfferToggle?.addEventListener('change', () => {
    const settings = JSON.parse(localStorage.getItem('llms_offline_llama_settings') || '{}');
    settings.offerEnabled = offlineOfferToggle.checked;
    localStorage.setItem('llms_offline_llama_settings', JSON.stringify(settings));
    showToast(offlineOfferToggle.checked ? 'offline offers enabled' : 'offline offers disabled');
});

// Tools system UI elements
const toolsTabBtn = document.getElementById('tools-tab-btn');
const toolsSection = document.getElementById('tools-section');
const toolsEnabledToggle = document.getElementById('tools-enabled-toggle');
const toolsList = document.getElementById('tools-list');
const mcpUrlInput = document.getElementById('mcp-url-input');
const mcpKeyInput = document.getElementById('mcp-key-input');
const n8nKeyInput = document.getElementById('n8n-key-input');
const generateMcpKeyBtn = document.getElementById('generate-mcp-key-btn');
const generateNocobaseKeyBtn = document.getElementById('generate-nocobase-key-btn');
const generateN8nKeyBtn = document.getElementById('generate-n8n-key-btn');
const generatedKeysDisplay = document.getElementById('generated-keys-display');

// Tools tab switching
toolsTabBtn?.addEventListener('click', () => {
    // Hide all sections
    document.getElementById('prompt-section').classList.add('hidden');
    document.getElementById('offline-section').classList.add('hidden');
    toolsSection.classList.remove('hidden');
    
    // Update tab buttons
    document.getElementById('prompt-tab-btn').classList.remove('text-secondary', 'border-b-2', 'border-secondary', 'bg-white/5');
    document.getElementById('prompt-tab-btn').classList.add('text-gray-400');
    document.getElementById('offline-tab-btn').classList.remove('text-secondary', 'border-b-2', 'border-secondary', 'bg-white/5');
    document.getElementById('offline-tab-btn').classList.add('text-gray-400');
    toolsTabBtn.classList.remove('text-gray-400');
    toolsTabBtn.classList.add('text-secondary', 'border-b-2', 'border-secondary', 'bg-white/5');
    
    updateToolsUI();
});

// Tools enabled toggle
toolsEnabledToggle?.addEventListener('change', () => {
    if (toolsManager) {
        const enabled = toolsEnabledToggle.checked;
        if (enabled) {
            toolsManager.enableTools();
        } else {
            toolsManager.disableTools();
        }
        showToast(enabled ? 'tools enabled for local models' : 'tools disabled');
    }
});

// Generate API key buttons
generateMcpKeyBtn?.addEventListener('click', () => {
    if (toolsManager) {
        const key = toolsManager.generateApiKey('mcp');
        updateGeneratedKeysDisplay();
        showToast('mcp api key generated');
        navigator.clipboard.writeText(key);
    }
});

generateNocobaseKeyBtn?.addEventListener('click', () => {
    if (toolsManager) {
        const key = toolsManager.generateApiKey('nocobase');
        updateGeneratedKeysDisplay();
        showToast('nocobase api key generated');
        navigator.clipboard.writeText(key);
    }
});

generateN8nKeyBtn?.addEventListener('click', () => {
    if (toolsManager) {
        const key = toolsManager.generateApiKey('n8n');
        updateGeneratedKeysDisplay();
        showToast('n8n api key generated');
        navigator.clipboard.writeText(key);
    }
});

// Save tool API keys
mcpUrlInput?.addEventListener('change', () => {
    const keys = getApiKeys();
    keys.mcpUrl = mcpUrlInput.value;
    saveApiKeys(keys);
});

mcpKeyInput?.addEventListener('change', () => {
    const keys = getApiKeys();
    keys.mcp = mcpKeyInput.value;
    saveApiKeys(keys);
});

n8nKeyInput?.addEventListener('change', () => {
    const keys = getApiKeys();
    keys.n8n = n8nKeyInput.value;
    saveApiKeys(keys);
});

function updateToolsUI() {
    if (typeof toolsManager !== 'undefined' && !toolsManager && typeof initializeToolsSystem === 'function') {
        initializeToolsSystem();
    }
    
    if (typeof toolsManager !== 'undefined' && toolsManager) {
        toolsEnabledToggle.checked = toolsManager.enabled;
        
        // Update tools list
        const tools = toolsManager.getToolDefinitions();
        toolsList.innerHTML = tools.map(tool => `
            <div class="flex items-center justify-between p-3 bg-black/30 rounded-lg border border-gray-700">
                <div class="flex-1">
                    <div class="text-sm font-medium text-white">${tool.name}</div>
                    <div class="text-xs text-gray-400">${tool.description}</div>
                    <div class="text-xs text-gray-500 mt-1">type: ${tool.type}</div>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" class="tool-toggle sr-only peer" data-tool-id="${tool.id}" ${tool.enabled ? 'checked' : ''}>
                    <div class="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-secondary"></div>
                </label>
            </div>
        `).join('');
        
        // Add event listeners to tool toggles
        toolsList.querySelectorAll('.tool-toggle').forEach(toggle => {
            toggle.addEventListener('change', (e) => {
                const toolId = e.target.dataset.toolId;
                const tool = toolsManager.tools.get(toolId);
                if (tool) {
                    tool.enabled = e.target.checked;
                    showToast(`${tool.name} ${e.target.checked ? 'enabled' : 'disabled'}`);
                }
            });
        });
        
        // Update API key inputs
        const keys = getApiKeys();
        mcpUrlInput.value = keys.mcpUrl || '';
        mcpKeyInput.value = keys.mcp || '';
        if (typeof nocobaseUrlInput !== 'undefined') {
            const nbConfig = getNocoBaseConfig();
            nocobaseUrlInput.value = keys.nocobaseUrl || nbConfig.url || '';
        }
        if (typeof nocobaseKeyInput !== 'undefined') {
            nocobaseKeyInput.value = keys.nocobase || '';
        }
        n8nKeyInput.value = keys.n8n || '';
        
        updateGeneratedKeysDisplay();
    }
}

function updateGeneratedKeysDisplay() {
    if (toolsManager) {
        const keys = toolsManager.generatedKeys;
        const keysHtml = Object.entries(keys).map(([service, key]) => `
            <div class="p-2 bg-black/30 rounded border border-gray-700">
                <div class="text-xs text-gray-400">${service}:</div>
                <div class="text-xs font-mono text-secondary break-all">${key}</div>
            </div>
        `).join('');
        
        generatedKeysDisplay.innerHTML = keysHtml || '<div class="text-gray-500">no keys generated yet</div>';
    }
}

// Download Llama model
downloadLlamaBtn?.addEventListener('click', async () => {
    if (typeof llamaOfflineManager === 'undefined') {
        showToast('llama offline not available');
        return;
    }
    
    const manager = llamaOfflineManager;
    if (!manager.isApkVariant) {
        showToast('download only available in apk version');
        return;
    }
    
    llamaDownloadProgress.classList.remove('hidden');
    downloadLlamaBtn.disabled = true;
    
    try {
        await manager.downloadModel((progress) => {
            llamaProgressBar.style.width = `${progress}%`;
            llamaDownloadPercent.textContent = `${progress}%`;
        });
        
        showToast('model downloaded successfully');
        updateOfflineSettingsUI();
        
        // Initialize inference engine
        await manager.initInferenceEngine();
        showToast('llama offline ready to use');
    } catch (error) {
        dlog.error('failed to download llama model:', error);
        showToast('download failed: ' + error.message);
        downloadLlamaBtn.disabled = false;
    } finally {
        llamaDownloadProgress.classList.add('hidden');
        llamaProgressBar.style.width = '0%';
        llamaDownloadPercent.textContent = '0%';
    }
});

// Delete Llama model
deleteLlamaBtn?.addEventListener('click', async () => {
    if (typeof llamaOfflineManager === 'undefined') {
        showToast('llama offline not available');
        return;
    }
    
    if (!confirm('are you sure you want to delete the gemma model?')) {
        return;
    }
    
    const manager = llamaOfflineManager;
    try {
        await manager.deleteModel();
        showToast('model deleted');
        updateOfflineSettingsUI();
    } catch (error) {
        dlog.error('failed to delete gemma model:', error);
        showToast('delete failed: ' + error.message);
    }
});

// Reset offline settings
resetOfflineSettingsBtn?.addEventListener('click', () => {
    localStorage.removeItem('llms_offline_llama_settings');
    localStorage.removeItem('llms_llama_model_status');
    showToast('offline settings reset');
    updateOfflineSettingsUI();
});

// Update offline UI when opening settings
openSettingsBtn?.addEventListener('click', () => {
    systemPromptText.value = getSystemPrompt();
    settingsModal.classList.remove('hidden');
    settingsModal.classList.add('flex');
    // hide any active webview/browserview so modal appears above
    if (window.electronAPI) {
        window.electronAPI.hideAllSites();
    }
    showPromptTab(); // default to prompt tab
    // populate api keys and nocobase url
    populateApiModal();
});

// modal bg click to close
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        settingsModal.classList.add('hidden');
        settingsModal.classList.remove('flex');
    }
});

// copy prompt functionality
let toastTimeout = null;
function showToast(message) {
    // clear any existing timeout to prevent stacking
    if (toastTimeout) {
        clearTimeout(toastTimeout);
    }
    toast.textContent = message;
    toast.classList.add('toast-show');
    toastTimeout = setTimeout(() => {
        toast.classList.remove('toast-show');
        toastTimeout = null;
    }, 3000);
}

async function openAndroidOverlay(url, title = '') {
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
            if (window.AndroidBridge && typeof window.AndroidBridge.openUrl === 'function') {
                window.AndroidBridge.openUrl(url, title);
                return true;
            }
        } catch (err) {
            dlog.error('AndroidBridge.openUrl failed', err);
        }
        await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }
    return false;
}

// api chat functionality
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// validate data URL to prevent XSS
function isValidDataUrl(url) {
    if (!url || typeof url !== 'string') {
        return false;
    }
    // only allow image mime types with base64 encoding
    const validPattern = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[a-zA-Z0-9+/=]+$/;
    return validPattern.test(url);
}

// fetch with timeout to prevent hanging requests
async function fetchWithTimeout(url, options = {}, timeout = 60000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        return response;
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error(`request timeout after ${timeout / 1000}s`);
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

function renderMessage(content) {
    // handle html rendering; do not forcibly lowercase so we don't corrupt data urls or code
    let text = content;
    // escape html first
    text = escapeHtml(text);
    // convert image markdown into clickable <img> tags with validation
    text = text.replace(/!\[[^\]]*\]\((data:[^)]+)\)/g, (m, src) => {
        // validate the data URL before injecting
        if (!isValidDataUrl(src)) {
            return '<span class="text-red-400">[invalid image]</span>';
        }
        // escape the src for safe attribute injection
        const escapedSrc = escapeHtml(src);
        // add class so caller can attach listener after element exists
        return `<img src="${escapedSrc}" class="max-w-full rounded-lg my-2 cursor-pointer hover:opacity-90 transition-opacity llms-image" />`;
    });
    // convert code fences into collapsible blocks (collapsed by default)
    text = text.replace(/```([\s\S]*?)```/g, (m, code) => {
        const escapedCode = escapeHtml(code);
        const lines = escapedCode.trim().split('\n');
        const firstLine = lines[0].trim();
        const lang = firstLine.length < 20 ? firstLine : 'code';
        const displayCode = firstLine.length < 20 ? lines.slice(1).join('\n') : escapedCode;
        // substring instead of deprecated `substr`
        const id = 'code-' + Math.random().toString(36).substring(2, 11);
        return `
            <div class="bg-[#222] rounded-lg my-2 overflow-hidden">
                <div class="flex items-center justify-between px-3 py-2 bg-[#333] cursor-pointer" onclick="toggleCodeBlock('${id}')">
                    <span class="text-xs text-primary font-mono">${lang}</span>
                    <button class="text-xs text-gray-400 hover:text-white flex items-center gap-1">
                        <span id="${id}-icon">▼</span>
                        <span id="${id}-text">show</span>
                    </button>
                </div>
                <pre id="${id}" class="hidden whitespace-pre-wrap p-3 bg-[#111] text-sm font-mono overflow-x-auto">${displayCode}</pre>
            </div>`;
    });
    return text;
}

// toggle code block visibility
/* eslint-disable no-unused-vars */
function toggleCodeBlock(id) {
    const block = document.getElementById(id);
    const icon = document.getElementById(id + '-icon');
    const text = document.getElementById(id + '-text');
    if (block.classList.contains('hidden')) {
        block.classList.remove('hidden');
        icon.textContent = '▲';
        text.textContent = 'hide';
    } else {
        block.classList.add('hidden');
        icon.textContent = '▼';
        text.textContent = 'show';
    }
}
/* eslint-enable no-unused-vars */

// open image viewer
function openImageViewer(src) {
    const modal = document.getElementById('viewer-modal');
    const content = document.getElementById('viewer-content');
    const saveBtn = document.getElementById('save-image-btn');

    content.innerHTML = `<img src="${src}" class="max-w-full h-auto" style="max-height: 80vh;" />`;
    saveBtn.classList.remove('hidden');
    saveBtn.onclick = () => downloadImage(src);

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

// open message viewer for text enlargement
function openMessageViewer(content) {
    const modal = document.getElementById('viewer-modal');
    const viewerContent = document.getElementById('viewer-content');
    const saveBtn = document.getElementById('save-image-btn');

    // render the content
    viewerContent.innerHTML = `<div class="text-white text-lg leading-relaxed">${renderMessage(content)}</div>`;
    saveBtn.classList.add('hidden');

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

// download/save image
function downloadImage(src) {
    try {
        const link = document.createElement('a');
        link.href = src;
        link.download = 'generated-image-' + Date.now() + '.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('image saved');
    } catch (e) {
        dlog.error('downloadImage failed', e);
        showToast('failed to save image');
    }
}

// close viewer
function closeViewer() {
    const modal = document.getElementById('viewer-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function appendMessage(role, content, saveToChat = true) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `p-4 my-2 rounded-2xl max-w-[85%] ${role === 'user' ? 'bg-primary/20 text-white self-end border border-primary/30 rounded-br-sm' : 'bg-white/5 text-gray-200 self-start border border-white/10 rounded-bl-sm'} leading-relaxed cursor-pointer hover:opacity-90 transition-opacity`;
    msgDiv.innerHTML = renderMessage(content);
    msgDiv.dataset.role = role;
    msgDiv.dataset.content = content;

    // tap to enlarge any message
    msgDiv.addEventListener('click', (e) => {
        // don't open viewer if clicking on a link, button, or image (image has its own handler)
        if (
            e.target.tagName === 'A' ||
            e.target.tagName === 'BUTTON' ||
            e.target.tagName === 'IMG' ||
            e.target.closest('button')
        ) {
            return;
        }
        openMessageViewer(content);
    });

    // add context menu for user messages
    if (role === 'user') {
        msgDiv.title = 'tap to enlarge, right-click/long-press to edit/resend';
        msgDiv.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showMessageContextMenu(e, content);
        });
        // long press for mobile
        let pressTimer;
        msgDiv.addEventListener('touchstart', (e) => {
            pressTimer = setTimeout(() => {
                showMessageContextMenu(e, content);
            }, 800);
        });
        msgDiv.addEventListener('touchend', () => clearTimeout(pressTimer));
    } else {
        msgDiv.title = 'tap to enlarge';
    }

    chatMessages.appendChild(msgDiv);
    // attach click handlers to any images we inserted (avoid inline onclicks)
    msgDiv.querySelectorAll('img.llms-image').forEach((img) => {
        img.addEventListener('click', () => openImageViewer(img.src));
    });

    // auto scroll to show new message (scroll to message top, not bottom)
    requestAnimationFrame(() => {
        const msgTop = msgDiv.offsetTop;
        const containerHeight = chatMessages.clientHeight;
        // use scrolltop for better compatibility than scrollto with options object
        chatMessages.scrollTop = msgTop - containerHeight + msgDiv.offsetHeight + 50;
    });

    // save to current chat if applicable
    if (saveToChat && currentChatId && chats[currentChatId]) {
        chats[currentChatId].messages.push({ role: role, content: content });
        // trim stored chat length as well
        if (chats[currentChatId].messages.length > MAX_STORED_CHAT_MESSAGES) {
            while (chats[currentChatId].messages.length > MAX_STORED_CHAT_MESSAGES) {
                chats[currentChatId].messages.shift();
            }
        }

        // generate title from first message if not set
        if (chats[currentChatId].title === 'new chat' && role === 'user') {
            chats[currentChatId].title = generateChatTitle(chats[currentChatId].messages);
            renderChatList();
        }
        saveChats();
    }
}

injectPromptApiBtn.addEventListener('click', () => {
    const p = getSystemPrompt();
    if (!apiChatInput.value.includes(p)) {
        apiChatInput.value = p + '\\n\\n' + apiChatInput.value;
    }
});

// pending message storage for retry after API key entry
let pendingMessage = null;

async function sendApiMessage() {
    const text = apiChatInput.value.trim();
    if (!text) {
        return;
    }

    // check for API key before clearing input
    const keys = getApiKeys();
    
    if (currentApiMode === 'openrouter-api') {
        // openrouter can work without key for free models, but we'll warn
        // the free tier is rate-limited but functional
        if (!keys.openrouter) {
            // store message and show key prompt
            pendingMessage = text;
            showToast('openrouter: using free tier (rate limited)');
            // continue without key for free models - openrouter supports this
        }
    } else if (currentApiMode === 'huggingface-api') {
        if (!keys.huggingface) {
            pendingMessage = text;
            showHuggingfaceKeyPrompt();
            return;
        }
    } else if (currentApiMode === 'deepseek-api') {
        if (!keys.deepseek) {
            pendingMessage = text;
            showDeepseekKeyPrompt();
            return;
        }
    } else if (currentApiMode === 'mistral-api') {
        if (!keys.mistral) {
            pendingMessage = text;
            showMistralKeyPrompt();
            return;
        }
    } else if (currentApiMode === 'gemini-api' || currentApiMode === 'nano-banana-pro') {
        if (!keys.gemini) {
            pendingMessage = text;
            showGeminiKeyPrompt();
            return;
        }
    }

    apiChatInput.value = '';
    await processApiMessage(text);
}

// internal function to actually send the message after key checks
async function processApiMessage(text) {
    if (!text) {
        return;
    }

    // initialize tools system if not already done (guard against missing tools-system.js)
    if (typeof toolsManager !== 'undefined' && !toolsManager && typeof initializeToolsSystem === 'function') {
        initializeToolsSystem();
    }

    // process message for tool calls if tools are enabled and using local model
    let processedText = text;
    if (typeof toolsManager !== 'undefined' && toolsManager && toolsManager.enabled && currentApiMode === 'llama-offline') {
        try {
            processedText = await toolsManager.processMessage(text);
            if (processedText !== text) {
                console.log('[tools] message processed for tool calls');
            }
        } catch (error) {
            console.error('[tools] failed to process message:', error);
            // continue with original text if tools processing fails
        }
    }

    // if first message, silently prepend system prompt to history if it wasn't injected manually
    if (chatHistory.length === 0 && !processedText.includes(getSystemPrompt())) {
        chatHistory.push({ role: 'system', content: getSystemPrompt() });
    }

    appendMessage('user', processedText);
    chatHistory.push({ role: 'user', content: processedText });
    trimChatHistory();

    // show loading indicator
    const loadingId = 'loading-' + Date.now();
    const loadingDiv = document.createElement('div');
    loadingDiv.id = loadingId;
    loadingDiv.className =
        'p-4 my-2 rounded-2xl max-w-[85%] bg-white/5 text-gray-400 self-start border border-white/10 rounded-bl-sm italic';
    loadingDiv.textContent = 'thinking...';
    chatMessages.appendChild(loadingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
        const keys = getApiKeys();
        let responseContent = '';
        let assistantMsgDiv = null;

        // helper for streaming
        function setupStreamContainer() {
            assistantMsgDiv = document.createElement('div');
            assistantMsgDiv.className =
                'p-4 my-2 rounded-2xl max-w-[85%] bg-white/5 text-gray-200 self-start border border-white/10 rounded-bl-sm leading-relaxed';
            assistantMsgDiv.innerHTML = '';
            chatMessages.appendChild(assistantMsgDiv);
            requestAnimationFrame(() => {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            });
        }

        if (currentApiMode === 'openrouter-api') {
            const key = keys.openrouter;
            // allow empty key for free models, but warn user
            const selectedModel = getActiveOpenrouterModel() || DEFAULT_OPENROUTER_MODEL;
            
            // if no key and not using a free model, default to free
            if (!key && !selectedModel.includes('free')) {
                showToast('no api key set - switching to free model');
                saveOpenrouterModel('openrouter/free');
            }
            // build headers - auth only if key exists (free models don't need it)
            const headers = {
                'HTTP-Referer': 'https://example.com',
                'X-Title': 'LLMs Aggregator',
                'Content-Type': 'application/json'
            };
            if (key) {
                headers.Authorization = `Bearer ${key}`;
            }
            // try streaming with 120s timeout for long responses
            const res = await fetchWithTimeout(
                'https://openrouter.ai/api/v1/chat/completions',
                {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        model: selectedModel,
                        messages: chatHistory,
                        stream: true
                    })
                },
                120000
            );
            if (!res.ok) {
                const errBody = await res.text().catch(() => '');
                throw new Error(`openrouter error ${res.status}: ${errBody.substring(0, 200)}`);
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            setupStreamContainer();
            let sseBuffer = '';
            let done = false;
            while (!done) {
                const { value, done: d } = await reader.read();
                done = d;
                if (value) {
                    sseBuffer += decoder.decode(value, { stream: true });
                    // parse SSE lines to extract actual content
                    const lines = sseBuffer.split('\n');
                    sseBuffer = lines.pop(); // keep incomplete line in buffer
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || !trimmed.startsWith('data: ')) {
                            continue;
                        }
                        const data = trimmed.slice(6);
                        if (data === '[DONE]') {
                            continue;
                        }
                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.delta?.content;
                            if (content) {
                                responseContent += content;
                            }
                        } catch (_e) {
                            // skip malformed SSE lines
                        }
                    }
                    assistantMsgDiv.innerHTML = renderMessage(responseContent);
                    requestAnimationFrame(() => {
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                    });
                }
            }
} else if (currentApiMode === 'llama-offline') {
    // Check if native Android bridge is available for APK variant
    const isAndroidApk = typeof window.AndroidBridge !== 'undefined';
    let serverRunning = false;
    let needsDownload = false;

    if (isAndroidApk) {
      // Check server status via AndroidBridge (LlamaServerService)
      const status = window.AndroidBridge.getLlamaServerStatus();
      console.log('[llms] Android Llama server status:', status);
      serverRunning = status === 'running';
      needsDownload = status === 'no_model' || status === 'not_bound';
    } else if (typeof llamaOfflineManager !== 'undefined') {
      // Sync model status from native plugin for Capacitor builds
      if (llamaOfflineManager.isApkVariant) {
        await llamaOfflineManager.syncModelStatusFromPlugin();
      }
      if (llamaOfflineManager.modelStatus?.downloaded) {
        serverRunning = true;
      } else if (llamaOfflineManager.isApkVariant) {
        needsDownload = true;
      }
    }

    if (isAndroidApk && needsDownload) {
      // Trigger download via AndroidBridge
      showToast('downloading gemma model (~2.9GB)... please wait');
      window.AndroidBridge.startLlamaModelDownload();
      throw new Error('model download started. please wait for it to complete, then try again.');
    }

    if (serverRunning) {
      // Connect to llama-server running on Android at port 5053
      const baseUrl = 'http://127.0.0.1:5053';

      // Format messages for llama-server (OpenAI-compatible API)
      const llamaMessages = chatHistory.map(msg => {
        if (msg.role !== 'system') {
          return { role: msg.role, content: msg.content };
        }
        return { role: 'system', content: msg.content + '\n\nYou are gemma 4 4b by google. Do not prepend any word to your response.' };
      });

      const res = await fetchWithTimeout(
        `${baseUrl}/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: llamaMessages,
            temperature: 0.7,
            max_tokens: 1024,
            stream: false
          })
        },
        120000
      );

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`local LLM error ${res.status}: ${errBody.substring(0, 200)}`);
      }

      const data = await res.json();
      responseContent = data.choices?.[0]?.message?.content || '';
    } else if (!isAndroidApk) {
      // Fall back to HTTP Ollama API (for desktop/browser testing)
      const llamaModel = getModelById('llama-offline');
      const baseUrl = (llamaModel?.url || 'http://127.0.0.1:11434').replace(/\/$/, '');

      // Get available models from Ollama
      let selectedModel = localStorage.getItem('llms_ollama_model') || '';
      if (!selectedModel) {
        try {
          const tagsRes = await fetchWithTimeout(`${baseUrl}/api/tags`, { method: 'GET' }, 10000);
          if (tagsRes.ok) {
            const tagsData = await tagsRes.json();
            if (tagsData.models && tagsData.models.length > 0) {
              selectedModel = tagsData.models[0].name;
              localStorage.setItem('llms_ollama_model', selectedModel);
            }
          }
        } catch (e) {
          console.log('[llms] could not fetch Ollama models:', e.message);
        }
      }
      if (!selectedModel) {
        throw new Error('no Ollama model found. Make sure Ollama is running and has a model downloaded.');
      }

      const ollamaMessages = chatHistory.map(msg => {
      if (msg.role !== 'user') {
        return { role: msg.role, content: msg.content };
      }
      // Check for image markdown in user messages
      const imgMatch = msg.content.match(/!\[[^\]]*\]\((data:[^)]+)\)/);
      if (imgMatch) {
        const textContent = msg.content.replace(/!\[[^\]]*\]\((data:[^)]+)\)/g, '').trim();
        const base64Data = imgMatch[1].split(',')[1]; // Remove data:image/xxx;base64, prefix
        return {
          role: msg.role,
          content: textContent || 'what is in this image?',
          images: [base64Data]
        };
      }
      return { role: msg.role, content: msg.content };
    });

    // use non-streaming for reliability (streaming can fail silently on some WebViews)
    const res = await fetchWithTimeout(
      `${baseUrl}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: ollamaMessages,
          stream: false
        })
      },
      120000
    );
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`ollama error ${res.status}: ${errBody.substring(0, 200)}`);
    }
    const data = await res.json();
    responseContent = data.message?.content || data.response || '';
  }
        } else if (currentApiMode === 'huggingface-api') {
            const key = keys.huggingface;
            if (!key) {
                throw new Error('huggingface api key not set');
            }
            const hfDropdown = document.getElementById('hf-model-dropdown');
            const selectedModel = hfDropdown?.value || 'meta-llama/Meta-Llama-3-8B-Instruct';
            const res = await fetchWithTimeout(
                `https://api-inference.huggingface.co/models/${selectedModel}/v1/chat/completions`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${key}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: selectedModel,
                        messages: chatHistory,
                        max_tokens: 1000
                    })
                },
                90000
            );
            if (!res.ok) {
                const errBody = await res.text().catch(() => '');
                throw new Error(`huggingface error ${res.status}: ${errBody.substring(0, 200)}`);
            }
            const data = await res.json();
            responseContent = data.choices?.[0]?.message?.content || 'no content';
        } else if (currentApiMode === 'deepseek-api') {
            const key = keys.deepseek;
            if (!key) {
                throw new Error('deepseek api key not set');
            }
            const selectedModel = 'deepseek-chat';
            const res = await fetchWithTimeout(
                'https://api.deepseek.com/v1/chat/completions',
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${key}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: selectedModel,
                        messages: chatHistory,
                        stream: false
                    })
                },
                60000
            );
            if (!res.ok) {
                const errBody = await res.text().catch(() => '');
                throw new Error(`deepseek error ${res.status}: ${errBody.substring(0, 200)}`);
            }
            const data = await res.json();
            responseContent = data.choices?.[0]?.message?.content || 'no content';
        } else if (currentApiMode === 'mistral-api') {
            const key = keys.mistral;
            if (!key) {
                throw new Error('mistral api key not set');
            }
            const selectedModel = 'mistral-tiny';
            const res = await fetchWithTimeout(
                'https://api.mistral.ai/v1/chat/completions',
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${key}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: selectedModel,
                        messages: chatHistory,
                        stream: false
                    })
                },
                60000
            );
            if (!res.ok) {
                const errBody = await res.text().catch(() => '');
                throw new Error(`mistral error ${res.status}: ${errBody.substring(0, 200)}`);
            }
            const data = await res.json();
            responseContent = data.choices?.[0]?.message?.content || 'no content';
        } else if (currentApiMode === 'gemini-api') {
            const key = keys.gemini;
            if (!key) {
                throw new Error('gemini api key not set');
            }
            const selectedModel = 'gemini-3.0-flash-exp';
            const res = await fetchWithTimeout(
                `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${key}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: text }] }]
                    })
                },
                60000
            );
            if (!res.ok) {
                const errBody = await res.text().catch(() => '');
                throw new Error(`gemini error ${res.status}: ${errBody.substring(0, 200)}`);
            }
            const data = await res.json();
            responseContent = data.candidates?.[0]?.content?.parts?.[0]?.text || 'no content';
        } else if (currentApiMode === 'nano-banana-pro') {
            const key = keys.gemini;
            if (!key) {
                throw new Error('gemini api key not set');
            }
            const geminiDropdown = document.getElementById('gemini-model-dropdown');
            const selectedModel = geminiDropdown?.value || 'gemini-3-pro-image-preview';

            // get the last user message for enhancement
            const lastUserMsg = chatHistory.filter((m) => m.role === 'user').pop();
            let enhancedPrompt = lastUserMsg?.content || '';

            // prompt enhancement for image generation models (not veo)
            if (lastUserMsg && !selectedModel.includes('veo')) {
                appendMessage(
                    'assistant',
                    '*enhancing prompt with gemini-3.1-pro-preview...*',
                    false
                );

                const enhancementRes = await fetchWithTimeout(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${key}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [
                                {
                                    role: 'user',
                                    parts: [
                                        {
                                            text: `Enhance and perfect this image generation prompt. Make it more detailed, descriptive, and optimized for an AI image model. Add artistic direction, lighting, composition, and style details. Return ONLY the enhanced prompt, nothing else.

Original prompt: "${lastUserMsg.content}"`
                                        }
                                    ]
                                }
                            ],
                            generationConfig: {
temperature: 0.3,
                                maxOutputTokens: 1024
                            }
                        })
                    },
                    60000
                );

                if (enhancementRes.ok) {
                    const enhancementData = await enhancementRes.json();
                    const enhanced = enhancementData.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (enhanced) {
                        enhancedPrompt = enhanced.trim();
                        // remove the enhancement message
                        chatMessages.lastElementChild?.remove();
                        appendMessage(
                            'assistant',
                            `*enhanced prompt:* ${enhancedPrompt.substring(0, 100)}${enhancedPrompt.length > 100 ? '...' : ''}`,
                            false
                        );
                    }
                }
            }

            // convert chatHistory to gemini format with enhanced prompt
            const contents = [];
            chatHistory.forEach((msg) => {
                if (msg.role === 'system') {
                    return;
                } // skip system prompt
                const role = msg.role === 'user' ? 'user' : 'model';

                // use enhanced prompt for the last user message
                let msgContent = msg.content;
                if (msg.role === 'user' && msg === lastUserMsg) {
                    msgContent = enhancedPrompt;
                }

                // check for image content
                if (msgContent.includes('![image](')) {
                    // extract image url
                    const imgMatch = msgContent.match(/!\[[^\]]*\]\((data:[^)]+)\)/);
                    if (imgMatch) {
                        contents.push({
                            role: role,
                            parts: [
                                {
                                    text: msgContent
                                        .replace(/!\[[^\]]*\]\((data:[^)]+)\)/g, '')
                                        .trim()
                                },
                                {
                                    inlineData: {
                                        mimeType: 'image/jpeg',
                                        data: imgMatch[1].split(',')[1]
                                    }
                                }
                            ]
                        });
                    }
                } else {
                    contents.push({ role: role, parts: [{ text: msgContent }] });
                }
            });

            const res = await fetchWithTimeout(
                `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${key}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: contents,
                        generationConfig: {
                            temperature: 0.9,
                            maxOutputTokens: 2048
                        }
                    })
                },
                120000
            );
            if (!res.ok) {
                const errBody = await res.text().catch(() => '');
                throw new Error(`gemini error ${res.status}: ${errBody.substring(0, 200)}`);
            }
            const data = await res.json();
            const parts = data.candidates?.[0]?.content?.parts;

            // handle image generation response (inlineData) or text response
            if (parts && parts.length > 0) {
                const firstPart = parts[0];
                if (firstPart.inlineData) {
                    // image generation response - create markdown image
                    const mimeType = firstPart.inlineData.mimeType || 'image/png';
                    const imageData = firstPart.inlineData.data;
                    responseContent = `![generated image](data:${mimeType};base64,${imageData})`;
                } else if (firstPart.text) {
                    // text response
                    responseContent = firstPart.text;
                } else {
                    responseContent = 'no response';
                }
            } else {
                responseContent = 'no response';
            }
        } else if (currentApiMode === 'llama-offline') {
            // llama local - connect to llama-server (llama.cpp) on port 5053
            // llama-server uses OpenAI-compatible API at /v1/chat/completions
            const isAndroidApk = typeof window.Capacitor !== 'undefined' || 
                                window.AndroidBridge !== undefined;
            
            if (isAndroidApk && window.AndroidBridge) {
                const serverStatus = window.AndroidBridge.getLlamaServerStatus ? 
                    window.AndroidBridge.getLlamaServerStatus() : 'unknown';
                
                if (serverStatus === 'downloading') {
                    throw new Error('model is still downloading. please wait for the download to complete before chatting.');
                }
                if (serverStatus === 'model_ready') {
                    throw new Error('model is downloaded but server is still starting up. please wait a moment and try again.');
                }
                if (serverStatus !== 'running') {
                    // try to get detailed status for debugging
                    let detail = '';
                    try {
                        detail = window.AndroidBridge.getDetailedStatus ? window.AndroidBridge.getDetailedStatus() : '';
                    } catch (e) { /* ignore */ }
                    throw new Error('local llm server not ready. status: ' + serverStatus + (detail ? ' | ' + detail : ''));
                }
            }
            
            const baseUrl = 'http://127.0.0.1:5053';
            
            // Health check before sending message
            try {
                const healthRes = await fetchWithTimeout(`${baseUrl}/health`, { method: 'GET' }, 60000);
                const healthText = await healthRes.text().catch(() => '');
                console.log('[llms] llama local: health status:', healthRes.status, healthText);
                
                if (!healthRes.ok) {
                    throw new Error('server health check failed (status ' + healthRes.status + '): ' + healthText.substring(0, 200));
                }
                const healthData = await healthRes.json().catch(() => ({}));
                if (healthData.status && healthData.status !== 'ok') {
                    throw new Error('server status: ' + healthData.status + ' - ' + (healthData.error || 'model may still be loading'));
                }
            } catch (healthErr) {
                if (healthErr.message.includes('timeout') || healthErr.message.includes('Failed to fetch') || healthErr.message.includes('NetworkError')) {
                    throw new Error('cannot connect to local ai server on port 5053. the server may still be loading the model. please wait 30 seconds and try again.');
                }
                throw healthErr;
            }
            
            console.log('[llms] llama local: sending to', `${baseUrl}/v1/chat/completions`);

            // Convert chatHistory to OpenAI format (llama-server compatible)
            const llamaMessages = [];
            let hasSystemPrompt = false;
            const userSystemPrompt = getSystemPrompt();
            const antiToolInstructions = '\n\nyou are gemma 4 4b by google. do not prepend any word to your response.';
            
            chatHistory.forEach(msg => {
                // Strip image markdown since llama-server doesn't support vision
                const content = msg.content.replace(/!\[[^\]]*\]\((data:[^)]+)\)/g, '').trim();
                if (msg.role === 'system') {
                    hasSystemPrompt = true;
                    // Use user's system prompt merged with anti-tool instructions
                    llamaMessages.push({
                        role: 'system',
                        content: (content || msg.content).replace(/you must respond in plain natural language only[\s\S]*$/m, '').trim() + antiToolInstructions
                    });
                } else {
                    llamaMessages.push({ role: msg.role, content: content || msg.content });
                }
            });
            // If no system prompt was in history, add user's system prompt
            if (!hasSystemPrompt) {
                llamaMessages.unshift({
                    role: 'system',
                    content: userSystemPrompt + antiToolInstructions
                });
            }

            // Use llama-server's OpenAI-compatible chat completions endpoint
            console.log('[llms] llama local: sending request...');
            const res = await fetchWithTimeout(
                `${baseUrl}/v1/chat/completions`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: llamaMessages,
                        temperature: 0.7,
                        max_tokens: 512,
                        stream: false
                    })
                },
                300000
            );
            console.log('[llms] llama local: got response:', res.status);
            
            if (!res.ok) {
                const errBody = await res.text().catch(() => '');
                console.error('[llms] llama local: error response:', res.status, errBody);
                throw new Error(`local LLM error ${res.status}: ${errBody.substring(0, 300)}`);
            }
            
            // Read response with timeout safety
            const responseText = await res.text();
            console.log('[llms] llama local: response length:', responseText.length);
            
            // Parse JSON manually to avoid hanging
            let data;
            try {
                data = JSON.parse(responseText);
            } catch (e) {
                console.error('[llms] llama local: JSON parse error:', e.message);
                console.error('[llms] llama local: response start:', responseText.substring(0, 500));
                throw new Error('server returned invalid JSON response');
            }
            
            // llama-server returns OpenAI format: { choices: [{ message: { content: "..." } }] }
            responseContent = data.choices?.[0]?.message?.content || '';
            if (!responseContent) {
                // fallback: try other common response formats
                responseContent = data.content || data.response || data.message?.content || '';
            }
            if (!responseContent) {
                console.error('[llms] llama local: empty response, full data:', JSON.stringify(data).substring(0, 500));
                throw new Error('server returned empty response - model may be unresponsive');
            }
        }

        document.getElementById(loadingId)?.remove();
        // if we streamed, the message div is already appended and we just need to record history
        if (!assistantMsgDiv) {
            appendMessage('assistant', responseContent);
        } else {
            // save streamed response to current chat (appendMessage wasn't called)
            if (currentChatId && chats[currentChatId]) {
                chats[currentChatId].messages.push({ role: 'assistant', content: responseContent });
                saveChats();
            }
        }
        chatHistory.push({ role: 'assistant', content: responseContent });
        trimChatHistory();
    } catch (err) {
        dlog.error('API error:', err);
        document.getElementById(loadingId)?.remove();

        // user-friendly error messages
        let userMessage = 'error: ';
        if (err.message.includes('timeout')) {
            userMessage += 'request timed out - please try again';
        } else if (err.message.includes('401') || err.message.includes('api key')) {
            userMessage += 'invalid api key - check your settings';
        } else if (err.message.includes('429')) {
            userMessage += 'rate limit exceeded - please wait a moment';
        } else if (err.message.includes('500') || err.message.includes('503')) {
            userMessage += 'service temporarily unavailable - please try again';
        } else if (!navigator.onLine) {
            userMessage += 'you are offline - check your connection';
        } else {
            userMessage += err.message;
        }

        appendMessage('assistant', userMessage);
    }
}

sendApiMessageBtn.addEventListener('click', sendApiMessage);
apiChatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendApiMessage();
    }
});

// viewer modal event listeners
document.getElementById('close-viewer')?.addEventListener('click', closeViewer);
document.getElementById('viewer-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'viewer-modal') {
        closeViewer();
    }
});

// chat management event listeners
newChatBtn?.addEventListener('click', createNewChat);
document.getElementById('sync-chats-btn')?.addEventListener('click', async () => {
    showToast('syncing to nocobase...');
    await remoteSyncChats();
    showToast('sync complete');
});
exportChatBtn?.addEventListener('click', exportChat);
summarizeChatBtn?.addEventListener('click', summarizeChat);

// mobile chat sidebar toggle
openChatSidebarBtn?.addEventListener('click', () => {
    if (currentApiMode) {
        // in API mode, toggle the chat sidebar
        if (chatSidebar?.classList.contains('hidden')) {
            chatSidebar.classList.remove('hidden');
            chatSidebar.classList.add('flex');
            chatSidebar.classList.remove('collapsed');
        } else {
            chatSidebar.classList.add('hidden');
            chatSidebar.classList.remove('flex');
        }
    } else {
        // not in API mode, toggle the main sidebar
        if (sidebar?.classList.contains('-translate-x-full')) {
            sidebar.classList.remove('-translate-x-full');
            swipeOverlay?.classList.remove('hidden');
        } else {
            sidebar?.classList.add('-translate-x-full');
            swipeOverlay?.classList.add('hidden');
        }
    }
});

closeChatSidebarBtn?.addEventListener('click', () => {
    chatSidebar?.classList.add('hidden');
    chatSidebar?.classList.remove('flex');
});

// desktop: collapse/expand sidebar toggle
collapseChatSidebarBtn?.addEventListener('click', () => {
    if (chatSidebar?.classList.contains('collapsed')) {
        chatSidebar?.classList.remove('collapsed');
        collapseChatSidebarBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
        </svg>`;
    } else {
        chatSidebar?.classList.add('collapsed');
        collapseChatSidebarBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
        </svg>`;
    }
});

// close chat sidebar when clicking outside (for mobile)
document.addEventListener('click', (e) => {
    // only on mobile and when sidebar is open
    if (window.innerWidth >= 768) {
        return;
    }
    if (!chatSidebar?.classList.contains('flex')) {
        return;
    }

    // check if click is outside sidebar and not on open button
    if (!chatSidebar?.contains(e.target) && !openChatSidebarBtn?.contains(e.target)) {
        chatSidebar?.classList.add('hidden');
        chatSidebar?.classList.remove('flex');
    }
});

// helper to populate the api-key modal fields from stored values
async function populateApiModal() {
    // try loading from nocobase first if configured
    const ncfg = getNocoBaseConfig();
    if (ncfg.apiKey) {
        await loadApiKeysFromNocoBase();
    }

    const keys = getApiKeys();
    if (openrouterKeyInput) {
        openrouterKeyInput.value = keys.openrouter || '';
    }
    if (huggingfaceKeyInput) {
        huggingfaceKeyInput.value = keys.huggingface || '';
    }
    if (geminiKeyInput) {
        geminiKeyInput.value = keys.gemini || '';
    }
    if (deepseekKeyInput) {
        deepseekKeyInput.value = keys.deepseek || '';
    }
    if (mistralKeyInput) {
        mistralKeyInput.value = keys.mistral || '';
    }
    if (nocobaseUrlInput) {
        nocobaseUrlInput.value = ncfg.url || '';
    }
    if (nocobaseKeyInput) {
        nocobaseKeyInput.value = ncfg.apiKey || '';
    }
}

// gemini key prompt (shows only gemini input)
async function showGeminiKeyPrompt() {
    await populateApiModal();
    // hide other inputs, show only gemini (and hide nocobase fields)
    const orWrapper = openrouterKeyInput?.parentElement;
    const hfWrapper = huggingfaceKeyInput?.parentElement;
    const geminiWrapper = geminiKeyInput?.parentElement;
    const nbUrlWrapper = nocobaseUrlInput?.parentElement;
    const nbKeyWrapper = nocobaseKeyInput?.parentElement;

    if (orWrapper) {
        orWrapper.classList.add('hidden');
    }
    if (hfWrapper) {
        hfWrapper.classList.add('hidden');
    }
    if (nbUrlWrapper) {
        nbUrlWrapper.classList.add('hidden');
    }
    if (nbKeyWrapper) {
        nbKeyWrapper.classList.add('hidden');
    }
    if (deepseekKeyInput?.parentElement) {
        deepseekKeyInput.parentElement.classList.add('hidden');
    }
    if (mistralKeyInput?.parentElement) {
        mistralKeyInput.parentElement.classList.add('hidden');
    }
    if (geminiWrapper) {
        geminiWrapper.classList.remove('hidden');
    }

    // update modal title
    const title = apiKeyModal?.querySelector('h3');
    if (title) {
        title.textContent = 'enter gemini api key';
    }

    // mark that we've prompted the user
    localStorage.setItem('llms_gemini_prompted', 'true');

    apiKeyModal?.classList.remove('hidden');
    apiKeyModal?.classList.add('flex');
}

// deepseek key prompt (shows only deepseek input)
async function showDeepseekKeyPrompt() {
    await populateApiModal();
    // hide other inputs, show only deepseek
    const orWrapper = openrouterKeyInput?.parentElement;
    const hfWrapper = huggingfaceKeyInput?.parentElement;
    const geminiWrapper = geminiKeyInput?.parentElement;
    const deepseekWrapper = deepseekKeyInput?.parentElement;
    const mistralWrapper = mistralKeyInput?.parentElement;
    const nbUrlWrapper = nocobaseUrlInput?.parentElement;
    const nbKeyWrapper = nocobaseKeyInput?.parentElement;

    if (orWrapper) {
        orWrapper.classList.add('hidden');
    }
    if (hfWrapper) {
        hfWrapper.classList.add('hidden');
    }
    if (geminiWrapper) {
        geminiWrapper.classList.add('hidden');
    }
    if (mistralWrapper) {
        mistralWrapper.classList.add('hidden');
    }
    if (nbUrlWrapper) {
        nbUrlWrapper.classList.add('hidden');
    }
    if (nbKeyWrapper) {
        nbKeyWrapper.classList.add('hidden');
    }
    if (deepseekWrapper) {
        deepseekWrapper.classList.remove('hidden');
    }

    // update modal title
    const title = apiKeyModal?.querySelector('h3');
    if (title) {
        title.textContent = 'enter deepseek api key';
    }

    localStorage.setItem('llms_deepseek_prompted', 'true');

    apiKeyModal?.classList.remove('hidden');
    apiKeyModal?.classList.add('flex');
}

// mistral key prompt (shows only mistral input)
async function showMistralKeyPrompt() {
    await populateApiModal();
    // hide other inputs, show only mistral
    const orWrapper = openrouterKeyInput?.parentElement;
    const hfWrapper = huggingfaceKeyInput?.parentElement;
    const geminiWrapper = geminiKeyInput?.parentElement;
    const deepseekWrapper = deepseekKeyInput?.parentElement;
    const mistralWrapper = mistralKeyInput?.parentElement;
    const nbUrlWrapper = nocobaseUrlInput?.parentElement;
    const nbKeyWrapper = nocobaseKeyInput?.parentElement;

    if (orWrapper) {
        orWrapper.classList.add('hidden');
    }
    if (hfWrapper) {
        hfWrapper.classList.add('hidden');
    }
    if (geminiWrapper) {
        geminiWrapper.classList.add('hidden');
    }
    if (deepseekWrapper) {
        deepseekWrapper.classList.add('hidden');
    }
    if (nbUrlWrapper) {
        nbUrlWrapper.classList.add('hidden');
    }
    if (nbKeyWrapper) {
        nbKeyWrapper.classList.add('hidden');
    }
    if (mistralWrapper) {
        mistralWrapper.classList.remove('hidden');
    }

    // update modal title
    const title = apiKeyModal?.querySelector('h3');
    if (title) {
        title.textContent = 'enter mistral api key';
    }

    localStorage.setItem('llms_mistral_prompted', 'true');

    apiKeyModal?.classList.remove('hidden');
    apiKeyModal?.classList.add('flex');
}

// huggingface key prompt (shows only huggingface input)
async function showHuggingfaceKeyPrompt() {
    await populateApiModal();
    // hide other inputs, show only huggingface
    const orWrapper = openrouterKeyInput?.parentElement;
    const hfWrapper = huggingfaceKeyInput?.parentElement;
    const geminiWrapper = geminiKeyInput?.parentElement;
    const deepseekWrapper = deepseekKeyInput?.parentElement;
    const mistralWrapper = mistralKeyInput?.parentElement;
    const nbUrlWrapper = nocobaseUrlInput?.parentElement;
    const nbKeyWrapper = nocobaseKeyInput?.parentElement;

    if (orWrapper) {
        orWrapper.classList.add('hidden');
    }
    if (geminiWrapper) {
        geminiWrapper.classList.add('hidden');
    }
    if (deepseekWrapper) {
        deepseekWrapper.classList.add('hidden');
    }
    if (mistralWrapper) {
        mistralWrapper.classList.add('hidden');
    }
    if (nbUrlWrapper) {
        nbUrlWrapper.classList.add('hidden');
    }
    if (nbKeyWrapper) {
        nbKeyWrapper.classList.add('hidden');
    }
    if (hfWrapper) {
        hfWrapper.classList.remove('hidden');
    }

    // update modal title
    const title = apiKeyModal?.querySelector('h3');
    if (title) {
        title.textContent = 'enter huggingface api key';
    }

    localStorage.setItem('llms_huggingface_prompted', 'true');

    apiKeyModal?.classList.remove('hidden');
    apiKeyModal?.classList.add('flex');
}

async function showNocoBasePrompt() {
    await populateApiModal();
    const orWrapper = openrouterKeyInput?.parentElement;
    const hfWrapper = huggingfaceKeyInput?.parentElement;
    const geminiWrapper = geminiKeyInput?.parentElement;
    const nbUrlWrapper = nocobaseUrlInput?.parentElement;
    const nbKeyWrapper = nocobaseKeyInput?.parentElement;

    // hide other inputs
    if (orWrapper) {
        orWrapper.classList.add('hidden');
    }
    if (hfWrapper) {
        hfWrapper.classList.add('hidden');
    }
    if (geminiWrapper) {
        geminiWrapper.classList.add('hidden');
    }
    if (deepseekKeyInput?.parentElement) {
        deepseekKeyInput.parentElement.classList.add('hidden');
    }
    if (mistralKeyInput?.parentElement) {
        mistralKeyInput.parentElement.classList.add('hidden');
    }
    // show nocobase url and key inputs
    if (nbUrlWrapper) {
        nbUrlWrapper.classList.remove('hidden');
    }
    if (nbKeyWrapper) {
        nbKeyWrapper.classList.remove('hidden');
    }

    const title = apiKeyModal?.querySelector('h3');
    if (title) {
        title.textContent = 'enter nocobase key';
    }
    const desc = apiKeyModal?.querySelector('p');
    if (desc) {
        desc.textContent = 'enter your nocobase api key to sync chats across devices.';
    }

    localStorage.setItem('llms_nocobase_prompted', 'true');
    apiKeyModal?.classList.remove('hidden');
    apiKeyModal?.classList.add('flex');
}

// reset modal to show all inputs
function resetApiKeyModal() {
    const orWrapper = openrouterKeyInput?.parentElement;
    const hfWrapper = huggingfaceKeyInput?.parentElement;
    const geminiWrapper = geminiKeyInput?.parentElement;
    const nbUrlWrapper = nocobaseUrlInput?.parentElement;
    const nbKeyWrapper = nocobaseKeyInput?.parentElement;

    if (orWrapper) {
        orWrapper.classList.remove('hidden');
    }
    if (hfWrapper) {
        hfWrapper.classList.remove('hidden');
    }
    if (geminiWrapper) {
        geminiWrapper.classList.remove('hidden');
    }
    if (deepseekKeyInput?.parentElement) {
        deepseekKeyInput.parentElement.classList.remove('hidden');
    }
    if (mistralKeyInput?.parentElement) {
        mistralKeyInput.parentElement.classList.remove('hidden');
    }
    if (nbUrlWrapper) {
        nbUrlWrapper.classList.remove('hidden');
    }
    if (nbKeyWrapper) {
        nbKeyWrapper.classList.remove('hidden');
    }

    const title = apiKeyModal?.querySelector('h3');
    if (title) {
        title.textContent = 'api setup';
    }
    const desc = apiKeyModal?.querySelector('p');
    if (desc) {
        desc.textContent = 'enter your api keys to use api-based models. keys are stored locally.';
    }
}

// api key modal event listeners
saveApiKeysBtn?.addEventListener('click', async () => {
    const keys = {
        openrouter: openrouterKeyInput?.value?.trim() || '',
        huggingface: huggingfaceKeyInput?.value?.trim() || '',
        gemini: geminiKeyInput?.value?.trim() || '',
        deepseek: deepseekKeyInput?.value?.trim() || '',
        mistral: mistralKeyInput?.value?.trim() || ''
    };
    const nbConfig = {
        url: nocobaseUrlInput?.value?.trim() || '',
        apiKey: nocobaseKeyInput?.value?.trim() || ''
    };
    // use sessionStorage for security (cleared when tab closes)
    saveApiKeys(keys);
    saveNocoBaseConfig(nbConfig);
    if (nbConfig.apiKey) {
        await ensureNocoBaseCollection();
        // sync api keys to nocobase
        await syncApiKeysToNocoBase(keys);
        // if we already have chats loaded for a model, sync them
        if (currentApiMode && Object.keys(chats).length > 0) {
            await saveChats();
        }
    }
    apiKeyModal?.classList.add('hidden');
    apiKeyModal?.classList.remove('flex');
    showToast('api keys saved');
    if (nbConfig.apiKey) {
        showToast('nocobase configured');
    }
    // reset modal for next time
    resetApiKeyModal();
    
    // if there was a pending message, retry sending it now that keys are saved
    if (pendingMessage) {
        const msgToSend = pendingMessage;
        pendingMessage = null;
        showToast('retrying with new api key...');
        // small delay to let modal close first
        setTimeout(() => processApiMessage(msgToSend), 500);
    }
});

skipApiKeysBtn?.addEventListener('click', () => {
    apiKeyModal?.classList.add('hidden');
    apiKeyModal?.classList.remove('flex');
    // clear any pending message since user chose to skip
    if (pendingMessage) {
        pendingMessage = null;
    }
    // reset modal for next time
    resetApiKeyModal();
});

// attachment support
const attachBtn = document.getElementById('attach-btn');
const attachInput = document.getElementById('attach-input');

attachBtn?.addEventListener('click', () => {
    attachInput.click();
});

attachInput?.addEventListener('change', handleAttachment);

async function handleAttachment() {
    const file = attachInput?.files?.[0];
    if (!file) {
        return;
    }

    const reader = new FileReader();
    if (!reader) {
        showToast('failed to read file');
        return;
    }

    reader.onload = async () => {
        const dataUrl = reader.result;
        if (!dataUrl) {
            showToast('failed to read file data');
            return;
        }
        // set image markdown in input so sendApiMessage handles the full flow
        apiChatInput.value = `![image](${dataUrl})`;
        await sendApiMessage();
    };

    reader.onerror = () => {
        showToast('failed to read file');
    };

    reader.readAsDataURL(file);
    if (attachInput) {
        attachInput.value = '';
    }
}

function modelSupportsImages() {
    if (currentApiMode === 'llama-offline') {
        return false; // llama offline doesn't support images yet
    }
    if (currentApiMode === 'openrouter-api') {
        const m = (getActiveOpenrouterModel() || '').toLowerCase();
        return /vision|vl|image/.test(m);
    }
    if (currentApiMode === 'huggingface-api') {
        const hfDropdown = document.getElementById('hf-model-dropdown');
        const m = hfDropdown?.value || '';
        return /vision|vl|image/.test(m.toLowerCase());
    }
    if (currentApiMode === 'nano-banana-pro') {
        return true; // nano banana pro supports images
    }
    if (currentApiMode === 'gemini-api') {
        return true; // gemini api supports images
    }
    if (currentApiMode === 'deepseek-api') {
        return false; // deepseek chat does not support images
    }
    if (currentApiMode === 'mistral-api') {
        return false; // mistral tiny does not support images
    }

    return false;
}

function updateAttachmentUI() {
    if (!attachBtn) {
        return;
    }
    const show = modelSupportsImages();
    attachBtn.style.display = show ? 'inline-flex' : 'none';
}

// chat management functions
// ---------- noco base helpers ----------
function getNocoBaseConfig() {
    // url is configurable for self-hosting, defaults to a generic domain
    return {
        url: localStorage.getItem('llms_nocobase_url') || 'https://db.example.com',
        apiKey: localStorage.getItem('llms_nocobase_key') || ''
    };
}

function saveNocoBaseConfig({ url, apiKey }) {
    // store both url and apiKey for self-hosting support
    if (url) {
        localStorage.setItem('llms_nocobase_url', url.replace(/\/+$/, ''));
    }
    if (apiKey) {
        localStorage.setItem('llms_nocobase_key', apiKey);
    }
}

async function ensureNocoBaseCollection() {
    // skip entirely in browser mode - no NocoBase in browser builds
    if (isPureBrowser()) {
        dlog.log('browser mode detected, skipping collection ensure');
        return false;
    }

    const { url, apiKey } = getNocoBaseConfig();
    if (!url || !apiKey) {
        return false;
    }

    const baseUrl = url.replace(/\/+$/, '');

    try {
        // check if collection exists
        const check = await fetch(`${baseUrl}/api/collections/llms`, {
            headers: { Authorization: `Bearer ${apiKey}` }
        });
        if (check.ok) {
            dlog.log('nocobase collection exists');
            return true;
        }
    } catch (e) {
        dlog.log('collection check failed, will try to create');
    }

    // create collection with proper fields
    try {
        dlog.log('creating nocobase collection...');
        const createRes = await fetch(`${baseUrl}/api/collections`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: 'llms',
                title: 'LLMs Chats',
                fields: [
                    { name: 'chatId', type: 'string', unique: true, required: true },
                    { name: 'model', type: 'string', required: true },
                    { name: 'title', type: 'string', required: true },
                    { name: 'messages', type: 'text', required: true }
                ]
            })
        });

        if (createRes.ok) {
            dlog.log('nocobase collection created successfully');
            showToast('nocobase database created');
            return true;
        } else if (createRes.status === 409) {
            // Collection already exists (conflict)
            dlog.log('nocobase collection already exists (409)');
            return true;
        } else {
            const err = await createRes.text();
            dlog.error('failed to create collection:', err);
            return false;
        }
    } catch (e) {
        dlog.error('failed to create nocobase collection', e);
        return false;
    }
}

// sync api keys to nocobase
async function syncApiKeysToNocoBase(keys) {
    // skip entirely in browser mode - no NocoBase in browser builds
    if (isPureBrowser()) {
        dlog.log('browser mode detected, skipping api key sync');
        return;
    }

    const { url, apiKey } = getNocoBaseConfig();
    if (!url || !apiKey) {
        return;
    }
    try {
        await ensureNocoBaseCollection();
        // check if api keys record exists
        const res = await fetch(
            `${url.replace(/\/+$/, '')}/api/collections/llms/records?filter[chatId]=api_keys`,
            {
                headers: { Authorization: `Bearer ${apiKey}` }
            }
        );
        const data = await res.json();
        const existing = (data.data || []).find((r) => r.chatId === 'api_keys');

        const payload = {
            chatId: 'api_keys',
            model: 'system',
            title: 'api_keys',
            messages: JSON.stringify(keys)
        };

        if (existing) {
            // update existing
            await fetch(`${url.replace(/\/+$/, '')}/api/collections/llms/records/${existing.id}`, {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
        } else {
            // create new
            await fetch(`${url.replace(/\/+$/, '')}/api/collections/llms/records`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
        }
        showToast('api keys synced to nocobase');
    } catch (e) {
        dlog.warn('failed to sync api keys to nocobase', e);
    }
}

// load api keys from nocobase
async function loadApiKeysFromNocoBase() {
    // skip entirely in browser mode - no NocoBase in browser builds
    if (isPureBrowser()) {
        dlog.log('browser mode detected, skipping api key load from nocobase');
        return false;
    }

    const { url, apiKey } = getNocoBaseConfig();
    if (!url || !apiKey) {
        return false;
    }
    try {
        await ensureNocoBaseCollection();
        const res = await fetch(
            `${url.replace(/\/+$/, '')}/api/collections/llms/records?filter[chatId]=api_keys`,
            {
                headers: { Authorization: `Bearer ${apiKey}` }
            }
        );
        if (!res.ok) {
            return false;
        }
        const data = await res.json();
        const record = (data.data || []).find((r) => r.chatId === 'api_keys');
        if (record && record.messages) {
            const keys = JSON.parse(record.messages);
            saveApiKeys(keys);
            // update input fields
            if (openrouterKeyInput) {
                openrouterKeyInput.value = keys.openrouter || '';
            }
            if (huggingfaceKeyInput) {
                huggingfaceKeyInput.value = keys.huggingface || '';
            }
            if (geminiKeyInput) {
                geminiKeyInput.value = keys.gemini || '';
            }
            showToast('api keys loaded from nocobase');
            return true;
        }
    } catch (e) {
        dlog.warn('failed to load api keys from nocobase', e);
    }
    return false;
}

async function remoteLoadChats() {
    // skip entirely in browser mode - no NocoBase in browser builds
    if (isPureBrowser()) {
        dlog.log('browser mode detected, skipping remote load');
        return false;
    }

    const { url, apiKey } = getNocoBaseConfig();
    if (!url || !apiKey) {
        dlog.log('nocobase not configured, cannot load remote chats');
        return false;
    }

    const baseUrl = url.replace(/\/+$/, '');

    try {
        dlog.log('ensuring nocobase collection exists...');
        const collectionOk = await ensureNocoBaseCollection();
        if (!collectionOk) {
            dlog.error('collection not available');
            return false;
        }

        dlog.log('loading chats from nocobase...');
        const res = await fetch(`${baseUrl}/api/collections/llms/records`, {
            headers: { Authorization: `Bearer ${apiKey}` }
        });

        if (!res.ok) {
            throw new Error(`fetch failed: ${res.status}`);
        }

        const data = await res.json();
        const recs = data.data || [];
        dlog.log(`found ${recs.length} total records, filtering for ${currentApiMode}`);

        chats = {};
        let loaded = 0;
        recs.filter((r) => r.model === currentApiMode).forEach((r) => {
            try {
                chats[r.chatId] = {
                    title: r.title,
                    messages: typeof r.messages === 'string' ? JSON.parse(r.messages) : r.messages
                };
                loaded++;
            } catch (e) {
                dlog.warn('invalid messages in record', r.chatId, e);
            }
        });

        dlog.log(`loaded ${loaded} chats for ${currentApiMode}`);
        if (loaded > 0) {
            showToast(`loaded ${loaded} chats from nocobase`);
        }
        return true;
    } catch (e) {
        dlog.error('remote load failed:', e);
        // silently log server errors (500), only show toast for auth issues
        if (e.message?.includes('401') || e.message?.includes('403')) {
            showToast('remote load failed: check api key');
        }
        // fall back to local storage (handled in loadChats)
        return false;
    }
}

async function remoteSyncChats() {
    // skip entirely in browser mode - no NocoBase in browser builds
    if (isPureBrowser()) {
        dlog.log('browser mode detected, skipping remote sync');
        return;
    }

    const { url, apiKey } = getNocoBaseConfig();

    // if there are no chats left there's nothing to sync; most of the
    // remote logic (ensure collection, fetch list, etc.) is only needed when
    // we have content and those calls were responsible for the error that
    // popped up when deleting an empty/native chat.
    if (Object.keys(chats).length === 0) {
        dlog.log('no local chats, skipping nocobase sync');
        return;
    }

    if (!url || !apiKey) {
        dlog.log('nocobase not configured, skipping remote sync');
        return;
    }

    const baseUrl = url.replace(/\/+$/, '');

    try {
        dlog.log('ensuring nocobase collection exists...');
        const collectionOk = await ensureNocoBaseCollection();
        if (!collectionOk) {
            dlog.error('collection creation failed');
            // silently fail - don't show error toast
            return;
        }

        dlog.log('fetching existing records...');
        const fetched = await fetchWithTimeout(
            `${baseUrl}/api/collections/llms/records`,
            {
                headers: { Authorization: `Bearer ${apiKey}` }
            },
            30000
        );

        if (!fetched.ok) {
            throw new Error(`fetch failed: ${fetched.status}`);
        }

        const data = await fetched.json();
        const existingList = data.data || [];
        dlog.log(`found ${existingList.length} existing records`);

        let synced = 0;
        let failed = 0;
        const failedChats = [];

        for (const chatId of Object.keys(chats)) {
            const chat = chats[chatId];

            // do not try to push empty conversations to nocobase; they were
            // never synced in the first place and the API may reject the
            // payload or cause confusing "sync failed" errors.
            if (!chat || !Array.isArray(chat.messages) || chat.messages.length === 0) {
                continue;
            }

            const payload = {
                chatId,
                model: currentApiMode,
                title: chat.title,
                messages: JSON.stringify(chat.messages)
            };

            const existing = existingList.find(
                (r) => r.chatId === chatId && r.model === currentApiMode
            );

            try {
                if (existing) {
                    dlog.log(`updating existing chat: ${chatId}`);
                    const updateRes = await fetchWithTimeout(
                        `${baseUrl}/api/collections/llms/records/${existing.id}`,
                        {
                            method: 'PUT',
                            headers: {
                                Authorization: `Bearer ${apiKey}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(payload)
                        },
                        30000
                    );
                    if (!updateRes.ok) {
                        dlog.error(`failed to update ${chatId}:`, await updateRes.text());
                        failed++;
                        failedChats.push(chatId);
                    } else {
                        synced++;
                    }
                } else {
                    dlog.log(`creating new chat: ${chatId}`);
                    const createRes = await fetchWithTimeout(
                        `${baseUrl}/api/collections/llms/records`,
                        {
                            method: 'POST',
                            headers: {
                                Authorization: `Bearer ${apiKey}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(payload)
                        },
                        30000
                    );
                    if (!createRes.ok) {
                        dlog.error(`failed to create ${chatId}:`, await createRes.text());
                        failed++;
                        failedChats.push(chatId);
                    } else {
                        synced++;
                    }
                }
            } catch (chatErr) {
                dlog.error(`chat operation failed for ${chatId}:`, chatErr);
                failed++;
                failedChats.push(chatId);
                // continue with next chat instead of aborting entire sync
            }
        }

        dlog.log(`synced ${synced} chats to nocobase (${failed} failed)`);
        if (failed > 0) {
            showToast(`${synced} chats synced, ${failed} failed`);
        } else {
            showToast(`${synced} chats synced to nocobase`);
        }
    } catch (e) {
        dlog.error('remote sync failed:', e);
        // only show error toast for client/config errors, not server 500s
        const isServerError = e.message?.includes('500') || e.message?.includes('502') || e.message?.includes('503');
        if (!isServerError) {
            showToast('remote sync failed: ' + e.message);
        }
    }
}

// chat loading/saving (now async to support remote)
async function loadChats() {
    // skip NocoBase in browser mode to avoid 500 errors
    if (!isPureBrowser()) {
        const cfg = getNocoBaseConfig();
        if (cfg.url && cfg.apiKey) {
            const ok = await remoteLoadChats();
            if (ok) {
                return;
            }
        }
    }
    const stored = localStorage.getItem('llms_chats_' + currentApiMode);
    if (stored) {
        try {
            chats = JSON.parse(stored);
            // enforce per-chat size limits on load
            Object.values(chats).forEach((chat) => {
                if (Array.isArray(chat.messages)) {
                    while (chat.messages.length > MAX_STORED_CHAT_MESSAGES) {
                        chat.messages.shift();
                    }
                }
            });
        } catch (e) {
            localStorage.removeItem('llms_chats_' + currentApiMode);
            chats = {};
        }
    } else {
        chats = {};
    }
}

// debounce timer for saveChats to prevent race conditions
let saveChatsDebounceTimer = null;

async function saveChats() {
    // clear any pending save to avoid race conditions
    if (saveChatsDebounceTimer) {
        clearTimeout(saveChatsDebounceTimer);
    }

    // debounce saves by 300ms to batch rapid updates
    return new Promise((resolve) => {
        saveChatsDebounceTimer = setTimeout(async () => {
            try {
                // skip NocoBase sync in browser mode to avoid 500 errors
                if (!isPureBrowser()) {
                    const cfg = getNocoBaseConfig();
                    if (cfg.url && cfg.apiKey) {
                        await remoteSyncChats();
                    }
                }
                // always keep a local copy as fallback
                localStorage.setItem('llms_chats_' + currentApiMode, JSON.stringify(chats));
                resolve();
            } catch (err) {
                dlog.error('saveChats error:', err);
                resolve(); // still resolve to avoid blocking UI
            }
        }, 300);
    });
}

async function createNewChat() {
    const chatId = 'chat_' + Date.now();
    chats[chatId] = {
        title: 'new chat',
        messages: []
    };
    currentChatId = chatId;
    await saveChats();
    renderChatList();
    chatMessages.innerHTML =
        '<div class="text-center text-gray-500 mt-10">start a new conversation.</div>';
}

function switchToChat(chatId) {
    currentChatId = chatId;
    renderChatList();
    renderCurrentChat();
}

// helpers for tests or external code to read/modify internal state
function setCurrentChatId(id) {
    currentChatId = id;
}
function getCurrentChatId() {
    return currentChatId;
}

function setCurrentApiMode(mode) {
    currentApiMode = mode;
}
function getCurrentApiMode() {
    return currentApiMode;
}

async function deleteChat(chatId, e) {
    e.stopPropagation();

    // keep a reference to the chat being removed so we can decide whether
    // to talk to nocobase about it. chats without any messages were never
    // synced, so attempting a remote delete just provokes an error when the
    // user is working with a "native"/empty chat.
    const chat = chats[chatId];

    delete chats[chatId];
    if (currentChatId === chatId) {
        const remaining = Object.keys(chats);
        currentChatId = remaining.length > 0 ? remaining[0] : null;
    }

    await saveChats();
    renderChatList();
    // after deletion update the chat display area
    if (currentChatId) {
        renderCurrentChat();
    } else {
        chatMessages.innerHTML =
            '<div class="text-center text-gray-500 mt-10">no chats yet. create one to get started.</div>';
    }

    // if remote storage is enabled *and* the chat actually contained messages,
    // attempt to delete the corresponding record. empty/native chats are
    // skipped to avoid needless fetches and the NocoBase errors reported by
    // users. also skip in browser mode entirely.
    if (!isPureBrowser() && chat && Array.isArray(chat.messages) && chat.messages.length > 0) {
        const { url, apiKey } = getNocoBaseConfig();
        if (url && apiKey) {
            try {
                const res = await fetch(`${url.replace(/\/+$/, '')}/api/collections/llms/records`, {
                    headers: { Authorization: `Bearer ${apiKey}` }
                });
                const data = await res.json();
                const existing = (data.data || []).find(
                    (r) => r.chatId === chatId && r.model === currentApiMode
                );
                if (existing) {
                    await fetch(
                        `${url.replace(/\/+$/, '')}/api/collections/llms/records/${existing.id}`,
                        {
                            method: 'DELETE',
                            headers: { Authorization: `Bearer ${apiKey}` }
                        }
                    );
                }
            } catch (err) {
                dlog.warn('remote delete failed', err);
                showToast('remote delete failed');
            }
        }
    }
}

// message context menu for edit/resend
let closeMenuListener = null;

function showMessageContextMenu(e, content) {
    e.preventDefault();
    e.stopPropagation();

    // remove any existing menu and cleanup listener
    document.getElementById('message-context-menu')?.remove();
    if (closeMenuListener) {
        document.removeEventListener('click', closeMenuListener);
        closeMenuListener = null;
    }

    const menu = document.createElement('div');
    menu.id = 'message-context-menu';
    menu.className =
        'fixed bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-xl z-50 py-1 min-w-[150px]';
    menu.style.left = `${e.clientX || e.touches?.[0]?.clientX || 0}px`;
    menu.style.top = `${e.clientY || e.touches?.[0]?.clientY || 0}px`;

    const editOption = document.createElement('div');
    editOption.className = 'px-4 py-2 hover:bg-gray-700 cursor-pointer text-sm text-white';
    editOption.textContent = 'edit and resend';
    editOption.onclick = () => {
        apiChatInput.value = content;
        cleanupContextMenu();
        apiChatInput.focus();
    };

    const resendOption = document.createElement('div');
    resendOption.className = 'px-4 py-2 hover:bg-gray-700 cursor-pointer text-sm text-white';
    resendOption.textContent = 'resend';
    resendOption.onclick = () => {
        apiChatInput.value = content;
        cleanupContextMenu();
        sendApiMessage();
    };

    menu.appendChild(editOption);
    menu.appendChild(resendOption);
    document.body.appendChild(menu);

    // close menu on click elsewhere or escape key
    closeMenuListener = function handleCloseMenu(e) {
        if (!menu.contains(e.target)) {
            cleanupContextMenu();
        }
    };
    document.addEventListener('click', closeMenuListener, { once: true });

    // also close on escape key
    const escapeListener = function handleEscape(e) {
        if (e.key === 'Escape') {
            cleanupContextMenu();
            document.removeEventListener('keydown', escapeListener);
        }
    };
    document.addEventListener('keydown', escapeListener, { once: true });
}

function cleanupContextMenu() {
    document.getElementById('message-context-menu')?.remove();
    if (closeMenuListener) {
        document.removeEventListener('click', closeMenuListener);
        closeMenuListener = null;
    }
}

function renderChatList() {
    chatList.innerHTML = '';
    const chatIds = Object.keys(chats);
    chatIds.forEach((chatId) => {
        const chat = chats[chatId];
        const div = document.createElement('div');
        div.className =
            'chat-item text-base p-3 rounded cursor-pointer hover:bg-white/10 font-bold ' +
            (chatId === currentChatId ? 'bg-white/20 text-white' : 'text-gray-400');
        div.textContent = chat.title;
        div.onclick = () => switchToChat(chatId);

        // delete button
        const delBtn = document.createElement('span');
        delBtn.textContent = ' ×';
        delBtn.className = 'float-right text-red-400 hover:text-red-200';
        delBtn.onclick = (e) => deleteChat(chatId, e);
        div.appendChild(delBtn);

        chatList.appendChild(div);
    });
}

function renderCurrentChat() {
    if (!currentChatId || !chats[currentChatId]) {
        chatMessages.innerHTML =
            '<div class="text-center text-gray-500 mt-10">select or create a chat to begin.</div>';
        return;
    }
    chatMessages.innerHTML = '';
    const messages = chats[currentChatId].messages;
    messages.forEach((msg) => {
        appendMessage(msg.role, msg.content, false);
    });
    if (messages.length === 0) {
        chatMessages.innerHTML =
            '<div class="text-center text-gray-500 mt-10">start chatting below.</div>';
    }
}

function generateChatTitle(messages) {
    // use first user message as title, or generate from first assistant response
    const firstUserMsg = messages.find((m) => m.role === 'user');
    if (firstUserMsg) {
        let title = firstUserMsg.content.substring(0, 25);
        if (firstUserMsg.content.length > 25) {
            title += '...';
        }
        return title.toLowerCase();
    }
    return 'chat ' + Date.now();
}

function exportChat() {
    if (!currentChatId || !chats[currentChatId]) {
        showToast('no chat to export');
        return;
    }
    const modelName = getCurrentModelName();
    let exportText = '';
    chats[currentChatId].messages.forEach((msg) => {
        const label = msg.role === 'user' ? 'from (house)' : 'from (' + modelName + ')';
        exportText += label + ': ' + msg.content + '\n\n';
    });

    // copy to clipboard
    navigator.clipboard
        .writeText(exportText)
        .then(() => {
            showToast('chat exported to clipboard');
        })
        .catch(() => {
            showToast('failed to export');
        });
}

function summarizeChat() {
    if (!currentChatId || !chats[currentChatId]) {
        showToast('no chat to summarize');
        return;
    }
    const messages = chats[currentChatId].messages;
    if (messages.length < 4) {
        showToast('need more messages to summarize');
        return;
    }

    // get last few messages to summarize
    const recentMessages = messages.slice(-6);
    const summaryPrompt = 'summarize this conversation briefly in lowercase: ';
    const conversationText = recentMessages.map((m) => m.role + ': ' + m.content).join('\n');

    // set the summary request in the input and let sendApiMessage handle everything
    apiChatInput.value = summaryPrompt + conversationText;
    sendApiMessage();
}

function getCurrentModelName() {
    if (currentApiMode === 'openrouter-api') {
        const model = getActiveOpenrouterModel() || DEFAULT_OPENROUTER_MODEL;
        return model?.split('/')[1] || 'openrouter';
    }
    if (currentApiMode === 'huggingface-api') {
        const hfDropdown = document.getElementById('hf-model-dropdown');
        return hfDropdown?.value?.split('/')[1] || 'huggingface';
    }
    if (currentApiMode === 'deepseek-api') {
        return 'deepseek';
    }
    if (currentApiMode === 'mistral-api') {
        return 'mistral';
    }
    if (currentApiMode === 'gemini-api') {
        return 'gemini';
    }
    if (currentApiMode === 'llama-offline') {
        return 'gemma 4 (offline)';
    }
    return currentApiMode || 'unknown';
}

function showChatSidebar() {
    if (chatSidebar) {
        chatSidebar.classList.remove('hidden');
        chatSidebar.classList.add('flex');
    }
}

function hideChatSidebar() {
    if (chatSidebar) {
        chatSidebar.classList.add('hidden');
        chatSidebar.classList.remove('flex');
    }
}

// file input used for changing homepage card icons via upload
const iconFileInput = document.createElement('input');
iconFileInput.type = 'file';
iconFileInput.accept = 'image/*';
iconFileInput.className = 'hidden';
document.body.appendChild(iconFileInput);

function requestIconUpload(model, _card) {
    const modelId = model.id;
    
    iconFileInput.onchange = () => {
        const file = iconFileInput?.files?.[0];
        if (!file) {
            showToast('no file selected');
            return;
        }
        
        if (!file.type.startsWith('image/')) {
            showToast('please select an image file');
            return;
        }
        
        // Resize large images before saving
        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        img.onload = () => {
            // Validate image dimensions
            if (img.width === 0 || img.height === 0) {
                showToast('invalid image file');
                return;
            }

            // Resize to max 256x256
            const maxSize = 256;
            let width = img.width;
            let height = img.height;

            if (width > maxSize || height > maxSize) {
                if (width > height) {
                    height = (height / width) * maxSize;
                    width = maxSize;
                } else {
                    width = (width / height) * maxSize;
                    height = maxSize;
                }
            }

            canvas.width = width;
            canvas.height = height;

            try {
                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/png');

                // Validate that canvas has content (data URL should be reasonably sized)
                if (dataUrl.length < 200) {
                    showToast('failed to process image');
                    return;
                }

                // Save to localStorage
                if (saveCardIcon(modelId, dataUrl)) {
                    // Simply regenerate the entire UI - most reliable approach
                    generateUI();
                    showToast('icon updated!');
                }
            } catch (error) {
                dlog.error('canvas drawing failed', error);
                showToast('failed to process image');
            }
        };
        
        img.onerror = () => {
            showToast('invalid image file');
        };
        
        // Read file as data URL for the image src
        const reader = new FileReader();
        reader.onload = (e) => {
            img.src = e.target.result;
        };
        reader.onerror = () => {
            showToast('failed to read file');
        };
        reader.readAsDataURL(file);
    };
    iconFileInput.value = '';
    iconFileInput.click();
}

function fitHomepage() {
    if (!homepageContainer || !homepageGrid) {
        return;
    }
    homepageContainer.style.overflowY = 'auto';
    homepageGrid.style.transform = '';
    homepageGrid.style.transformOrigin = '';
}

window.addEventListener('resize', fitHomepage);

// initialize
(async function init() {
    try {
        // listen for electron hot reload signal (once at init, not on every message)
        if (window.electronAPI && window.electronAPI.onHotReload) {
            window.electronAPI.onHotReload(() => {
                location.reload();
            });
        }

        // network status handling
        const networkStatusEl = document.getElementById('network-status');
        let isOnline = navigator.onLine;
        let lastNetworkToast = 0;

        function updateNetworkStatus() {
            const now = Date.now();
            const wasOnline = isOnline;
            isOnline = navigator.onLine;
            if (networkStatusEl) {
                if (isOnline) {
                    networkStatusEl.classList.add('hidden');
                    networkStatusEl.classList.remove('flex');
                    if (!wasOnline && now - lastNetworkToast > 3000) {
                        dlog.log('back online');
                        showToast('back online');
                        lastNetworkToast = now;
                    }
                } else {
                    networkStatusEl.classList.remove('hidden');
                    networkStatusEl.classList.add('flex');
                    dlog.warn('went offline');
                    if (now - lastNetworkToast > 3000) {
                        showToast('you are offline - some features may not work');
                        lastNetworkToast = now;
                    }
                }
            }
        }

        window.addEventListener('online', updateNetworkStatus);
        window.addEventListener('offline', updateNetworkStatus);
        // initial check
        updateNetworkStatus();

        // llama offline connectivity check and popup logic
        let lastConnectivityCheck = 0;
        const CONNECTIVITY_CHECK_INTERVAL = 30000; // 30 seconds
        let connectivityState = { online: true, reachable: true };

        async function checkConnectivity() {
            const now = Date.now();
            if (now - lastConnectivityCheck < CONNECTIVITY_CHECK_INTERVAL) {
                return connectivityState;
            }
            
            lastConnectivityCheck = now;
            
            // First check navigator.onLine as quick indicator
            if (!navigator.onLine) {
                connectivityState = { online: false, reachable: false };
                return connectivityState;
            }

            // Perform actual reachability check
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                
                // Try multiple endpoints for reliability
                const endpoints = [
                    'https://www.google.com/generate_204',
                    'https://www.cloudflare.com/cdn-cgi/trace'
                ];
                
                for (const url of endpoints) {
                    try {
                        const response = await fetch(url, { 
                            method: 'HEAD', 
                            mode: 'no-cors',
                            signal: controller.signal 
                        });
                        clearTimeout(timeoutId);
                        connectivityState = { online: true, reachable: true };
                        return connectivityState;
                    } catch (e) {
                        continue;
                    }
                }
                
                clearTimeout(timeoutId);
                connectivityState = { online: true, reachable: false };
                return connectivityState;
            } catch {
                connectivityState = { online: navigator.onLine, reachable: false };
                return connectivityState;
            }
        }

        // offline popup logic
        async function handleOfflinePopup() {
            const status = await checkConnectivity();
            
            // Only show popup when offline and not already shown recently
            if (status.reachable) { return; }
            
            const settings = JSON.parse(localStorage.getItem('llms_offline_llama_settings') || '{}');
            
            if (settings.neverAskAgain || !settings.offerEnabled) { return; }
            
            const hoursSinceLastOffer = (Date.now() - (settings.lastOfferTimestamp || 0)) / (1000 * 60 * 60);
            if (hoursSinceLastOffer < 1) { return; }
            
            const modelStatus = JSON.parse(localStorage.getItem('llms_llama_model_status') || '{}');
            if (modelStatus.downloaded) { return; }
            
            // Show offline popup
            showOfflinePopup();
        }

        function showOfflinePopup() {
            // Create popup if doesn't exist
            let popup = document.getElementById('offline-llama-popup');
            if (!popup) {
                popup = document.createElement('div');
                popup.id = 'offline-llama-popup';
                popup.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
                popup.innerHTML = `
                    <div class="bg-[#1a1a1a] rounded-xl p-6 max-w-md mx-4 border border-gray-700 shadow-2xl">
                        <h3 class="text-xl font-bold text-white mb-3">no internet connection</h3>
                        <p class="text-gray-300 mb-4">you are offline. would you like to enable llama offline mode for on-device ai?</p>
                        <p class="text-sm text-gray-400 mb-6">this downloads a small ai model (~500mb-800mb) that works without internet.</p>
                        <div class="flex gap-3">
                            <button id="enable-llama-btn" class="flex-1 bg-[#f5af12] text-black px-4 py-2 rounded-lg font-medium hover:bg-[#e0a010]">
                                enable now
                            </button>
                            <button id="remind-later-btn" class="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-600">
                                remind later
                            </button>
                            <button id="never-ask-btn" class="px-4 py-2 text-gray-400 hover:text-gray-300">
                                never
                            </button>
                        </div>
                    </div>
                `;
                document.body.appendChild(popup);
                
                // Button handlers
                document.getElementById('enable-llama-btn').onclick = async () => {
                    popup.classList.add('hidden');
                    
                    // For APK, force the download path even if manager detection missed it
                    if (typeof llamaOfflineManager !== 'undefined') {
                        // Re-detect APK status in case it wasn't available at init
                        const isApk = typeof window.Capacitor !== 'undefined' || 
                                      window.AndroidBridge !== undefined;
                        if (isApk) {
                            llamaOfflineManager.isApkVariant = true;
                        }
                    }
                    
                    await enableLlamaOffline();
                };
                
                document.getElementById('remind-later-btn').onclick = () => {
                    const settings = JSON.parse(localStorage.getItem('llms_offline_llama_settings') || '{}');
                    settings.lastOfferTimestamp = Date.now();
                    localStorage.setItem('llms_offline_llama_settings', JSON.stringify(settings));
                    popup.classList.add('hidden');
                };
                
                document.getElementById('never-ask-btn').onclick = () => {
                    const settings = JSON.parse(localStorage.getItem('llms_offline_llama_settings') || '{}');
                    settings.neverAskAgain = true;
                    localStorage.setItem('llms_offline_llama_settings', JSON.stringify(settings));
                    popup.classList.add('hidden');
                };
            }
            
            popup.classList.remove('hidden');
            
            // Record offer shown
            const settings = JSON.parse(localStorage.getItem('llms_offline_llama_settings') || '{}');
            settings.lastOfferTimestamp = Date.now();
            localStorage.setItem('llms_offline_llama_settings', JSON.stringify(settings));
            
            // Telemetry event
            if (typeof telemetry !== 'undefined') {
                telemetry.track('offline_llama_offer_shown');
            }
        }

        async function enableLlamaOffline() {
            if (typeof llamaOfflineManager === 'undefined') {
                showToast('llama offline not available');
                return;
            }
            
            const manager = llamaOfflineManager;
            
            // Re-check APK status at runtime for accuracy
            const isApk = typeof window.Capacitor !== 'undefined' || 
                          window.AndroidBridge !== undefined ||
                          manager.isApkVariant;
            
            if (isApk && !manager.isApkVariant) {
                manager.isApkVariant = true;
            }
            
            if (!isApk) {
                showToast('offline models require apk version');
                setTimeout(() => {
                    alert('to use llama offline mode, please install the android apk version');
                }, 500);
                return;
            }
            
            showToast('downloading llama model (~500mb)...');
            
            try {
                // APK variant - download model
                let lastProgress = 0;
                await manager.downloadModel((progress) => {
                    // Show progress every 10%
                    if (progress - lastProgress >= 10) {
                        showToast(`downloading: ${progress}%`);
                        lastProgress = progress;
                    }
                });
                
                showToast('model downloaded! initializing...');
                
                // Initialize inference engine
                await manager.initInferenceEngine();
                showToast('gemma 4 offline ready!');
                
                // Auto-switch to llama provider
                selectModelById('llama-offline');
                
                // Save settings
                manager.saveSettings({ enabled: true });
                
                // Telemetry
                if (typeof telemetry !== 'undefined') {
                    telemetry.track('offline_llama_enabled');
                    telemetry.track('offline_llama_download_ready');
                }
            } catch (error) {
                dlog.error('failed to enable llama offline:', error);
                showToast('download failed: ' + error.message);
                
                if (typeof telemetry !== 'undefined') {
                    telemetry.track('offline_llama_download_failed', { error: error.message });
                }
            }
        }

        // Show download prompt when user tries to chat without model
        function showLlamaDownloadPrompt() {
            const isNativeAndroid = window.AndroidBridge !== undefined;
            
            // Remove existing prompt to avoid stale state
            document.getElementById('llama-download-prompt')?.remove();
            
            const prompt = document.createElement('div');
            prompt.id = 'llama-download-prompt';
            prompt.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
            prompt.innerHTML = `
                <div class="bg-[#1a1a1a] rounded-xl p-6 max-w-md mx-4 border border-gray-700 shadow-2xl">
                    <h3 class="text-xl font-bold text-[#f5af12] mb-3">offline gemma model</h3>
                    <div id="llama-status-content">
                        <p class="text-gray-300 mb-2">checking status...</p>
                    </div>
                    <div id="llama-progress-bar" class="hidden w-full bg-gray-700 rounded-full h-3 mb-3">
                        <div id="llama-progress-fill" class="bg-[#f5af12] h-3 rounded-full transition-all" style="width: 0%"></div>
                    </div>
                    <p id="llama-progress-text" class="hidden text-[#f5af12] text-sm mb-3 text-center font-mono"></p>
                    <div class="flex gap-3 mt-4">
                        <button id="download-now-btn" class="flex-1 bg-[#f5af12] text-black px-4 py-3 rounded-lg font-bold text-base hover:bg-[#e0a010] hidden">
                            download model (~2.9 gb)
                        </button>
                        <button id="download-later-btn" class="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-600">
                            later
                        </button>
                    </div>
                    <p id="llama-debug-info" class="text-gray-600 text-xs mt-3 font-mono"></p>
                </div>
            `;
            document.body.appendChild(prompt);
            
            let pollInterval = null;
            let downloadInitiated = false;
            
            const updateStatus = () => {
                const statusContent = document.getElementById('llama-status-content');
                const downloadBtn = document.getElementById('download-now-btn');
                const progressBar = document.getElementById('llama-progress-bar');
                const progressFill = document.getElementById('llama-progress-fill');
                const progressText = document.getElementById('llama-progress-text');
                const debugInfo = document.getElementById('llama-debug-info');
                
                if (!isNativeAndroid) {
                    statusContent.innerHTML = '<p class="text-yellow-400 mb-2">requires android apk version</p>';
                    downloadBtn.classList.add('hidden');
                    return;
                }
                
                // Ensure AndroidBridge is available
                if (!window.AndroidBridge || !window.AndroidBridge.getLlamaServerStatus) {
                    statusContent.innerHTML = '<p class="text-gray-400 mb-2">initializing...</p>';
                    downloadBtn.classList.add('hidden');
                    return;
                }
                
                let status = window.AndroidBridge.getLlamaServerStatus();
                // Ensure status is a string
                if (status === null || status === undefined) {
                    status = 'initializing';
                }
                
                let detailed = '{}';
                try { 
                    detailed = window.AndroidBridge.getDetailedStatus(); 
                } catch(e) { /* empty */ }
                
                let info = {};
                try { 
                    info = JSON.parse(detailed); 
                } catch(e) {
                    info = {};
                }
                
                // Log for debugging
                dlog.log('Llama status: ' + status + ', progress: ' + (info.downloadProgress || 0));
                
                // Show error prominently if present
                if (info.lastError) {
                    debugInfo.textContent = 'error: ' + info.lastError;
                    debugInfo.className = 'text-red-400 text-xs mt-3 font-mono break-words';
                } else {
                    debugInfo.textContent = detailed;
                    debugInfo.className = 'text-gray-400 text-xs mt-3 font-mono break-words';
                }
                
                if (status === 'error') {
                    statusContent.innerHTML = `
                        <p class="text-red-400 mb-2 text-lg font-bold">server error</p>
                        <p class="text-gray-400 text-sm">${info.lastError || 'unknown error - check debug info below'}</p>
                    `;
                    downloadBtn.classList.remove('hidden');
                    downloadBtn.textContent = 'retry download';
                    progressBar.classList.add('hidden');
                    progressText.classList.add('hidden');
                } else if (status === 'running') {
                    statusContent.innerHTML = `
                        <p class="text-green-400 mb-2 text-lg font-bold">server running</p>
                        <p class="text-gray-400 text-sm">local ai server is ready on port 5053. select 'gemma 4' to chat offline.</p>
                    `;
                    downloadBtn.classList.add('hidden');
                    progressBar.classList.add('hidden');
                    progressText.classList.add('hidden');
                    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
                } else if (status === 'downloading') {
                    const pct = info.downloadProgress || 0;
                    const sizeMB = info.modelSizeMB || 0;
                    // Handle 95%+ with more detailed messaging
                    if (pct >= 98) {
                        statusContent.innerHTML = `
                            <p class="text-yellow-400 mb-2 text-lg font-bold">almost done... ${pct}%</p>
                            <p class="text-gray-400 text-sm">finalizing download. this can take several minutes.</p>
                        `;
                    } else if (pct >= 95) {
                        statusContent.innerHTML = `
                            <p class="text-[#25a1da] mb-2 text-lg font-bold">downloading ${pct}%...</p>
                            <p class="text-gray-400 text-sm">finishing up - slowest part of download. be patient.</p>
                        `;
                    } else {
                        statusContent.innerHTML = `
                            <p class="text-[#25a1da] mb-2 text-lg font-bold">downloading model...</p>
                            <p class="text-gray-400 text-sm">gemma 4 4B is downloading. keep the app open.</p>
                        `;
                    }
                    progressBar.classList.remove('hidden');
                    progressFill.style.width = Math.min(pct, 100) + '%';
                    progressText.classList.remove('hidden');
                    progressText.textContent = pct + '% (' + sizeMB + ' MB downloaded)';
                    downloadBtn.classList.add('hidden');
                } else if (status === 'model_ready') {
                    statusContent.innerHTML = `
                        <p class="text-yellow-400 mb-2 text-lg font-bold">model ready</p>
                        <p class="text-gray-400 text-sm">model downloaded. tap start to run server.</p>
                    `;
                    downloadBtn.classList.remove('hidden');
                    downloadBtn.textContent = 'start server';
                    progressBar.classList.add('hidden');
                    progressText.classList.add('hidden');
                } else if (status === 'no_model' || status === 'not_bound') {
                    // If download was initiated but status hasn't updated yet, show starting state
                    if (downloadInitiated) {
                        statusContent.innerHTML = `
                            <p class="text-[#25a1da] mb-2 text-lg font-bold">starting download...</p>
                            <p class="text-gray-400 text-sm">preparing download. this may take a moment.</p>
                        `;
                        downloadBtn.classList.add('hidden');
                        progressBar.classList.remove('hidden');
                        progressFill.style.width = '5%';
                        progressText.classList.remove('hidden');
                        progressText.textContent = 'initializing...';
                        return;
                    }
                    
                    const freeMB = info.freeSpaceMB || 0;
                    const freeGB = (freeMB / 1024).toFixed(1);
                    statusContent.innerHTML = `
                        <p class="text-red-400 mb-2 text-lg font-bold">model not installed</p>
 <p class="text-gray-300 mb-2">download gemma 4 4B for offline ai chat.</p>
 <p class="text-gray-400 text-sm">size: ~2.9 GB | free space: ${freeGB} GB</p>
                        <p class="text-gray-500 text-xs mt-1">use wifi for fastest download.</p>
                    `;
                    downloadBtn.classList.remove('hidden');
                    downloadBtn.disabled = false;
                    downloadBtn.classList.remove('opacity-50');
                    downloadBtn.textContent = 'download model (~2.9 gb)';
                    progressBar.classList.add('hidden');
                    progressText.classList.add('hidden');
                } else {
                    statusContent.innerHTML = `<p class="text-gray-400 mb-2">status: ${status}</p>`;
                }
            };
            
            document.getElementById('download-now-btn').onclick = () => {
                if (window.AndroidBridge && window.AndroidBridge.startLlamaModelDownload) {
                    dlog.log('Starting model download via AndroidBridge');
                    downloadInitiated = true;
                    window.AndroidBridge.startLlamaModelDownload();
                    showToast('model download started - check notification bar');
                    
                    // Immediately update UI to show starting state
                    updateStatus();
                    
                    const btn = document.getElementById('download-now-btn');
                    btn.textContent = 'starting download...';
                    btn.disabled = true;
                    btn.classList.add('opacity-50');
                    
                    // Poll for progress updates every 3 seconds
                    if (pollInterval) { clearInterval(pollInterval); }
                    pollInterval = setInterval(() => {
                        updateStatus();
                        const status = window.AndroidBridge.getLlamaServerStatus();
                        // Update manager status when download starts or completes
                        if (status === 'downloading') {
                            downloadInitiated = false; // Clear flag once native side confirms
                        }
                        if (status === 'running' || status === 'model_ready') {
                            clearInterval(pollInterval);
                            pollInterval = null;
                            downloadInitiated = false;
                            showToast('model download complete!');
                            // IMPORTANT: Update the manager's status so it doesn't show prompt again
                            if (typeof llamaOfflineManager !== 'undefined') {
                                const recommended = llamaOfflineManager.selectModelForDevice();
                                llamaOfflineManager.modelStatus = {
                                    downloaded: true,
                                    modelId: recommended.id,
                                    path: '/data/data/com.example.llms/files/models/gemma-4-e4b-q4.gguf',
                                    size: recommended.size,
                                    version: '1.0.0',
                                    downloadProgress: 100
                                };
                                llamaOfflineManager.saveModelStatus();
                                llamaOfflineManager.saveSettings({ enabled: true });
                                dlog.log('Updated llamaOfflineManager status after download complete');
                            }
                            // Close the prompt after a short delay
                            setTimeout(() => {
                                prompt.remove();
                            }, 1500);
                        }
                    }, 3000);
                    
                    // Safety: stop polling after 2 hours
                    setTimeout(() => { if (pollInterval) { clearInterval(pollInterval); pollInterval = null; } }, 7200000);
                } else {
                    showToast('native bridge not available');
                }
            };
            
            document.getElementById('download-later-btn').onclick = () => {
                if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
                prompt.remove();
            };
            
            updateStatus();
        }

        // Run connectivity check at startup
        setTimeout(handleOfflinePopup, 3000);
        
        // Proactive: On Android APK, check if model needs download and show prompt
        if (window.AndroidBridge) {
            setTimeout(() => {
                try {
                    const status = window.AndroidBridge.getLlamaServerStatus();
                    dlog.log('Llama server status on launch: ' + status);
                    // Only show prompt if model is not present and we haven't dismissed before this session
                    if (status === 'no_model' || status === 'not_bound') {
                        const dismissed = sessionStorage.getItem('llama_prompt_dismissed');
                        if (!dismissed) {
                            dlog.log('Showing llama download prompt on launch');
                            showLlamaDownloadPrompt();
                        }
                    }
                } catch (e) {
                    dlog.warn('Failed to check llama status on launch:', e);
                }
            }, 3000);
        }
        
        // Check when going offline
        window.addEventListener('offline', () => {
            setTimeout(handleOfflinePopup, 1000);
        });

        // handle OAuth completion from Android in-app browser
        // this is triggered when user completes login in the native WebView
        window.addEventListener('oauth-complete', (e) => {
            dlog.log('OAuth completed for provider:', e.detail?.provider);
            showToast('sign-in completed - refresh if needed');
        });

        // Handle OAuth callback from Custom Tabs (Android)
        window.addEventListener('oauth-callback', (e) => {
            dlog.log('OAuth callback received:', e.detail?.url);
            showToast('authentication completed - returning to app');
        });

        // Handle app resume (returning from OAuth in browser)
        window.addEventListener('app-resumed', () => {
            dlog.log('App resumed - may need to refresh for auth state');
            // Optionally auto-refresh if in a webview context
            // showToast('returned to app - pull down to refresh if needed');
        });

        // Global handler for OAuth completion (called from Android)
        window.onOAuthComplete = function(provider) {
            dlog.log('OAuth complete callback for:', provider);
            showToast('sign-in successful');
        };

        // Global handler for OAuth callback URL
        window.onOAuthCallback = function(url) {
            dlog.log('OAuth callback URL:', url);
            showToast('authentication successful');
        };

        // Global handler for app resumed
        window.onAppResumed = function() {
            dlog.log('App resumed from background');
        };

        // lowercase current default prompt and save if not exists
        if (!localStorage.getItem('llms_system_prompt')) {
            saveSystemPrompt(defaultPrompt);
        }

        // generate UI components
        generateUI();
        // enforce blank header in case a model was previously active
        if (currentModelTitle) { currentModelTitle.textContent = ''; }
        navBtns.forEach((b) => b.classList.remove('active-nav'));
        homepageContainer.classList.remove('hidden');
        webviewContainer.classList.add('hidden');
        apiChatContainer.classList.add('hidden');
        // make sure grid fits vertically
        fitHomepage();
        // ensure attachment button is correctly hidden/shown
        updateAttachmentUI();
        restoreLastActiveTab();

        // if nocobase hasn't been configured and we haven't asked before, prompt now
        const nbcfg = getNocoBaseConfig();
        if (!nbcfg.apiKey && !localStorage.getItem('llms_nocobase_prompted')) {
            await showNocoBasePrompt();
        }

        // removed blackbox api key modal logic; always direct to website
    } catch (e) {
        dlog.error('init failed:', e);
        showToast('initialization error - see console');
    }
})();

// initialization for tom-select and electron view handling
// merged multiple DOMContentLoaded listeners for clarity
document.addEventListener('DOMContentLoaded', () => {
    if (window.TomSelect) {
        new TomSelect('#hf-model-dropdown', {
            create: true, // allow custom huggingface hubs
            sortField: { field: 'text', direction: 'asc' }
        }).on('change', updateAttachmentUI);
        openrouterTomSelect = new TomSelect('#or-model-dropdown', {
            create: false,
            sortField: { field: 'text', direction: 'asc' }
        });
        openrouterTomSelect.on('change', (value) => {
            saveOpenrouterModel(value);
            updateAttachmentUI();
        });
    }

    applyOpenrouterOptions();

    // ensure homepage hides BrowserViews on initial load
    if (window.electronAPI) {
        window.electronAPI.hideAllSites();
    }
});

// global error handler for uncaught errors
window.addEventListener('error', (e) => {
    dlog.error('uncaught error:', e.error);
    // don't show toast for every error - only critical ones
    if (e.error?.message?.includes('critical') || e.error?.message?.includes('fatal')) {
        showToast('an error occurred - check console for details');
    }
});

// global unhandled rejection handler
window.addEventListener('unhandledrejection', (e) => {
    dlog.error('unhandled promise rejection:', e.reason);
});

window.addEventListener('android-share', (event) => {
    try {
        handleAndroidSharePayload(event.detail);
    } catch (e) {
        dlog.error('android-share handler failed', e);
        showToast('unable to open shared link');
    }
});

// expose helper functions when running under Node/jest
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        escapeHtml,
        isValidDataUrl,
        fetchWithTimeout,
        getSystemPrompt,
        saveSystemPrompt,
        getNocoBaseConfig,
        isMobileDevice,
        getDisplayName,
        appendMessage,
        chatMessages,
        chats,
        chatHistory,
        trimChatHistory,
        MAX_CONTEXT_MESSAGES,
        MAX_STORED_CHAT_MESSAGES,
        currentChatId,
        switchToChat,
        setCurrentChatId,
        getCurrentChatId,
        loadChats,
        setCurrentApiMode,
        getCurrentApiMode,
        deleteChat,
        remoteSyncChats,
        // expose additional helpers as need for tests
    };
}
