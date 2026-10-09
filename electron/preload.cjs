// Preload (CommonJS, sandboxed): the only surface the renderer gets.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('mb', {
  info: () => ipcRenderer.invoke('app:info'),
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (s) => ipcRenderer.invoke('state:save', s),
  send: (args) => ipcRenderer.invoke('engine:send', args),
  interrupt: (key) => ipcRenderer.invoke('engine:interrupt', key),
  respond: (id, value) => ipcRenderer.invoke('decision:respond', id, value),
  health: () => ipcRenderer.invoke('health'),
  files: {
    pick: (defaultPath) => ipcRenderer.invoke('dialog:openFiles', defaultPath),
    // Dropped files: the sandboxed renderer has no File.path; webUtils resolves it here.
    describeDropped: (files) => ipcRenderer.invoke('attach:describe', Array.from(files, (f) => webUtils.getPathForFile(f)).filter(Boolean)),
    pickFolder: (defaultPath) => ipcRenderer.invoke('dialog:pickFolder', defaultPath),
    openFolder: (path) => ipcRenderer.invoke('shell:openFolder', path),
    openTerminal: (path) => ipcRenderer.invoke('shell:openTerminal', path),
    exportMarkdown: (name, md, cwd) => ipcRenderer.invoke('export:markdown', name, md, cwd),
    copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  },
  dictation: () => ipcRenderer.invoke('dictation:start'),
  tape: {
    days: (asset) => ipcRenderer.invoke('tape:days', asset),
    windows: (day, asset) => ipcRenderer.invoke('tape:windows', day, asset),
    window: (ticker, day, strategy, asset) => ipcRenderer.invoke('tape:window', ticker, day, strategy, asset),
    summary: (d0, d1, asset) => ipcRenderer.invoke('tape:summary', d0, d1, asset),
    entries: (ticker, day, asset, row) => ipcRenderer.invoke('tape:entries', ticker, day, asset, row),
    ledger: () => ipcRenderer.invoke('tape:ledger'),
  },
  onEvent: (cb) => {
    const h = (_e, key, ev) => cb(key, ev)
    ipcRenderer.on('engine:event', h)
    return () => ipcRenderer.removeListener('engine:event', h)
  },
})
