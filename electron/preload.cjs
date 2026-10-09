// Preload (CommonJS, sandboxed): the only surface the renderer gets.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mb', {
  info: () => ipcRenderer.invoke('app:info'),
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (s) => ipcRenderer.invoke('state:save', s),
  send: (args) => ipcRenderer.invoke('engine:send', args),
  interrupt: (key) => ipcRenderer.invoke('engine:interrupt', key),
  respond: (id, value) => ipcRenderer.invoke('decision:respond', id, value),
  health: () => ipcRenderer.invoke('health'),
  tape: {
    days: (asset) => ipcRenderer.invoke('tape:days', asset),
    windows: (day, asset) => ipcRenderer.invoke('tape:windows', day, asset),
    window: (ticker, day, strategy) => ipcRenderer.invoke('tape:window', ticker, day, strategy),
    summary: (d0, d1, asset) => ipcRenderer.invoke('tape:summary', d0, d1, asset),
    ledger: () => ipcRenderer.invoke('tape:ledger'),
  },
  onEvent: (cb) => {
    const h = (_e, key, ev) => cb(key, ev)
    ipcRenderer.on('engine:event', h)
    return () => ipcRenderer.removeListener('engine:event', h)
  },
})
