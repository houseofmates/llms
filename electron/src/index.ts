import type { CapacitorElectronConfig } from '@capacitor-community/electron';
import { getCapacitorElectronConfig, setupElectronDeepLinking } from '@capacitor-community/electron';
import type { MenuItemConstructorOptions } from 'electron';
import { app, BrowserView, BrowserWindow, ipcMain, MenuItem, session } from 'electron';
import electronIsDev from 'electron-is-dev';
import unhandled from 'electron-unhandled';
import { autoUpdater } from 'electron-updater';
import { join } from 'path';

import { ElectronCapacitorApp, setupContentSecurityPolicy, setupReloadWatcher } from './setup';

// Intercept unhandled rejections to filter out spurious capacitor-electron errors
const originalListeners: any[] = [];
const originalOn = process.on.bind(process);
process.on = (event: any, listener: any) => {
  if (event === 'unhandledRejection') {
    originalListeners.push(listener);
    return process;
  }
  return originalOn(event, listener);
};

unhandled({ showDialog: true });

// Restore original behavior and wrap with filter
process.on = originalOn;
process.on('unhandledRejection', (reason: any) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  const msg = err.message || String(reason);
  if (msg.includes('ERR_FAILED') && msg.includes('capacitor-electron://')) {
    // Silently ignore this error
    return;
  }
  // Call original unhandled handler
  originalListeners.forEach(fn => fn(reason));
});

const trayMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [new MenuItem({ label: 'Quit App', role: 'quit' })];
const appMenuBarMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [
  { role: process.platform === 'darwin' ? 'appMenu' : 'fileMenu' },
  { role: 'viewMenu' },
];

const capacitorFileConfig: CapacitorElectronConfig = getCapacitorElectronConfig();
const myCapacitorApp = new ElectronCapacitorApp(capacitorFileConfig, trayMenuTemplate, appMenuBarMenuTemplate);

if (capacitorFileConfig.electron?.deepLinkingEnabled) {
  setupElectronDeepLinking(myCapacitorApp, {
    customProtocol: capacitorFileConfig.electron.deepLinkingCustomProtocol ?? 'mycapacitorapp',
  });
}

if (electronIsDev) {
  setupReloadWatcher(myCapacitorApp);
}

const CHROME_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ── browserview-per-tab architecture ──────────────────────────────────────
//   each ai site loads in its own BrowserView — a top-level browsing
//   context. unlike <webview> tags, BrowserViews are indistinguishable
//   from real chrome tabs, so oauth (google, microsoft, etc.) works.
// ─────────────────────────────────────────────────────────────────────────
const siteViews: Map<string, BrowserView> = new Map();
const SIDEBAR_WIDTH = 256;  // w-64 = 16rem = 256px
// NOTE: header has additional top/bottom padding (24px/8px) so the
// actual visible header area is taller than the base min-height.  If the
// BrowserView is positioned at exactly 56px it will overlap the lower
// portion of the header, which blocks clicks on the home icon/text.  Use
// a slightly larger value so views sit entirely below the bar.
const HEADER_HEIGHT = 80;
let activeSiteId: string | null = null;

function getContentBounds(mainWin: BrowserWindow) {
  const [winW, winH] = mainWin.getContentSize();
  return {
    x: SIDEBAR_WIDTH,
    y: HEADER_HEIGHT,
    width: Math.max(0, winW - SIDEBAR_WIDTH),
    height: Math.max(0, winH - HEADER_HEIGHT),
  };
}

function updateActiveBounds(mainWin: BrowserWindow) {
  if (!activeSiteId) return;
  const view = siteViews.get(activeSiteId);
  if (view && !view.webContents.isDestroyed()) {
    view.setBounds(getContentBounds(mainWin));
  }
}

function createSiteView(id: string, url: string): BrowserView {
  // contextIsolation MUST be false here so the preload script can actually
  // overwrite navigator.userAgent / navigator.webdriver in the page's JS
  // context. With contextIsolation:true the preload runs isolated and sites
  // would still see the real Electron UA string, causing login loops.
  const preloadPath = join(app.getAppPath(), 'build', 'src', 'webview-preload.js');
  const view = new BrowserView({
    webPreferences: {
      partition: 'persist:llms',
      nodeIntegration: false,
      contextIsolation: false,  // required for navigator spoofing to work
      sandbox: false,
      preload: preloadPath,
    },
  });

  view.webContents.setUserAgent(CHROME_UA);

  // allow popups — oauth flows open new windows for login
  view.webContents.setWindowOpenHandler((details) => {
    console.log(`[site:${id}] popup requested:`, details.url);
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 1000,
        height: 800,
        webPreferences: {
          partition: 'persist:llms',
          nodeIntegration: false,
          contextIsolation: false,
          sandbox: false,
          preload: preloadPath,
        },
      },
    };
  });

  // when an auth popup closes, reload the site to pick up session cookies
  view.webContents.on('did-create-window', (child) => {
    child.webContents.setUserAgent(CHROME_UA);
    child.on('closed', () => {
      console.log(`[site:${id}] popup closed — reloading to sync session`);
      if (!view.webContents.isDestroyed()) {
        view.webContents.reload();
      }
    });
    // allow nested popups (multi-step oauth chains like google -> account picker -> consent)
    child.webContents.setWindowOpenHandler((nested) => {
      console.log(`[site:${id}] nested popup:`, nested.url);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 900,
          height: 700,
          webPreferences: {
            partition: 'persist:llms',
            nodeIntegration: false,
            contextIsolation: false,
            sandbox: false,
            preload: preloadPath,
          },
        },
      };
    });
    // nested popup closes → reload parent
    child.webContents.on('did-create-window', (grandchild) => {
      grandchild.webContents.setUserAgent(CHROME_UA);
      grandchild.on('closed', () => {
        if (!view.webContents.isDestroyed()) view.webContents.reload();
      });
    });
  });

  view.webContents.loadURL(url);
  return view;
}

