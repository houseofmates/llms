// bundle-env-keys.test.js
// covers the .env parser + bundled-keys file shape, and the rp module's
// preference for window.rpBundledKeys when present.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'scripts/bundle-env-keys.js');
const REPO_ROOT = path.resolve(__dirname);

// runs the bundler in a tempdir-copy of the repo so we don't smash the
// real .env / dist/ of the developer.
function runBundlerWithEnv(envText) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-env-test-'));
    // mirror the repo structure the script expects: scripts/ + (env at repoRoot)
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(tmp, 'scripts/bundle-env-keys.js'));
    if (envText !== null) {
        fs.writeFileSync(path.join(tmp, '.env'), envText);
    }
    execFileSync(process.execPath, [path.join(tmp, 'scripts/bundle-env-keys.js')], { stdio: 'ignore' });
    const out = fs.readFileSync(path.join(tmp, 'dist/rp-keys.bundled.js'), 'utf8');
    fs.rmSync(tmp, { recursive: true, force: true });
    return out;
}

// pulls window.rpBundledKeys out of the generated iife by evaluating it
// against a stub window.
function extractBundled(scriptSource) {
    const win = {};
    const fn = new Function('window', scriptSource);
    fn(win);
    return win.rpBundledKeys;
}

describe('bundle-env-keys script', () => {
    test('parses numbered NVIDIA_API_KEY_* and joins them with commas in order', () => {
        const out = runBundlerWithEnv([
            'NVIDIA_API_KEY_2=second',
            'NVIDIA_API_KEY_1=first',
            'NVIDIA_API_KEY_10=tenth'
        ].join('\n'));
        const bundled = extractBundled(out);
        // numeric sort: 1, 2, 10
        expect(bundled.nvidia).toBe('first,second,tenth');
    });

    test('tolerates quoted values and `export` prefix', () => {
        const out = runBundlerWithEnv([
            'NVIDIA_API_KEY_1="alpha"',
            "export NVIDIA_API_KEY_2='beta'",
            'NVIDIA_API_KEY_3=gamma'
        ].join('\n'));
        const bundled = extractBundled(out);
        expect(bundled.nvidia).toBe('alpha,beta,gamma');
    });

    test('skips comments, blanks, and non-nvidia env vars', () => {
        const out = runBundlerWithEnv([
            '# a comment',
            '',
            'NVIDIA_API_KEY_1=keep',
            'SOME_OTHER=ignored',
            '# NVIDIA_API_KEY_2=commented-out'
        ].join('\n'));
        const bundled = extractBundled(out);
        expect(bundled.nvidia).toBe('keep');
    });

    test('writes empty stub when no .env exists', () => {
        const out = runBundlerWithEnv(null);
        const bundled = extractBundled(out);
        expect(bundled.nvidia).toBe('');
    });

    test('skips blank-valued NVIDIA_API_KEY_* entries', () => {
        const out = runBundlerWithEnv([
            'NVIDIA_API_KEY_1=',
            'NVIDIA_API_KEY_2=real'
        ].join('\n'));
        const bundled = extractBundled(out);
        expect(bundled.nvidia).toBe('real');
    });
});

describe('RPModule prefers bundled keys', () => {
    // we need to load rp-module.js in a jsdom-ish environment with a
    // window.rpBundledKeys preseeded.
    let RPModule;

    beforeAll(() => {
        // jest's default env is jsdom (see jest.config.js), so window exists.
        window.rpBundledKeys = { nvidia: 'bundle-key-A,bundle-key-B' };
        // also seed localstorage with a stale ui key to prove bundled wins
        window.localStorage.setItem('llms_rp_api_keys', JSON.stringify({ nvidia: 'ui-stale' }));
        // require fresh
        jest.resetModules();
        ({ RPModule } = require('./rp-module.js'));
    });

    afterAll(() => {
        delete window.rpBundledKeys;
    });

    test('loadApiKeys seeds the keypool from bundled keys, ignoring localstorage', () => {
        const rp = new RPModule();
        // keypool internally stores comma-split keys
        expect(rp.keyPool.keys).toEqual(['bundle-key-A', 'bundle-key-B']);
    });

    test('getApiKeys reports bundled nvidia key plus a _bundled flag', () => {
        const rp = new RPModule();
        const ks = rp.getApiKeys();
        expect(ks.nvidia).toBe('bundle-key-A,bundle-key-B');
        expect(ks._bundled).toBe(true);
    });
});
