const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('capri', {
  ask: (query, conversation) => ipcRenderer.invoke('capri:ask', query, conversation)
});