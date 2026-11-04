const { contextBridge, ipcRenderer } = require('electron');

// Expose request to the electron API
contextBridge.exposeInMainWorld('capri', {
  ask: (query) => ipcRenderer.invoke('capri:ask', query),
});