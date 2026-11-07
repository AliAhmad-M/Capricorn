const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('capri', {
  ask: (query, conversation) => ipcRenderer.invoke('capri:ask', query, conversation)
});

contextBridge.exposeInMainWorld('capriWindow', {
  showFull: () => ipcRenderer.send('win:full'),
  showPortrait: () => ipcRenderer.send('win:portrait'),
  closeSettings: () => ipcRenderer.send('win:settings-close'),
  toggleChat: () => ipcRenderer.send('win:chat-toggle'),
  closeChat: () => ipcRenderer.send('win:chat-close'),
  dragStart: () => ipcRenderer.send('win:drag-start'),
  dragMove: () => ipcRenderer.send('win:drag-move'),
  dragEnd: () => ipcRenderer.send('win:drag-end'),
  showMenu: () => ipcRenderer.send('win:menu'),
  sendState: (state) => ipcRenderer.send('win:state', state),
  onState: (callback) =>
    ipcRenderer.on('capri:state', (_event, state) => callback(state)),
  onSync: (callback) =>
    ipcRenderer.on('capri:sync', (_event, transcript) => callback(transcript)),
  onFocus: (callback) =>
    ipcRenderer.on('capri:focus', () => callback()),
  onSettingsOpen: (callback) =>
    ipcRenderer.on('capri:settings-open', () => callback()),
  onSettingsClose: (callback) =>
    ipcRenderer.on('capri:settings-close', () => callback()),
});

contextBridge.exposeInMainWorld('capriSettings', {
  get: () => ipcRenderer.invoke('settings:get'),
  setGroqApiKey: (apiKey) =>
    ipcRenderer.invoke('settings:set-groq-api-key', apiKey),
  setGroqModel: (model) =>
    ipcRenderer.invoke('settings:set-groq-model', model),
  setTimeZone: (timeZone) => ipcRenderer.invoke('settings:set-time-zone', timeZone),
  setUserName: (userName) =>
    ipcRenderer.invoke('settings:set-user-name', userName),
  setExecutableNickname: (category, executablePath, nickname) =>
    ipcRenderer.invoke(
      'settings:set-executable-nickname',
      category,
      executablePath,
      nickname
    ),
  selectGamePaths: () => ipcRenderer.invoke('capri-settings:select-game-paths'),
  setGamePaths: (paths) =>
    ipcRenderer.invoke('capri-settings:set-game-paths', paths),
  selectSoftwarePaths: () =>
    ipcRenderer.invoke('capri-settings:select-software-paths'),
  selectExecutables: () =>
    ipcRenderer.invoke('capri-settings:select-executables'),
  setSoftwarePaths: (paths) =>
    ipcRenderer.invoke('capri-settings:set-software-paths', paths),
});