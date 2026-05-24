// rp-extensions.js
// bundled rp extensions. each entry implements the extension manifest:
//   { id, name, version, description, permissions, install(api) }
// the global `rpExtensions` manager loads anything in `window.rpBundledExtensions`
// at startup. users can enable/disable each one from the extensions tab.

(function () {
    if (!window) return;
    if (!Array.isArray(window.rpBundledExtensions)) {
        window.rpBundledExtensions = [];
    }

    // ----- /roll dN  -----
    // adds a dice roller slash command, e.g. /roll d20 or /roll 3d6+2
    window.rpBundledExtensions.push({
        id: 'sample.dice',
        name: 'dice roller',
        version: '1.0.0',
        description: 'adds a /roll slash command. usage: /roll d20, /roll 3d6+2, /roll 2d8-1',
        permissions: [],
        install(api) {
            api.registerSlashCommand('roll', (args) => {
                const text = String(args || '').trim() || 'd20';
                // parse format: optional count, d, sides, optional +/- modifier
                const m = text.match(/^(\d+)?\s*d\s*(\d+)\s*([+\-]\s*\d+)?\s*$/i);
                if (!m) return 'usage: /roll d20 | /roll 3d6+2';
                const count = Math.max(1, Math.min(50, parseInt(m[1] || '1', 10)));
                const sides = Math.max(2, Math.min(1000, parseInt(m[2], 10)));
                const mod = m[3] ? parseInt(m[3].replace(/\s+/g, ''), 10) : 0;
                const rolls = [];
                let total = 0;
                for (let i = 0; i < count; i++) {
                    const r = Math.floor(Math.random() * sides) + 1;
                    rolls.push(r);
                    total += r;
                }
                const finalTotal = total + mod;
                const modStr = mod ? (mod > 0 ? ` + ${mod}` : ` - ${Math.abs(mod)}`) : '';
                return `🎲 /roll ${text}: [${rolls.join(', ')}]${modStr} = **${finalTotal}**`;
            });
        }
    });

    // ----- character emotional expressions (demo) -----
    // listens for assistant messages and toasts the detected expression.
    // a stand-in to demonstrate the chat:afterReceive hook.
    window.rpBundledExtensions.push({
        id: 'sample.emotion-toast',
        name: 'emotion toast',
        version: '1.0.0',
        description: 'shows a brief toast with the detected expression after each assistant message',
        permissions: ['chat:read'],
        install(api) {
            api.on('chat:afterReceive', (payload) => {
                const exp = payload?.message?.expression;
                if (exp) api.notify('expression: ' + exp);
                return payload;
            });
        }
    });

    // ----- /clear -----
    // adds a convenience slash command to clear the active chat.
    window.rpBundledExtensions.push({
        id: 'sample.clear',
        name: 'clear command',
        version: '1.0.0',
        description: 'adds /clear to wipe the current chat history',
        permissions: ['chat:send'],
        install(api) {
            api.registerSlashCommand('clear', () => {
                if (window.rpModule?.currentGroup) {
                    window.rpModule.clearGroupChat();
                } else if (window.rpModule?.currentCharacter) {
                    window.rpModule.clearChat();
                }
                if (window.rpUI) window.rpUI.renderChat();
                return ''; // consume silently
            });
        }
    });
})();
