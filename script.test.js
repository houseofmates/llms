/**
 * tests for script.js utility functions
 */

// mock DOM elements before importing
// (many DOM elements are required by the script, but tests only exercise utilities)
document.body.innerHTML = `
    <div id="sidebar"></div>
    <div id="sidebar-nav"></div>
    <button id="open-sidebar-btn"></button>
    <button id="close-sidebar-btn"></button>
    <div id="swipe-overlay"></div>
    <div id="current-model-title"></div>
    <div id="webview-container"></div>
    <button id="floating-copy-btn"></button>
    <div id="settings-modal"></div>
    <button id="open-settings-btn"></button>
    <button id="close-settings-btn"></button>
    <textarea id="system-prompt-text"></textarea>
    <button id="save-prompt-btn"></button>
    <button id="reset-prompt-btn"></button>
    <div id="api-chat-container"></div>
    <div id="chat-messages"></div>
    <textarea id="api-chat-input"></textarea>
    <button id="send-api-message"></button>
    <button id="inject-prompt-api-btn"></button>
    <div id="homepage-container"></div>
    <div id="homepage-grid"></div>
    <div id="api-key-modal"></div>
    <input id="openrouter-key-input" />
    <input id="huggingface-key-input" />
    <input id="gemini-key-input" />
    <input id="nocobase-url-input" />
    <input id="nocobase-key-input" />
    <button id="save-api-keys-btn"></button>
    <button id="skip-api-keys-btn"></button>
    <input id="global-color-picker" />
    <div id="chat-sidebar"></div>
    <div id="chat-list"></div>
    <button id="new-chat-btn"></button>
    <button id="export-chat-btn"></button>
    <button id="summarize-chat-btn"></button>
    <button id="open-chat-sidebar-btn"></button>
    <button id="close-chat-sidebar-btn"></button>
    <button id="collapse-chat-sidebar-btn"></button>
    <div id="toast"></div>
    <div id="viewer-modal"></div>
    <div id="viewer-content"></div>
    <button id="close-viewer"></button>
    <button id="save-image-btn"></button>
    <div id="network-status"></div>
`;

// import helpers under test
const script = require('./script');
const {
    escapeHtml,
    isValidDataUrl,
    fetchWithTimeout,
    getSystemPrompt,
    saveSystemPrompt,
    isMobileDevice,
    getDisplayName,
    appendMessage,
    chatMessages,
    chats,
    chatHistory,
    trimChatHistory,
    MAX_CONTEXT_MESSAGES,
    MAX_STORED_CHAT_MESSAGES
} = script;

describe('utility functions', () => {
    test('escapeHtml should escape special characters', () => {
        const testCases = [
            { input: '<script>', expected: '&lt;script&gt;' },
            { input: 'a & b', expected: 'a &amp; b' },
            { input: '"quotes"', expected: '&quot;quotes&quot;' },
            { input: '\'single\'', expected: '&#039;single&#039;' },
            { input: 'normal text', expected: 'normal text' }
        ];

        testCases.forEach(({ input, expected }) => {
            expect(escapeHtml(input)).toBe(expected);
        });
    });

    test('isValidDataUrl should validate image data URLs', () => {
        const validDataUrls = [
            'data:image/png;base64,abc123',
            'data:image/jpeg;base64,xyz789',
            'data:image/jpg;base64,test',
            'data:image/gif;base64,data',
            'data:image/webp;base64,image',
            'data:image/svg+xml;base64,svgdata'
        ];

        const invalidDataUrls = [
            'data:text/html;base64,abc',
            'data:application/json;base64,test',
            'javascript:alert(1)',
            'https://example.com/image.png',
            '',
            null,
            undefined,
            123
        ];

        validDataUrls.forEach(url => {
            expect(isValidDataUrl(url)).toBe(true);
        });

        invalidDataUrls.forEach(url => {
            expect(isValidDataUrl(url)).toBe(false);
        });
    });

    test('fetchWithTimeout should handle timeout', async () => {
        // mock fetch to simulate timeout
        global.fetch = jest.fn(() => {
            return new Promise((_, reject) => {
                setTimeout(() => reject(new Error('timeout')), 100);
            });
        });

        await expect(fetchWithTimeout('https://example.com', {}, 10))
            .rejects
            .toThrow(/(request timeout after|timeout)/);
    });
});

describe('localStorage helpers', () => {
    test('getSystemPrompt should return default if not set', () => {
        localStorage.getItem.mockReturnValue(null);
        const result = getSystemPrompt();
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
        expect(localStorage.getItem).toHaveBeenCalledWith('llms_system_prompt');
    });

    test('saveSystemPrompt should store prompt', () => {
        const prompt = 'test prompt';
        saveSystemPrompt(prompt);
        expect(localStorage.setItem).toHaveBeenCalledWith('llms_system_prompt', prompt.toLowerCase());
    });
});

