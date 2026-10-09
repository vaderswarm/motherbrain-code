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
  onEvent: (cb) => {
    const h = (_e, key, ev) => cb(key, ev)
    ipcRenderer.on('engine:event', h)
    return () => ipcRenderer.removeListener('engine:event', h)
  },
})
