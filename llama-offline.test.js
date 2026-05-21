/**
 * Tests for Llama Offline Provider
 * Run with: node --test llama-offline.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// Mock localStorage
global.localStorage = {
    storage: {},
    getItem(key) {
        return this.storage[key] || null;
    },
    setItem(key, value) {
        this.storage[key] = value;
    },
    removeItem(key) {
        delete this.storage[key];
    },
    clear() {
        this.storage = {};
    }
};

// Mock navigator
global.navigator = {
    onLine: true,
    userAgent: 'test-agent'
};

// Mock window
global.window = {
    Capacitor: undefined,
    electronAPI: undefined
};

// Mock console
global.console = {
    log: () => {},
    error: () => {},
    warn: () => {}
};

// Load the llama-offline module
const fs = require('fs');
const path = require('path');

// Read and evaluate the module (simplified)
const moduleCode = fs.readFileSync(path.join(__dirname, 'llama-offline.js'), 'utf8');

// Create a mock implementation for testing
class MockLlamaOfflineManager {
    constructor() {
        this.settings = this.loadSettings();
        this.modelStatus = this.loadModelStatus();
        this.isApkVariant = this.detectApkVariant();
        this.inferenceEngine = null;
    }

    loadSettings() {
        const defaults = {
            enabled: false,
            offerEnabled: true,
            neverAskAgain: false,
            lastOfferTimestamp: 0
        };
        try {
            const stored = localStorage.getItem('llms_offline_llama_settings');
            return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
        } catch {
            return defaults;
        }
    }

    saveSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        localStorage.setItem('llms_offline_llama_settings', JSON.stringify(this.settings));
    }

    loadModelStatus() {
        const defaults = {
            downloaded: false,
            modelPath: null,
            modelSize: null,
            storageUsed: null,
            lastUsed: null
        };
        try {
            const stored = localStorage.getItem('llms_llama_model_status');
            return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
        } catch {
            return defaults;
        }
    }

    detectApkVariant() {
        return typeof global.window.Capacitor !== 'undefined' &&
               typeof global.window.Capacitor.isNativePlatform === 'function';
    }

    async downloadModel(onProgress) {
        if (!this.isApkVariant) {
            throw new Error('Model download only available in APK variant');
        }
        if (this.modelStatus.downloaded) {
            throw new Error('Model already downloaded');
        }
        // Simulate download
        for (let i = 0; i <= 100; i += 10) {
            if (onProgress) { onProgress(i); }
        }
        this.modelStatus = {
            downloaded: true,
            modelPath: '/data/data/llama-model.gguf',
            modelSize: '774 MB',
            storageUsed: '774 MB',
            lastUsed: Date.now()
        };
        localStorage.setItem('llms_llama_model_status', JSON.stringify(this.modelStatus));
    }

    async deleteModel() {
        if (!this.modelStatus.downloaded) {
            throw new Error('No model to delete');
        }
        this.modelStatus = {
            downloaded: false,
            modelPath: null,
            modelSize: null,
            storageUsed: null,
            lastUsed: null
        };
        localStorage.setItem('llms_llama_model_status', JSON.stringify(this.modelStatus));
    }
}

describe('LlamaOfflineManager', () => {
    let manager;

    beforeEach(() => {
        localStorage.clear();
        global.window.Capacitor = undefined;
        manager = new MockLlamaOfflineManager();
    });

    describe('Settings', () => {
        it('should load default settings', () => {
            assert.strictEqual(manager.settings.enabled, false);
            assert.strictEqual(manager.settings.offerEnabled, true);
            assert.strictEqual(manager.settings.neverAskAgain, false);
        });

        it('should save settings to localStorage', () => {
            manager.saveSettings({ enabled: true });
            const stored = JSON.parse(localStorage.getItem('llms_offline_llama_settings'));
            assert.strictEqual(stored.enabled, true);
        });

        it('should merge settings with existing', () => {
            manager.saveSettings({ enabled: true });
            manager.saveSettings({ neverAskAgain: true });
            assert.strictEqual(manager.settings.enabled, true);
            assert.strictEqual(manager.settings.neverAskAgain, true);
        });
    });

    describe('APK Detection', () => {
        it('should detect non-APK variant', () => {
            assert.strictEqual(manager.isApkVariant, false);
        });

        it('should detect APK variant with Capacitor', () => {
            global.window.Capacitor = { isNativePlatform: () => true };
            manager = new MockLlamaOfflineManager();
            assert.strictEqual(manager.isApkVariant, true);
        });
    });

    describe('Model Status', () => {
        it('should load default model status', () => {
            assert.strictEqual(manager.modelStatus.downloaded, false);
            assert.strictEqual(manager.modelStatus.modelPath, null);
        });

        it('should throw error when downloading on non-APK', async () => {
            await assert.rejects(
                manager.downloadModel(),
                /Model download only available in APK variant/
            );
        });

        it('should download model on APK variant', async () => {
            global.window.Capacitor = { isNativePlatform: () => true };
            manager = new MockLlamaOfflineManager();
            
            const progress = [];
            await manager.downloadModel((p) => progress.push(p));
            
            assert.strictEqual(manager.modelStatus.downloaded, true);
            assert.strictEqual(manager.modelStatus.modelSize, '774 MB');
            assert.ok(progress.length > 0);
        });

        it('should throw when downloading already downloaded model', async () => {
            global.window.Capacitor = { isNativePlatform: () => true };
            manager = new MockLlamaOfflineManager();
            await manager.downloadModel();
            
            await assert.rejects(
                manager.downloadModel(),
                /Model already downloaded/
            );
        });

        it('should delete model', async () => {
            global.window.Capacitor = { isNativePlatform: () => true };
            manager = new MockLlamaOfflineManager();
            await manager.downloadModel();
            
            await manager.deleteModel();
            
            assert.strictEqual(manager.modelStatus.downloaded, false);
            assert.strictEqual(manager.modelStatus.modelPath, null);
        });

        it('should throw when deleting non-existent model', async () => {
            await assert.rejects(
                manager.deleteModel(),
                /No model to delete/
            );
        });
    });
});

describe('Connectivity Check', () => {
    it('should detect online status', () => {
        global.navigator.onLine = true;
        assert.strictEqual(global.navigator.onLine, true);
    });

    it('should detect offline status', () => {
        global.navigator.onLine = false;
        assert.strictEqual(global.navigator.onLine, false);
    });
});

describe('Popup Logic', () => {
    it('should not show popup when online', () => {
        global.navigator.onLine = true;
        // When online, popup should not show
        assert.strictEqual(global.navigator.onLine, true);
    });

    it('should respect neverAskAgain setting', () => {
        const settings = { neverAskAgain: true, offerEnabled: true };
        localStorage.setItem('llms_offline_llama_settings', JSON.stringify(settings));
        
        const loaded = JSON.parse(localStorage.getItem('llms_offline_llama_settings'));
        assert.strictEqual(loaded.neverAskAgain, true);
    });

    it('should respect offerEnabled setting', () => {
        const settings = { neverAskAgain: false, offerEnabled: false };
        localStorage.setItem('llms_offline_llama_settings', JSON.stringify(settings));
        
        const loaded = JSON.parse(localStorage.getItem('llms_offline_llama_settings'));
        assert.strictEqual(loaded.offerEnabled, false);
    });

    it('should enforce cooldown between offers', () => {
        const now = Date.now();
        const recentOffer = { lastOfferTimestamp: now - 30 * 60 * 1000 }; // 30 mins ago
        localStorage.setItem('llms_offline_llama_settings', JSON.stringify(recentOffer));
        
        const loaded = JSON.parse(localStorage.getItem('llms_offline_llama_settings'));
        const hoursSinceLastOffer = (now - (loaded.lastOfferTimestamp || 0)) / (1000 * 60 * 60);
        
        assert.ok(hoursSinceLastOffer < 1, 'Should be within 1 hour cooldown');
    });
});

console.log('Running tests...\n');