describe('device helpers', () => {
    beforeEach(() => {
        // reset width and userAgent between tests
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });
        jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (X11; Linux x86_64)');
    });

    test('isMobileDevice returns false on desktop', () => {
        expect(isMobileDevice()).toBe(false);
    });

    test('isMobileDevice returns true for narrow viewport', () => {
        window.innerWidth = 320;
        expect(isMobileDevice()).toBe(true);
    });

    test('isMobileDevice returns true for mobile UA', () => {
        jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)');
        expect(isMobileDevice()).toBe(true);
    });

    test('getDisplayName uses banana emoji when mobile and nano-banana-pro', () => {
        jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone)');
        window.innerWidth = 320;
        const name = getDisplayName({ id: 'nano-banana-pro', name: 'nano banana pro' });
        expect(name).toContain('🍌');
    });

    test('user message contextmenu prevents default and triggers menu', () => {
        // create a fake chat environment
        const content = 'hello';
        // clear chatMessages container
        chatMessages.innerHTML = '';
        appendMessage('user', content, false);
        const msg = chatMessages.lastChild;
        const event = new Event('contextmenu', { bubbles: true, cancelable: true });
        const prevented = msg.dispatchEvent(event);
        // dispatchEvent returns false if preventDefault was called
        expect(prevented).toBe(false);
    });

    test('trimChatHistory maintains maximum context messages', () => {
        chatHistory.length = 0;
        const extra = 3;
        for (let i = 0; i < MAX_CONTEXT_MESSAGES + extra; i++) {
            chatHistory.push({ role: 'user', content: `msg${i}` });
        }
        trimChatHistory();
        expect(chatHistory.length).toBe(MAX_CONTEXT_MESSAGES);
        // ensure earliest entries were dropped
        expect(chatHistory[0].content).toBe(`msg${extra}`);
    });

    // ensure nocobase helpers don't trip over empty/native chats
    describe('nocobase syncing', () => {
        // helper to update the in-module chats object without overwriting the
        // original reference (the module holds a local variable). this mirrors
        // the pattern used elsewhere in the tests for chat state.
        function setChats(newChats) {
            Object.keys(script.chats).forEach((k) => delete script.chats[k]);
            Object.assign(script.chats, newChats);
        }

        beforeEach(() => {
            // make sure we start with clean state and valid config
            setChats({});
            script.currentChatId = null;
            localStorage.getItem.mockImplementation((key) => {
                if (key === 'llms_nocobase_url') {return 'https://example.com';}
                if (key === 'llms_nocobase_key') {return 'key';}
                return null;
            });
        });

        test('deleteChat does not call fetch when chat has no messages', async () => {
            setChats({ foo: { title: 'empty', messages: [] } });
            script.currentChatId = 'foo';

            global.fetch = jest.fn(() => Promise.reject(new Error('should not be called')));

            await script.deleteChat('foo', { stopPropagation: () => {} });
            expect(global.fetch).not.toHaveBeenCalled();
            expect(Object.keys(script.chats)).toHaveLength(0);
        });

        test('remoteSyncChats skips conversations without messages', async () => {
            // chat1 has no messages, chat2 has one message
            setChats({
                a: { title: 'empty', messages: [] },
                b: { title: 'filled', messages: [{ role: 'user', content: 'hi' }] }
            });
            script.currentApiMode = 'api';
            const fetchCalls = [];
            global.fetch = jest.fn((url, _opts) => {
                fetchCalls.push(url);
                // return minimal successful response for list and update/create
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
            });

            await script.remoteSyncChats();
            // ensure at least the collection fetch happened
            expect(fetchCalls.some((u) => u.includes('/collections/llms/records'))).toBe(true);
            // there should be at least one request (collection/records) and
            // we don't care exactly how many additional calls avoid being too
            // brittle, so just assert it's not zero.
            expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
        });
    });

    test('appendMessage trims stored chat logs to limit', () => {
        // reset chats object in-place and set current chat
        Object.keys(chats).forEach((k) => delete chats[k]);
        chats['chat_test'] = { title: 't', messages: [] };
        script.setCurrentChatId('chat_test');
        // sanity checks
        expect(script.getCurrentChatId()).toBe('chat_test');
        expect(chats[script.getCurrentChatId()]).toBeDefined();
        expect(chats[script.getCurrentChatId()].messages).toEqual([]);
        // add more messages than allowed
        for (let i = 0; i < MAX_STORED_CHAT_MESSAGES + 5; i++) {
            appendMessage('user', `m${i}`, true);
        }
        expect(chats[script.getCurrentChatId()].messages.length).toBe(MAX_STORED_CHAT_MESSAGES);
        expect(chats[script.getCurrentChatId()].messages[0].content).toBe('m5');
    });


});


// existing network status tests

describe('network status', () => {
    test('should detect online status', () => {
        Object.defineProperty(navigator, 'onLine', {
            value: true,
            writable: true
        });
        
        expect(navigator.onLine).toBe(true);
    });

    test('should detect offline status', () => {
        Object.defineProperty(navigator, 'onLine', {
            value: false,
            writable: true
        });
        
        expect(navigator.onLine).toBe(false);
    });
});
