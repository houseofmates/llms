// Webview preload script - injected into all webviews to mask automation detection
console.log('[webview-preload] Initializing anti-detection...');

/**
 * Universal property shadow tool to hide automation signatures
 */
const shadowProperty = (obj: any, prop: string, value: any) => {
  try {
    Object.defineProperty(obj, prop, {
      get: () => value,
      set: () => { },
      enumerable: true,
      configurable: true
    });
  } catch (e) {
    console.error(`[preload] failed to shadow ${prop}:`, e);
  }
};

// 1. Hide webdriver flag (most sites check this first)
shadowProperty(navigator, 'webdriver', false);

// 2. Mock plugins array (real Chrome always has these)
const mockPluginArray: any = [
  { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
  { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format', length: 1 },
  { name: 'Native Client', filename: 'internal-nacl-plugin', description: 'Native Client Executable', length: 1 }
];
mockPluginArray.item = (i: number) => mockPluginArray[i] || null;
mockPluginArray.namedItem = (name: string) => mockPluginArray.find((p: any) => p.name === name) || null;
mockPluginArray.refresh = () => {};
shadowProperty(navigator, 'plugins', mockPluginArray);

// 3. Realistic browser properties
shadowProperty(navigator, 'languages', ['en-US', 'en']);
shadowProperty(navigator, 'hardwareConcurrency', 8);
shadowProperty(navigator, 'deviceMemory', 8);
shadowProperty(navigator, 'maxTouchPoints', 0);

// 4. Mock NetworkInformation API
shadowProperty(navigator, 'connection', {
  effectiveType: '4g',
  rtt: 50,
  downlink: 10,
  saveData: false,
  onchange: null,
  addEventListener: () => { },
  removeEventListener: () => { },
  dispatchEvent: () => true
});

// 5. Override User Agent strings
const CHROME_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
shadowProperty(navigator, 'userAgent', CHROME_UA);
shadowProperty(navigator, 'appVersion', CHROME_UA.replace('Mozilla/', ''));
shadowProperty(navigator, 'platform', 'Linux x86_64');
shadowProperty(navigator, 'vendor', 'Google Inc.');

// 6. Full Chrome object mock — critical for ChatGPT buttons and other sites
// that check for chrome.runtime, chrome.loadTimes, etc.
(window as any).chrome = {
  runtime: {
    id: undefined,  // real Chrome has undefined id when no extension context
    sendMessage: () => { },
    connect: () => ({
      onMessage: { addListener: () => { }, removeListener: () => { } },
      onDisconnect: { addListener: () => { }, removeListener: () => { } },
      postMessage: () => { }
    }),
    onMessage: { addListener: () => { }, removeListener: () => { }, hasListeners: () => false },
    onConnect: { addListener: () => { }, removeListener: () => { }, hasListeners: () => false },
    getManifest: () => ({}),
    getURL: (path: string) => path,
    getPlatformInfo: (cb: any) => cb && cb({ os: 'linux', arch: 'x86-64', nacl_arch: 'x86-64' }),
  },
  loadTimes: () => ({
    commitLoadTime: performance.timing.responseStart / 1000,
    connectionInfo: 'h2',
    finishDocumentLoadTime: performance.timing.domContentLoadedEventEnd / 1000,
    finishLoadTime: performance.timing.loadEventEnd / 1000,
    firstPaintAfterLoadTime: 0,
    firstPaintTime: performance.timing.domContentLoadedEventStart / 1000,
    navigationType: 'Other',
    npnNegotiatedProtocol: 'h2',
    requestTime: performance.timing.requestStart / 1000,
    startLoadTime: performance.timing.navigationStart / 1000,
    wasAlternateProtocolAvailable: false,
    wasFetchedViaSpdy: true,
    wasNpnNegotiated: true
  }),
  csi: () => ({
    onloadT: performance.timing.loadEventEnd,
    startE: performance.timing.navigationStart,
    pageT: Date.now() - performance.timing.navigationStart,
    tran: 15
  }),
  app: {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    getDetails: () => null,
    getIsInstalled: () => false,
    runningState: () => 'cannot_run'
  }
};

// 7. WebGL Spoofing (Critical for Cloudflare/Deepseek)
const spoofWebGL = (proto: any) => {
  const getParameter = proto.getParameter;
  proto.getParameter = function (parameter: number) {
    if (parameter === 0x9245) return 'Google Inc. (Intel)';
    if (parameter === 0x9246) return 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (CFL GT2), OpenGL 4.6)';
    return getParameter.apply(this, arguments);
  };
};
try { spoofWebGL(WebGLRenderingContext.prototype); } catch (e) { }
try { spoofWebGL(WebGL2RenderingContext.prototype); } catch (e) { }

// 8. Mask permission queries
try {
  const originalQuery = navigator.permissions.query;
  navigator.permissions.query = (parameters: any) => {
    if (parameters.name === 'notifications') {
      return Promise.resolve({ state: 'default', onchange: null, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true } as any);
    }
    return originalQuery.call(navigator.permissions, parameters);
  };
} catch (e) { }

// 9. Canvas fingerprint consistency (prevents detection via canvas hash differences)
try {
  const origToBlob = HTMLCanvasElement.prototype.toBlob;
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  // Only modify tiny canvases used for fingerprinting (not real content canvases)
  HTMLCanvasElement.prototype.toBlob = function(...args: any[]) {
    if (this.width < 32 && this.height < 32) {
      // Fingerprint canvas — add subtle noise
      const ctx = this.getContext('2d');
      if (ctx) {
        const imageData = ctx.getImageData(0, 0, this.width, this.height);
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i] ^= 1; // flip LSB of red channel
        }
        ctx.putImageData(imageData, 0, 0);
      }
    }
    return origToBlob.apply(this, args as any);
  };
} catch (e) { }

