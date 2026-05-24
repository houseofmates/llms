// tab-utils.test.js
// covers the friendly-tab-name resolution and the long-press close popup
// dom interactions. we don't load the whole script.js (it pulls in too many
// browser globals); instead we inline the small pure helper.

describe('getFriendlyTabName fallback logic', () => {
    // mirrors the implementation in script.js. keep this in sync.
    function makeResolver(openTabs, models) {
        return function getFriendlyTabName(tabId) {
            try {
                const tab = (openTabs || []).find((t) => t.id === tabId);
                if (!tab) return 'tab';
                const model = (models || []).find((m) => m.id === tab.modelId || m.id === tab.id);
                if (model && model.name) return model.name;
                if (tab.id === 'llama-offline') return 'gemma 4b';
                if (tab.id === 'rp' || tab.id === 'roleplay') return 'kimi k2.6 rp';
                return tab.label || 'tab';
            } catch (e) {
                return 'tab';
            }
        };
    }

    test('uses model.name when the model is registered', () => {
        const tabs = [{ id: 'deepseek', modelId: 'deepseek' }];
        const models = [{ id: 'deepseek', name: 'DeepSeek' }];
        expect(makeResolver(tabs, models)('deepseek')).toBe('DeepSeek');
    });

    test('falls back to "gemma 4b" for local llama', () => {
        const tabs = [{ id: 'llama-offline' }];
        expect(makeResolver(tabs, [])('llama-offline')).toBe('gemma 4b');
    });

    test('falls back to "kimi k2.6 rp" for the rp module', () => {
        const tabs = [{ id: 'rp' }];
        expect(makeResolver(tabs, [])('rp')).toBe('kimi k2.6 rp');
        expect(makeResolver([{ id: 'roleplay' }], [])('roleplay')).toBe('kimi k2.6 rp');
    });

    test('returns "tab" when nothing matches', () => {
        expect(makeResolver([], [])('missing')).toBe('tab');
    });
});

describe('tab close popup dom shape', () => {
    // we exercise the dom logic without pulling in script.js by inlining a
    // minimal version of the popup builder. this guards the contract: a
    // backdrop + popup get appended, the close button calls a provided
    // closeTab, and dismiss tears it down.
    function showPopup(anchorEl, tabId, closeTab) {
        const backdrop = document.createElement('div');
        backdrop.className = 'tab-close-popup-backdrop';
        document.body.appendChild(backdrop);
        const popup = document.createElement('div');
        popup.className = 'tab-close-popup';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'tab-close-popup-danger';
        closeBtn.textContent = '✕ close';
        closeBtn.addEventListener('click', () => {
            popup.remove();
            backdrop.remove();
            closeTab(tabId);
        });
        popup.appendChild(closeBtn);
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'cancel';
        cancelBtn.addEventListener('click', () => { popup.remove(); backdrop.remove(); });
        popup.appendChild(cancelBtn);
        document.body.appendChild(popup);
        return { popup, backdrop };
    }

    beforeEach(() => { document.body.innerHTML = ''; });

    test('shows backdrop + popup with close and cancel buttons', () => {
        const anchor = document.createElement('div');
        document.body.appendChild(anchor);
        const closeTab = jest.fn();
        showPopup(anchor, 'tab-1', closeTab);
        expect(document.querySelectorAll('.tab-close-popup-backdrop').length).toBe(1);
        const popup = document.querySelector('.tab-close-popup');
        expect(popup).toBeTruthy();
        const buttons = popup.querySelectorAll('button');
        expect(buttons.length).toBe(2);
        expect(buttons[0].textContent).toMatch(/close/);
        expect(buttons[1].textContent).toMatch(/cancel/);
    });

    test('clicking close triggers closeTab and removes the popup', () => {
        const anchor = document.createElement('div');
        document.body.appendChild(anchor);
        const closeTab = jest.fn();
        showPopup(anchor, 'tab-1', closeTab);
        document.querySelector('.tab-close-popup-danger').click();
        expect(closeTab).toHaveBeenCalledWith('tab-1');
        expect(document.querySelector('.tab-close-popup')).toBeNull();
        expect(document.querySelector('.tab-close-popup-backdrop')).toBeNull();
    });

    test('clicking cancel does not call closeTab', () => {
        const closeTab = jest.fn();
        showPopup(document.createElement('div'), 'tab-2', closeTab);
        const buttons = document.querySelector('.tab-close-popup').querySelectorAll('button');
        buttons[1].click();
        expect(closeTab).not.toHaveBeenCalled();
        expect(document.querySelector('.tab-close-popup')).toBeNull();
    });
});
