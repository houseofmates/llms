// llama-offline.js - Offline Llama Provider Module
// Provides connectivity detection, offline popup, and local Llama inference

const LLAMA_OFFLINE_SETTINGS_KEY = 'llms_offline_llama_settings';
const LLAMA_MODEL_STATUS_KEY = 'llms_llama_model_status';
const LLAMA_PROVIDER_ID = 'llama-offline';

// Default model - Gemma 4 4B IT OBLITERATED (unrefused, Q4_K_M)
const DEFAULT_LLAMA_MODEL = {
    id: 'gemma-4-e4b-it-obliterated-q4_k_m',
    name: 'Gemma 4 4B IT',
    url: 'https://huggingface.co/OBLITERATUS/gemma-4-E4B-it-OBLITERATED/resolve/main/gemma-4-E4B-it-OBLITERATED-Q4_K_M.gguf',
    size: 2900000000, // ~2.9GB
    quantization: 'Q4_K_M',
    contextLength: 8192,
    supportsImages: false,
    recommendedRamMB: 4096
};

// All devices use the same model now - Gemma 4 4B is the sweet spot
const FALLBACK_LLAMA_MODEL = DEFAULT_LLAMA_MODEL;
const PREMIUM_LLAMA_MODEL = DEFAULT_LLAMA_MODEL;
const ULTRA_LLAMA_MODEL = DEFAULT_LLAMA_MODEL;
const PIXEL_PRO_LLAMA_MODEL = DEFAULT_LLAMA_MODEL;

class LlamaOfflineManager {
    constructor() {
        this.settings = this.loadSettings();
        this.modelStatus = this.loadModelStatus();
        this.currentModel = null;
        this.inferenceEngine = null;
        this.isApkVariant = this.detectApkVariant();
    }

    loadSettings() {
        try {
            return JSON.parse(localStorage.getItem(LLAMA_OFFLINE_SETTINGS_KEY)) || {
                offerEnabled: true,
                neverAskAgain: false,
                autoDownload: true,
                preferCloudWhenOnline: false,
                lastOfferTimestamp: 0
            };
        } catch {
            return { offerEnabled: true, neverAskAgain: false, autoDownload: true, preferCloudWhenOnline: false, lastOfferTimestamp: 0 };
        }
    }

    saveSettings() {
        localStorage.setItem(LLAMA_OFFLINE_SETTINGS_KEY, JSON.stringify(this.settings));
    }

    loadModelStatus() {
        try {
            return JSON.parse(localStorage.getItem(LLAMA_MODEL_STATUS_KEY)) || {
                downloaded: false,
                modelId: null,
                path: null,
                size: 0,
                version: null,
                downloadProgress: 0
            };
        } catch {
            return { downloaded: false, modelId: null, path: null, size: 0, version: null, downloadProgress: 0 };
        }
    }

    saveModelStatus() {
        localStorage.setItem(LLAMA_MODEL_STATUS_KEY, JSON.stringify(this.modelStatus));
    }

    async syncModelStatusFromPlugin() {
        // For APK builds, check actual model status from native plugin
        if (this.isApkVariant && window.Capacitor?.Plugins?.LlamaOfflinePlugin) {
            try {
                const status = await window.Capacitor.Plugins.LlamaOfflinePlugin.checkModelStatus();
                if (status?.downloaded) {
                    this.modelStatus = {
                        downloaded: true,
                        modelId: status.modelId || 'gemma-4-e4b-it-obliterated-q4_k_m',
                        path: status.path,
                        size: status.size || 0,
                        version: '1.0.0',
                        downloadProgress: 100
                    };
                    this.saveModelStatus();
                    return true;
                }
            } catch (e) {
                console.log('[llama-offline] failed to sync model status from plugin:', e);
            }
        }
        return this.modelStatus.downloaded;
    }

    detectApkVariant() {
        // Detect if running as APK (Android native) vs web/PWA
        // Check multiple indicators for better reliability
        if (typeof window !== 'undefined') {
            // Check for Capacitor native platform
            if (typeof Capacitor !== 'undefined') {
                return Capacitor.isNativePlatform?.() || false;
            }
            // Check for AndroidBridge (injected by MainActivity)
            if (window.AndroidBridge) {
                return true;
            }
            // Check for Capacitor on window object (may be loaded later)
            if (window.Capacitor?.isNativePlatform?.()) {
                return true;
            }
        }
        return false;
    }