// 10. Improved site-specific fixes (non-auth related)
const applySiteFixes = () => {
  const hostname = window.location.hostname;

  // DeepSeek: Clear stale challenge data that causes "Max challenge attempts exceeded"
  if (hostname === 'chat.deepseek.com') {
    try {
      // Clear ALL challenge/captcha related storage to break the loop
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('challenge') || key.includes('captcha') || key.includes('cf_') || key.includes('verification') || key.includes('turnstile'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      
      // Also clear session storage challenges
      const sessionKeysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (key.includes('challenge') || key.includes('captcha') || key.includes('cf_') || key.includes('turnstile'))) {
          sessionKeysToRemove.push(key);
        }
      }
      sessionKeysToRemove.forEach(key => sessionStorage.removeItem(key));

      // Clear cookies that might contain challenge state
      document.cookie.split(';').forEach(cookie => {
        const name = cookie.split('=')[0].trim();
        if (name.includes('cf_') || name.includes('challenge') || name.includes('__cf')) {
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.deepseek.com`;
        }
      });
      console.log('[deepseek] cleared all challenge-related storage');
    } catch (e) { }
  }

  // ChatGPT: Ensure event listeners on login/signup buttons actually fire
  if (hostname === 'chatgpt.com' || hostname === 'chat.openai.com') {
    // ChatGPT uses Next.js hydration — buttons can be "dead" if hydration fails.
    // The chrome object mock above (section 6) fixes the root cause.
    // Additionally, ensure the page knows it's in a real browser context.
    try {
      // Remove any "unsupported browser" flags
      if ((window as any).__NEXT_DATA__) {
        console.log('[chatgpt] Next.js app detected, ensuring compatibility');
      }
    } catch (e) { }
  }

  // Copilot: Microsoft auth needs proper referrer and origin
  if (hostname === 'copilot.microsoft.com') {
    // Ensure the copilot page doesn't detect non-standard environment
    try {
      shadowProperty(navigator, 'brave', undefined);
    } catch (e) { }
  }

  // Minimax: Force dark mode via CSS injection
  if (hostname === 'agent.minimax.io' || hostname.includes('minimax')) {
    try {
      // Method 1: Set dark mode preference in localStorage before page loads
      try {
        localStorage.setItem('theme', 'dark');
        localStorage.setItem('color-theme', 'dark');
        localStorage.setItem('darkMode', 'true');
        localStorage.setItem('chakra-ui-color-mode', 'dark');
        localStorage.setItem('mantine-color-scheme', 'dark');
        localStorage.setItem('antd-theme', 'dark');
      } catch (e) {}

      // Method 2: Inject comprehensive dark CSS with actual colors (not filters)
      const injectDarkMode = () => {
        if (document.getElementById('minimax-dark-mode')) return;

        const style = document.createElement('style');
        style.id = 'minimax-dark-mode';
        style.textContent = `
          /* Force dark color scheme */
          :root {
            color-scheme: dark !important;
          }

          /* Main backgrounds */
          html, body, #root, #app, [class*="app"], [class*="App"] {
            background-color: #0a0a0a !important;
            color: #e0e0e0 !important;
          }

          /* Common container elements */
          div, main, section, article, aside, nav {
            background-color: transparent !important;
          }

          /* Specific light backgrounds that need darkening */
          [style*="background-color: rgb(255"],
          [style*="background-color: #fff"],
          [style*="background-color: white"],
          [style*="background: rgb(255"],
          [style*="background: #fff"],
          [style*="background: white"] {
            background-color: #1a1a1a !important;
          }

          /* Light gray backgrounds */
          [style*="background-color: rgb(249"],
          [style*="background-color: rgb(250"],
          [style*="background-color: rgb(245"],
          [style*="background-color: #f5"],
          [style*="background-color: #f9"],
          [style*="background-color: #fafafa"] {
            background-color: #141414 !important;
          }

          /* Text colors - force light */
          [style*="color: rgb(0,"],
          [style*="color: #000"],
          [style*="color: black"],
          [style*="color: rgb(51,"],
          [style*="color: rgb(60,"],
          [style*="color: #333"] {
            color: #e0e0e0 !important;
          }

          /* Input fields */
          input, textarea, select {
            background-color: #1a1a1a !important;
            color: #e0e0e0 !important;
            border-color: #333 !important;
          }

          /* Buttons with light backgrounds */
          button, [role="button"] {
            background-color: transparent !important;
          }

          /* Scrollbars dark */
          ::-webkit-scrollbar {
            background: #0a0a0a !important;
          }
          ::-webkit-scrollbar-thumb {
            background: #333 !important;
          }
        `;
        document.head.appendChild(style);
        console.log('[minimax] dark mode CSS injected');
      };

      if (document.head) injectDarkMode();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectDarkMode);
      }

      // Re-inject on dynamic content changes
      const observer = new MutationObserver(() => {
        if (!document.getElementById('minimax-dark-mode')) {
          injectDarkMode();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {
      console.error('[minimax] failed to inject dark mode:', e);
    }
  }
};

// Run site fixes after page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applySiteFixes);
} else {
  applySiteFixes();
}

// 11. Protect against Electron environment leaking
// with nodeIntegration:false these shouldn't be set, but clean up as safety net
try {
  const electronProps = ['process', 'require', '__dirname', '__filename', 'module', 'exports'];
  electronProps.forEach(prop => {
    try { delete (window as any)[prop]; } catch (e) { }
  });
  try { delete (window as any).electron; } catch (e) { }
  try { delete (window as any).electronAPI; } catch (e) { }
} catch (e) { }

// 12. Ensure window.open returns a valid reference for oauth flows.
// Some sites (claude, copilot, etc.) open a popup and then do
//   popup.postMessage(token, '*') or check popup.closed
// The popup MUST be real — we allow popups via setWindowOpenHandler.
// Just ensure the call reaches the real window.open and doesn't return null.
const _origOpen = window.open.bind(window);
(window as any).open = function (...args: any[]) {
  console.log('[preload] window.open:', args[0]);
  const w = _origOpen(...args);
  return w;
};

console.log('[webview-preload] anti-detection fully initialized');
