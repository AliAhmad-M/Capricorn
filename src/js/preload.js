const { contextBridge, ipcRenderer } = require('electron');

// Main control methods
contextBridge.exposeInMainWorld('capri', {
  warmup: () => ipcRenderer.invoke('capri:warmup'),
  ask: (query, options) => ipcRenderer.invoke('capri:ask', query, options),
  transcribe: (audio) => ipcRenderer.invoke('capri:transcribe', audio),
  speak: (text) => ipcRenderer.invoke('capri:speak', text),
  stopSpeech: () => ipcRenderer.send('capri:stop-speech'),
  onTextDelta: (callback) =>
    ipcRenderer.on('capri:text-delta', (_event, payload) => callback(payload)),
  onAudioStart: (callback) =>
    ipcRenderer.on('capri:audio-start', (_event, payload) => callback(payload)),
  onAudioChunk: (callback) =>
    ipcRenderer.on('capri:audio-chunk', (_event, payload) => callback(payload)),
  onAudioEnd: (callback) =>
    ipcRenderer.on('capri:audio-end', (_event, payload) => callback(payload)),
  onAudioError: (callback) =>
    ipcRenderer.on('capri:audio-error', (_event, payload) => callback(payload)),
});

// Window control methods
contextBridge.exposeInMainWorld('capriWindow', {
  showFull: () => ipcRenderer.send('win:full'),
  showPortrait: () => ipcRenderer.send('win:portrait'),
  closeSettings: () => ipcRenderer.send('win:settings-close'),
  toggleChat: () => ipcRenderer.send('win:chat-toggle'),
  closeChat: () => ipcRenderer.send('win:chat-close'),
  dragStart: () => ipcRenderer.send('win:drag-start'),
  dragMove: () => ipcRenderer.send('win:drag-move'),
  dragEnd: () => ipcRenderer.send('win:drag-end'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('win:ignore-mouse', ignore),
  showMenu: () => ipcRenderer.send('win:menu'),
  sendState: (state) => ipcRenderer.send('win:state', state),
  onState: (callback) =>
    ipcRenderer.on('capri:state', (_event, state) => callback(state)),
  onSync: (callback) =>
    ipcRenderer.on('capri:sync', (_event, transcript) => callback(transcript)),
  onToolUsage: (callback) =>
    ipcRenderer.on('capri:tool-usage', (_event, toolUsage) => callback(toolUsage)),
  onFocus: (callback) =>
    ipcRenderer.on('capri:focus', () => callback()),
  onSettingsOpen: (callback) =>
    ipcRenderer.on('capri:settings-open', () => callback()),
  onSettingsClose: (callback) =>
    ipcRenderer.on('capri:settings-close', () => callback()),
  onSpeechEnabled: (callback) =>
    ipcRenderer.on('capri:speech-enabled', (_event, enabled) => callback(enabled)),
});

// Settings API
contextBridge.exposeInMainWorld('capriSettings', {
  get: () => ipcRenderer.invoke('settings:get'),
  setGroqApiKey: (apiKey) =>
    ipcRenderer.invoke('settings:set-groq-api-key', apiKey),
  setBraveApiKey: (apiKey) =>
    ipcRenderer.invoke('settings:set-brave-api-key', apiKey),
  setGroqTextModels: (models) =>
    ipcRenderer.invoke('settings:set-groq-text-models', models),
  setGroqVoiceModels: (models) =>
    ipcRenderer.invoke('settings:set-groq-voice-models', models),
  setFishApiKey: (apiKey) =>
  ipcRenderer.invoke('settings:set-fish-api-key', apiKey),
  setFishVoiceId: (voiceId) =>
    ipcRenderer.invoke('settings:set-fish-voice-id', voiceId),
  setFishTtsModels: (models) =>
    ipcRenderer.invoke('settings:set-fish-tts-models', models),
  setUserName: (userName) =>
    ipcRenderer.invoke('settings:set-user-name', userName),
  setRequireStart: (requireStart) =>
    ipcRenderer.invoke('settings:set-require-start', requireStart),
  setStartInMini: (startInMini) =>
    ipcRenderer.invoke('settings:set-start-in-mini', startInMini),
  selectStartDirectory: () =>
    ipcRenderer.invoke('capri-settings:select-start-directory'),
  setStartDirectory: (directory) =>
    ipcRenderer.invoke('capri-settings:set-start-directory', directory),
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
  setSpeechEnabled: (enabled) =>
    ipcRenderer.invoke('settings:set-speech-enabled', enabled),
});