function hideAllViews(mainWin: BrowserWindow) {
  for (const [, view] of siteViews) {
    try { mainWin.removeBrowserView(view); } catch (e) { /* already removed */ }
  }
  activeSiteId = null;
}

// ── app lifecycle ─────────────────────────────────────────────────────────
(async () => {
  await app.whenReady();

  app.userAgentFallback = CHROME_UA;

  setupContentSecurityPolicy(myCapacitorApp.getCustomURLScheme());
  await myCapacitorApp.init();

  const mainWin = myCapacitorApp.getMainWindow();

  // keep active browserview sized to the content area on resize
  mainWin.on('resize', () => updateActiveBounds(mainWin));

  // ── ipc handlers ──────────────────────────────────────────────────
  ipcMain.on('show-site', (_event, id: string, url: string) => {
    console.log(`[ipc] show-site: ${id} -> ${url}`);
    hideAllViews(mainWin);

    let view = siteViews.get(id);
    if (!view || view.webContents.isDestroyed()) {
      view = createSiteView(id, url);
      siteViews.set(id, view);
    } else if (url) {
      try {
        const currentUrl = view.webContents.getURL();
        if (!currentUrl || currentUrl !== url) {
          view.webContents.loadURL(url);
        }
      } catch (err) {
        console.warn(`[site:${id}] failed to check/load url, forcing reload`, err);
        view.webContents.loadURL(url);
      }
    }

    mainWin.addBrowserView(view);
    view.setBounds(getContentBounds(mainWin));
    view.setAutoResize({ width: false, height: false });
    activeSiteId = id;
  });

  ipcMain.on('hide-all-sites', () => {
    console.log('[ipc] hide-all-sites');
    hideAllViews(mainWin);
  });

  ipcMain.on('reload-site', (_event, id: string) => {
    const view = siteViews.get(id);
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.reload();
    }
  });
})();

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async function () {
  if (myCapacitorApp.getMainWindow().isDestroyed()) {
    await myCapacitorApp.init();
  }
});

// ── session setup ─────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const setupSession = (sess: any) => {
    sess.setPermissionRequestHandler((_wc: any, _perm: string, cb: any) => cb(true));
    sess.setPermissionCheckHandler(() => true);

    // strip headers that break BrowserView loading or popup oauth flows:
    //   x-frame-options  – not needed for BrowserView (top-level) but harmless
    //   content-security-policy – can block inline scripts on some sites
    //   cross-origin-opener-policy – CRITICAL: same-origin COOP causes
    //     window.opener to be null in oauth popups, breaking postMessage
    //     callbacks back to the opener page (used by Claude, Lumo, etc.)
    sess.webRequest.onHeadersReceived((details: any, callback: any) => {
      const h = { ...details.responseHeaders };
      for (const key of Object.keys(h)) {
        const lk = key.toLowerCase();
        if (
          lk === 'x-frame-options' ||
          lk === 'content-security-policy' ||
          lk === 'content-security-policy-report-only' ||
          lk === 'cross-origin-opener-policy' ||
          lk === 'cross-origin-embedder-policy'
        ) {
          delete h[key];
        }
      }
      callback({ responseHeaders: h });
    });

    // spoof user-agent and client hints on all outgoing requests
    sess.webRequest.onBeforeSendHeaders((details: any, callback: any) => {
      details.requestHeaders['User-Agent'] = CHROME_UA;
      details.requestHeaders['sec-ch-ua'] = '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"';
      details.requestHeaders['sec-ch-ua-mobile'] = '?0';
      details.requestHeaders['sec-ch-ua-platform'] = '"Linux"';
      details.requestHeaders['accept-language'] = 'en-US,en;q=0.9';
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });
  };

  setupSession(session.defaultSession);
  setupSession(session.fromPartition('persist:llms'));

  app.on('web-contents-created', (_event, contents) => {
    contents.setUserAgent(CHROME_UA);
  });
});
