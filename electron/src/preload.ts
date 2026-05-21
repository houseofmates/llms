require('./rt/electron-rt');

// ── ipc bridge ────────────────────────────────────────────────────────────
// expose methods to the renderer so it can ask the main process to
// show/hide BrowserView tabs for each ai service.
// ─────────────────────────────────────────────────────────────────────────
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  showSite: (id: string, url: string) => ipcRenderer.send('show-site', id, url),
  hideAllSites: () => ipcRenderer.send('hide-all-sites'),
  reloadSite: (id: string) => ipcRenderer.send('reload-site', id),
  onHotReload: (cb: Function) => ipcRenderer.on('hot-reload', () => cb()),
  // platform detection
  platform: process.platform,
});

console.log('[preload] ipc bridge initialized — electronAPI exposed');