    async checkConnectivity() {
        // First check navigator.onLine as quick indicator
        if (!navigator.onLine) {
            return { online: false, reachable: false, timestamp: Date.now() };
        }

        // Perform actual reachability check
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            // Try multiple endpoints for reliability
            const endpoints = [
                'https://www.google.com/generate_204',
                'https://www.cloudflare.com/cdn-cgi/trace',
                'https://1.1.1.1/dns-query'
            ];
            
            for (const url of endpoints) {
                try {
                    const _response = await fetch(url, { 
                        method: 'HEAD', 
                        mode: 'no-cors',
                        signal: controller.signal 
                    });
                    clearTimeout(timeoutId);
                    return { online: true, reachable: true, timestamp: Date.now() };
                } catch (e) {
                    continue;
                }
            }
            
            clearTimeout(timeoutId);
            return { online: true, reachable: false, timestamp: Date.now() };
        } catch {
            return { online: navigator.onLine, reachable: false, timestamp: Date.now() };
        }
    }

    selectModelForDevice() {
        return DEFAULT_LLAMA_MODEL;
    }

    async autoDownloadOnInstall() {
        if (!this.isApkVariant) {
            return false;
        }

        if (this.modelStatus.downloaded) {
            return false;
        }

        if (!this.settings.autoDownload) {
            return false;
        }

        const firstInstallKey = 'llms_llama_first_install_checked';
        const hasChecked = localStorage.getItem(firstInstallKey);
        if (hasChecked) {
            return false;
        }
        localStorage.setItem(firstInstallKey, 'true');

        if (window.Capacitor?.Plugins?.LlamaOfflinePlugin) {
            try {
                console.log('[llama-offline] Auto-downloading Gemma 4 4B model');
                this.currentModel = DEFAULT_LLAMA_MODEL;
                await this.downloadModel();
                return true;
            } catch (e) {
                console.error('[llama-offline] Failed to auto-download model', e);
            }
        }

        return false;
    }

    shouldShowOfflinePopup(isOnline) {
        if (isOnline) { return false; }
        if (!this.settings.offerEnabled) { return false; }
        if (this.settings.neverAskAgain) { return false; }
        if (this.modelStatus.downloaded) { return false; }

        const hoursSinceLastOffer = (Date.now() - this.settings.lastOfferTimestamp) / (1000 * 60 * 60);
        if (hoursSinceLastOffer < 1) { return false; }

        return true;
    }

    recordOfferShown() {
        this.settings.lastOfferTimestamp = Date.now();
        this.saveSettings();
    }

    setNeverAskAgain(value) {
        this.settings.neverAskAgain = value;
        this.saveSettings();
    }

    setOfferEnabled(value) {
        this.settings.offerEnabled = value;
        this.saveSettings();
    }

    async downloadModel(_progressCallback) {
        // Use currentModel if already set (e.g., from autoDownloadOnInstall)
        const model = this.currentModel || this.selectModelForDevice();
        
        if (!this.isApkVariant) {
            throw new Error('model download only available in apk variant');
        }

        // Use native Android download mechanism via Capacitor plugin
        if (window.Capacitor?.Plugins?.LlamaOfflinePlugin) {
            try {
                const result = await window.Capacitor.Plugins.LlamaOfflinePlugin.downloadModel({
                    url: model.url,
                    modelId: model.id,
                    expectedSize: model.size
                });
                
                this.modelStatus = {
                    downloaded: true,
                    modelId: model.id,
                    path: result.path,
                    size: model.size,
                    version: '1.0.0',
                    downloadProgress: 100
                };
                this.saveModelStatus();
                
                return this.modelStatus;
            } catch (error) {
                throw new Error(`download failed: ${error.message}`);
            }
        }
        
        // Fallback: try to download via fetch (for testing in browser)
        if (!this.isApkVariant) {
            throw new Error('model download requires native plugin');
        }
        
        throw new Error('llama offline plugin not available');
    }

    async initInferenceEngine() {
        if (!this.modelStatus.downloaded) {
            throw new Error('model not downloaded');
        }

        // Initialize llama.cpp via native plugin or WebAssembly
        // Debug info for APK - use toast if available
        const debugMsg = (msg) => {
            console.log('[llama-offline] ' + msg);
            if (typeof showToast === 'function') {
                showToast('[debug] ' + msg);
            }
        };
        
        debugMsg('checking plugins...');
        debugMsg('Capacitor: ' + (typeof window.Capacitor !== 'undefined'));
        debugMsg('Plugins: ' + (typeof window.Capacitor?.Plugins !== 'undefined'));
        debugMsg('LlamaOfflinePlugin: ' + (typeof window.Capacitor?.Plugins?.LlamaOfflinePlugin !== 'undefined'));
        
        if (window.Capacitor?.Plugins?.LlamaOfflinePlugin) {
            debugMsg('found plugin, initInference...');
            try {
                const result = await window.Capacitor.Plugins.LlamaOfflinePlugin.initInference({
                    modelPath: this.modelStatus.path,
                    contextLength: DEFAULT_LLAMA_MODEL.contextLength
                });
                debugMsg('init success: ' + JSON.stringify(result));
                this.inferenceEngine = window.Capacitor.Plugins.LlamaOfflinePlugin;
                this.sessionId = result?.sessionId || 'default';
                return true;
            } catch (e) {
                debugMsg('init failed: ' + e.message);
                throw e;
            }
        }

        // Try WebAssembly fallback for browser testing
        if (window.LlamaEngine) {
            this.inferenceEngine = window.LlamaEngine;
            await this.inferenceEngine.load(this.modelStatus.path);
            return true;
        }

        throw new Error('no inference engine available');
    }

    async generateResponse(messages, options = {}) {
        if (!this.inferenceEngine) {
            await this.initInferenceEngine();
        }

        const { temperature = 0.7, maxTokens = 1024, stream = false } = options;

        // Format messages for Llama 3.2 chat format
        const prompt = this.formatLlamaPrompt(messages);

        if (this.inferenceEngine.generate) {
            const result = await this.inferenceEngine.generate({
                sessionId: this.sessionId || 'default',
                prompt,
                temperature,
                maxTokens,
                stream
            });
            return result.text || result.response || result;
        }

        throw new Error('inference engine not initialized');
    }

    formatLlamaPrompt(messages) {
        let prompt = '';

        for (const msg of messages) {
            if (msg.role === 'system') {
                prompt += `<start_of_turn>user\n${msg.content}<end_of_turn>\n`;
            } else if (msg.role === 'user') {
                prompt += `<start_of_turn>user\n${msg.content}<end_of_turn>\n`;
            } else if (msg.role === 'assistant') {
                prompt += `<start_of_turn>model\n${msg.content}<end_of_turn>\n`;
            }
        }

        prompt += '<start_of_turn>model\n';
        return prompt;
    }

    async deleteModel() {
        if (window.Capacitor?.Plugins?.LlamaOfflinePlugin) {
            await window.Capacitor.Plugins.LlamaOfflinePlugin.deleteModel();
        }
        
        this.modelStatus = { downloaded: false, modelId: null, path: null, size: 0, version: null, downloadProgress: 0 };
        this.saveModelStatus();
        this.inferenceEngine = null;
    }

    getStorageInfo() {
        if (!this.modelStatus.downloaded) {
            return { used: 0, modelSize: 0, available: 'unknown' };
        }
        return {
            used: this.modelStatus.size,
            modelSize: this.modelStatus.size,
            modelId: this.modelStatus.modelId,
            available: 'unknown' // Would need native API to get free storage
        };
    }

    isAvailable() {
        return this.modelStatus.downloaded && this.inferenceEngine !== null;
    }
}

// Create singleton instance
const llamaOfflineManager = new LlamaOfflineManager();

// Export for use in script.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        LlamaOfflineManager,
        llamaOfflineManager,
        LLAMA_PROVIDER_ID,
        DEFAULT_LLAMA_MODEL,
        FALLBACK_LLAMA_MODEL,
        PREMIUM_LLAMA_MODEL,
        ULTRA_LLAMA_MODEL,
        PIXEL_PRO_LLAMA_MODEL
    };
}
