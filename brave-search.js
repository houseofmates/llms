// brave-search.js
// thin client for the brave search api, plus helpers to decide when a question
// likely benefits from up-to-date web information and to fold results into a
// prompt block for the local gemma model.
//
// privacy: no logging of queries or results to localstorage. results live only
// in memory for the lifetime of the page; pressing the "clear search history"
// button in settings wipes the in-memory buffer.

(function () {
    if (typeof window === 'undefined') return;

    const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

    // words/patterns that typically signal a query needs fresh info.
    // intentionally conservative; users can always force a search with the button.
    const FRESH_KEYWORDS = [
        'current', 'latest', 'today', 'now', 'this week', 'this month',
        'news', 'breaking', 'recent', 'recently', 'as of', 'just announced',
        'weather', 'forecast', 'price', 'stock', 'score', 'live'
    ];

    // matches dates like 2024, 2025-01, jan 2025 etc.
    const DATE_RE = /\b(19|20)\d{2}\b/;

    function getBraveKey() {
        try {
            const keys = JSON.parse(localStorage.getItem('llms_api_keys') || '{}');
            return keys.brave || '';
        } catch (e) {
            return '';
        }
    }

    function isAutoSearchEnabled() {
        return localStorage.getItem('llms_brave_auto_search') === 'true';
    }

    function setAutoSearchEnabled(v) {
        localStorage.setItem('llms_brave_auto_search', v ? 'true' : 'false');
    }

    // returns true if the text contains any "needs fresh data" signal.
    function shouldAutoSearch(text) {
        if (!text || typeof text !== 'string') return false;
        const lower = text.toLowerCase();
        for (const kw of FRESH_KEYWORDS) {
            if (lower.includes(kw)) return true;
        }
        if (DATE_RE.test(text)) return true;
        return false;
    }

    // perform a brave search. returns an array of { title, url, description }
    // throws on auth/network errors so the caller can fall back.
    async function search(query, opts = {}) {
        const key = opts.apiKey || getBraveKey();
        if (!key) throw new Error('no brave api key configured');
        if (!query || !query.trim()) return [];
        const count = Math.max(1, Math.min(10, opts.count || 5));
        const url = `${BRAVE_ENDPOINT}?q=${encodeURIComponent(query)}&count=${count}`;
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'X-Subscription-Token': key
            }
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`brave search failed: ${res.status} ${body.substring(0, 200)}`);
        }
        const data = await res.json();
        const results = (data.web?.results || []).slice(0, count).map(r => ({
            title: r.title || '',
            url: r.url || '',
            description: (r.description || r.snippet || '').replace(/<[^>]+>/g, '')
        }));
        return results;
    }

    // formats results as a compact context block suitable for prepending to
    // gemma's system prompt.
    function formatResultsForPrompt(query, results) {
        if (!results || results.length === 0) return '';
        const lines = results.map((r, i) => {
            const desc = (r.description || '').replace(/\s+/g, ' ').trim();
            return `[${i + 1}] ${r.title}\n${r.url}\n${desc}`;
        });
        return [
            'use the following search results to answer the user\'s question. if the results are irrelevant, fall back to your own knowledge.',
            '',
            'search query: ' + query,
            '',
            'search results:',
            lines.join('\n\n')
        ].join('\n');
    }

    // in-memory buffer of recent search queries; cleared on demand. not
    // persisted, per the privacy requirement.
    const recentBuffer = [];
    function rememberQuery(q) {
        recentBuffer.unshift({ q, at: Date.now() });
        if (recentBuffer.length > 50) recentBuffer.length = 50;
    }
    function getRecentQueries() {
        return recentBuffer.slice();
    }
    function clearRecentQueries() {
        recentBuffer.length = 0;
    }

    window.BraveSearch = {
        ENDPOINT: BRAVE_ENDPOINT,
        getKey: getBraveKey,
        isAutoSearchEnabled,
        setAutoSearchEnabled,
        shouldAutoSearch,
        search,
        formatResultsForPrompt,
        rememberQuery,
        getRecentQueries,
        clearRecentQueries
    };
})();

// CommonJS export for jest tests
if (typeof module !== 'undefined' && module.exports) {
    // re-evaluate in a fake-window context for node
    module.exports = (function () {
        const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
        const FRESH_KEYWORDS = [
            'current', 'latest', 'today', 'now', 'this week', 'this month',
            'news', 'breaking', 'recent', 'recently', 'as of', 'just announced',
            'weather', 'forecast', 'price', 'stock', 'score', 'live'
        ];
        const DATE_RE = /\b(19|20)\d{2}\b/;

        function shouldAutoSearch(text) {
            if (!text || typeof text !== 'string') return false;
            const lower = text.toLowerCase();
            for (const kw of FRESH_KEYWORDS) {
                if (lower.includes(kw)) return true;
            }
            if (DATE_RE.test(text)) return true;
            return false;
        }

        async function search(query, opts = {}) {
            const key = opts.apiKey;
            if (!key) throw new Error('no brave api key configured');
            if (!query || !query.trim()) return [];
            const count = Math.max(1, Math.min(10, opts.count || 5));
            const url = `${BRAVE_ENDPOINT}?q=${encodeURIComponent(query)}&count=${count}`;
            const res = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json', 'X-Subscription-Token': key }
            });
            if (!res.ok) throw new Error(`brave search failed: ${res.status}`);
            const data = await res.json();
            return (data.web?.results || []).slice(0, count).map(r => ({
                title: r.title || '',
                url: r.url || '',
                description: (r.description || r.snippet || '').replace(/<[^>]+>/g, '')
            }));
        }

        function formatResultsForPrompt(query, results) {
            if (!results || results.length === 0) return '';
            const lines = results.map((r, i) => {
                const desc = (r.description || '').replace(/\s+/g, ' ').trim();
                return `[${i + 1}] ${r.title}\n${r.url}\n${desc}`;
            });
            return [
                'use the following search results to answer the user\'s question. if the results are irrelevant, fall back to your own knowledge.',
                '',
                'search query: ' + query,
                '',
                'search results:',
                lines.join('\n\n')
            ].join('\n');
        }

        return { ENDPOINT: BRAVE_ENDPOINT, shouldAutoSearch, search, formatResultsForPrompt };
    })();
}
