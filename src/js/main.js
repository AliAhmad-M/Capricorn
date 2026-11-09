require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  screen,
  Menu,
  globalShortcut,
  session,
} = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const brain = require('./brain');

app.setAppUserModelId('com.ali.capricorn');

// Window sizing and app-level tuning
const PORTRAIT_SIZE = { width: 200, height: 200 };
const BUBBLE_ROOM = 110;
const PORTRAIT_WINDOW = {
  width: PORTRAIT_SIZE.width,
  height: PORTRAIT_SIZE.height + BUBBLE_ROOM,
};
const CHAT_SIZE = { width: 400, height: 500 };
const CHAT_GAP = 12;
const TOGGLE_KEY = 'CommandOrControl+Alt+C';
const WARMUP_TIMEOUT_MS = 120000;

const page = path.join(__dirname, '../html/index.html');
const appIcon = path.join(__dirname, '../../app-icon.ico');
const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  backgroundThrottling: false,
};

let fullWin = null;
let portraitWin = null;
let chatWin = null;
let settingsOpenedFromPortrait = false;

// Conversation data
let history = [];
let transcript = [];

// Global app settings
let appSettings = {
  timeZone: 'Asia/Karachi',
  gamePaths: [],
  softwarePaths: [],
  gameExecutableNicknames: {},
  softwareExecutableNicknames: {},
  userName: '',
  startDirectory: '',
  requireStart: false,
  startInMini: false,
  groqApiKey: '',
  braveApiKey: '',
  fishApiKey: '',
  fishVoiceId: '',
  fishTtsModels: [],
  groqTextModels: [],
  groqVoiceModels: [],
  speechEnabled: true,
};

// Normalize saved model lists
function normalizeModelList(models) {
  const entries = Array.isArray(models)
    ? models
    : typeof models === 'string'
      ? models.split(/[\r\n,]+/)
      : [];

  return [...new Set(
    entries
      .filter((model) => typeof model === 'string')
      .map((model) => model.trim())
      .filter(Boolean)
  )].slice(0, 3);
}

// Normalize Groq text and voice models
function normalizeGroqSettings(settings) {
  return {
    groqApiKey: typeof settings.groqApiKey === 'string'
      ? settings.groqApiKey.trim()
      : '',

    groqTextModels: normalizeModelList(
      settings.groqTextModels ??
      settings.groqTextModel ??
      settings.groqModel
    ),

    groqVoiceModels: normalizeModelList(
      settings.groqVoiceModels ??
      settings.groqVoiceModel
    ),
  };
}

// Normalize the username
function normalizeUserName(userName) {
  return typeof userName === 'string' ? userName.trim().slice(0, 60) : '';
}

// Normalize nicknames for executable apps
function normalizeExecutableNicknames(nicknames) {
  if (!nicknames || typeof nicknames !== 'object' || Array.isArray(nicknames)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(nicknames).filter(
      ([executablePath, nickname]) =>
        typeof executablePath === 'string' &&
        typeof nickname === 'string' &&
        nickname.trim()
    ).map(([executablePath, nickname]) => [
      executablePath,
      nickname.trim().slice(0, 60)
    ])
  );
}

// Check for valid timezone
function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

// Return path to settings.json
function settingsFile() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'settings.json')
    : path.join(__dirname, '../../settings.json');
}

// Legacy settings.json path
function legacySettingsFile() {
  return app.isPackaged
    ? path.join(__dirname, '../../settings.json')
    : path.join(app.getPath('userData'), 'settings.json');
}

// Write data to the settings file
async function writeSettings(settings) {
  const file = settingsFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporaryFile = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(settings, null, 2)}\n`);
  await fs.rename(temporaryFile, file);
}

// Read the settings json if it exists
async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Load settings and migrate older values
async function loadSettings() {
  let saved = await readJsonIfExists(settingsFile());
  let migrated = false;

  if (!saved) {
    saved = await readJsonIfExists(legacySettingsFile());
    migrated = Boolean(saved);
  }
  
  // First run
  if (!saved) return;

  if (!isValidTimeZone(saved.timeZone)) {
    throw new Error('Saved settings contain an invalid time zone.');
  }

  // Load all settings
  appSettings = {
    ...appSettings,
    ...saved,
    
    gamePaths: Array.isArray(saved.gamePaths)
      ? saved.gamePaths.filter((folder) => typeof folder === 'string')
      : [],
    
    softwarePaths: Array.isArray(saved.softwarePaths)
      ? saved.softwarePaths.filter((folder) => typeof folder === 'string')
      : [],
    
    gameExecutableNicknames: normalizeExecutableNicknames(
      saved.gameExecutableNicknames
    ),
    
    softwareExecutableNicknames: normalizeExecutableNicknames(
      saved.softwareExecutableNicknames
    ),
    
    userName: normalizeUserName(saved.userName),
    
    startDirectory: typeof saved.startDirectory === 'string'
      ? saved.startDirectory.trim()
      : '',
    
    requireStart: saved.requireStart === true,
    startInMini: saved.startInMini === true,
    
    speechEnabled: saved.speechEnabled !== false,
    
    braveApiKey: typeof saved.braveApiKey === 'string'
      ? saved.braveApiKey.trim()
      : '',
    
    fishApiKey: typeof saved.fishApiKey === 'string'
      ? saved.fishApiKey.trim()
      : '',

    fishVoiceId: typeof saved.fishVoiceId === 'string'
      ? saved.fishVoiceId.trim()
      : '',

    fishTtsModels: normalizeModelList(saved.fishTtsModels),

    ...normalizeGroqSettings(saved),
  };
  delete appSettings.groqModel;
  delete appSettings.groqTextModel;
  delete appSettings.groqVoiceModel;

  if (migrated) await writeSettings(appSettings);
}

// Application full window 
function createFullWindow() {
  fullWin = new BrowserWindow({
    width: 1040,
    height: 700,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'Capricorn',
    icon: appIcon,
    webPreferences,
  });
  fullWin.loadFile(page, { query: { view: 'full' } });
  fullWin.on('closed', () => app.quit());
}

// Common overlay window for both portrait and chat
function createOverlay(view, size, position = {}) {
  const win = new BrowserWindow({
    ...size,
    ...position,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'Capricorn',
    icon: appIcon,
    webPreferences,
  });
  win.loadFile(page, { query: { view } });
  return win;
}

// Send to every window except the one that triggered it
function broadcast(channel, payload, except) {
  for (const win of [fullWin, portraitWin, chatWin]) {
    if (win && !win.isDestroyed() && win.webContents !== except) {
      win.webContents.send(channel, payload);
    }
  }
}

// Place chat in portrait mode
function placeChat(portrait) {
  const area = screen.getDisplayMatching(portrait).workArea;
  const { width: cw, height: ch } = CHAT_SIZE;

  const space = {
    right: area.x + area.width - (portrait.x + portrait.width),
    left: portrait.x - area.x,
    below: area.y + area.height - (portrait.y + portrait.height),
    above: portrait.y - area.y,
  };

  const need = {
    right: cw + CHAT_GAP,
    left: cw + CHAT_GAP,
    below: ch + CHAT_GAP,
    above: ch + CHAT_GAP,
  };
  
  const order = ['right', 'left', 'below', 'above'];
  const side =
    order.find((s) => space[s] >= need[s]) ??
    order.reduce((best, s) => (space[s] / need[s] > space[best] / need[best] ? s : best));

  const centerX = portrait.x + portrait.width / 2 - cw / 2;

  const roomDown = area.y + area.height - portrait.y;
  const roomUp = portrait.y + portrait.height - area.y;
  const sideY =
    roomDown >= ch ? portrait.y
    : roomUp >= ch ? portrait.y + portrait.height - ch
    : roomDown >= roomUp ? portrait.y
    : portrait.y + portrait.height - ch;

  let x, y;
  if (side === 'right') { x = portrait.x + portrait.width + CHAT_GAP; y = sideY; }
  else if (side === 'left') { x = portrait.x - CHAT_GAP - cw; y = sideY; }
  else if (side === 'below') { x = centerX; y = portrait.y + portrait.height + CHAT_GAP; }
  else { x = centerX; y = portrait.y - CHAT_GAP - ch; }

  const clamp = (v, min, max) => Math.max(min, Math.min(v, max));
  return {
    x: Math.round(clamp(x, area.x, area.x + area.width - cw)),
    y: Math.round(clamp(y, area.y, area.y + area.height - ch)),
  };
}

// Return position and size of portrait rect
function portraitRect() {
  const b = portraitWin.getBounds();
  return { x: b.x, y: b.y + BUBBLE_ROOM, width: b.width, height: b.height - BUBBLE_ROOM };
}

// Open chat in mini view
function openChat() {
  if (!portraitWin.isVisible()) return;
  const { x, y } = placeChat(portraitRect());
  chatWin.setBounds({ x, y, ...CHAT_SIZE });
  chatWin.show();
  chatWin.focus();
  chatWin.webContents.send('capri:focus');
}

// Close chat in mini view
function closeChat() {
  chatWin.hide();
}

// Change to full view
function showFull() {
  closeChat();
  portraitWin.hide();
  if (fullWin.isMinimized()) fullWin.restore();
  fullWin.show();
  fullWin.focus();
}

// Change to mini view
function showPortrait() {
  closeChat();
  fullWin.hide();
  portraitWin.show();
}

// Toggle between views
function toggleView() {
  if (fullWin.isVisible() && !fullWin.isMinimized()) showPortrait();
  else showFull();
}

// Open settings in mini view
function openSettingsFromPortrait() {
  settingsOpenedFromPortrait = true;
  closeChat();
  if (fullWin.isMinimized()) fullWin.restore();
  fullWin.show();
  fullWin.focus();
  fullWin.webContents.send('capri:settings-open');
}

// Close the settings page
function closeSettings() {
  fullWin.webContents.send('capri:settings-close');
  if (settingsOpenedFromPortrait) showPortrait();
  settingsOpenedFromPortrait = false;
}

// Load the model and system prompt on startup
let warmupPromise = null;
function warmUp() {
  if (!warmupPromise) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        console.error('warmup timed out');
        resolve(false);
      }, WARMUP_TIMEOUT_MS);
      timer.unref();
    });

    const run = Promise.resolve()
      .then(() => brain.warmup({ ...appSettings }))
      .then(() => true)
      .catch((error) => {
        console.error('warmup failed:', error.message);
        return false;
      })
      .finally(() => clearTimeout(timer));

    warmupPromise = Promise.race([run, timeout]);
  }
  return warmupPromise;
}

// Run the model brain
async function runBrain(text, settings, onToolUsage, onText) {
  const result = await brain.ask(text, [...history], settings, onToolUsage, onText);
  if (Array.isArray(result.messages)) history = result.messages;
  return result;
}

// Send query to brain
async function askBrain(text, settings, onToolUsage, onText) {
  try {
    return await runBrain(text, settings, onToolUsage, onText);
  } catch (error) {
    if (!/No user query/i.test(error.message)) throw error;
    history = [];
    return await runBrain(text, settings, onToolUsage, onText);
  }
}

// Warm up the model once
ipcMain.handle('capri:warmup', () => warmUp());

// Get the model settings
ipcMain.handle('settings:get', () => {
  const {
    groqApiKey,
    braveApiKey,
    fishApiKey,
    ...settings
  } = appSettings;

  return {
    ...settings,
    defaultStartDirectory: app.getPath('home'),
    ...brain.getConfiguration(appSettings),
    braveApiKey,
    fishApiKey,
  };
});

// Get the speech enabled flag
ipcMain.handle('settings:set-speech-enabled', async (_event, enabled) => {
  if (typeof enabled !== 'boolean') {
    throw new Error('Speech must be turned on or off.');
  }

  const updatedSettings = { ...appSettings, speechEnabled: enabled };
  await writeSettings(updatedSettings);
  appSettings = updatedSettings;

  if (!enabled) stopSpeech();
  broadcast('capri:speech-enabled', enabled);

  return { speechEnabled: enabled };
});

// Update a Groq related setting
async function saveGroqSetting(setting, value) {
  const updatedSettings = { ...appSettings, [setting]: value };
  await writeSettings(updatedSettings);
  appSettings = updatedSettings;
  warmupPromise = null;
  return {
    ...brain.getConfiguration(appSettings),
  };
}

// Verify the provided Groq models
function validateGroqModelList(models, label) {
  if (!Array.isArray(models) || models.length > 3) {
    throw new Error(`Enter up to 3 ${label} models.`);
  }

  if (models.some(
    (model) => typeof model !== 'string' || model.length > 200
  )) {
    throw new Error(`${label} model IDs must be 200 characters or fewer.`);
  }

  return normalizeModelList(models);
}

// Set the Groq API key
ipcMain.handle('settings:set-groq-api-key', async (_event, apiKey) => {
  if (typeof apiKey !== 'string' || apiKey.length > 512) {
    throw new Error('Groq API key must be 512 characters or fewer.');
  }

  return saveGroqSetting('groqApiKey', apiKey.trim());
});

// Set the Brave API key
ipcMain.handle('settings:set-brave-api-key', async (_event, apiKey) => {
  if (typeof apiKey !== 'string' || apiKey.length > 512) {
    throw new Error('Brave API key must be 512 characters or fewer.');
  }

  const updatedSettings = { ...appSettings, braveApiKey: apiKey.trim() };
  await writeSettings(updatedSettings);
  appSettings = updatedSettings;
  return { hasBraveApiKey: Boolean(appSettings.braveApiKey) };
});

// Set Groq text models
ipcMain.handle('settings:set-groq-text-models', async (_event, models) => {
  return saveGroqSetting(
    'groqTextModels',
    validateGroqModelList(models, 'text')
  );
});

// Set Groq voice models
ipcMain.handle('settings:set-groq-voice-models', async (_event, models) => {
  return saveGroqSetting(
    'groqVoiceModels',
    validateGroqModelList(models, 'voice')
  );
});

// Set the Fish API key
ipcMain.handle('settings:set-fish-api-key', async (_event, apiKey) => {
  if (typeof apiKey !== 'string' || apiKey.length > 512) {
    throw new Error('Fish Audio API key must be 512 characters or fewer.');
  }

  const updatedSettings = {
    ...appSettings,
    fishApiKey: apiKey.trim(),
  };

  await writeSettings(updatedSettings);
  appSettings = updatedSettings;

  return {
    hasFishApiKey: Boolean(appSettings.fishApiKey),
  };
});

// Set Fish TTS models
ipcMain.handle('settings:set-fish-tts-models', async (_event, models) => {
  const updatedSettings = {
    ...appSettings,
    fishTtsModels: validateGroqModelList(models, 'TTS'),
  };

  await writeSettings(updatedSettings);
  appSettings = updatedSettings;

  return { fishTtsModels: brain.getConfiguration(appSettings).fishTtsModels };
});

// Set the Fish voice id
ipcMain.handle('settings:set-fish-voice-id', async (_event, voiceId) => {
  if (typeof voiceId !== 'string' || voiceId.length > 256) {
    throw new Error('Fish Audio voice ID must be 256 characters or fewer.');
  }

  const updatedSettings = {
    ...appSettings,
    fishVoiceId: voiceId.trim(),
  };

  await writeSettings(updatedSettings);
  appSettings = updatedSettings;

  return {
    fishVoiceId: appSettings.fishVoiceId,
  };
});

// Set the current timezone
ipcMain.handle('settings:set-time-zone', async (_event, timeZone) => {
  if (!isValidTimeZone(timeZone)) {
    throw new Error('Choose a valid IANA time zone.');
  }

  const updatedSettings = { ...appSettings, timeZone };
  await writeSettings(updatedSettings);
  appSettings = updatedSettings;
  return { ...appSettings };
});
ipcMain.handle('settings:set-user-name', async (_event, userName) => {
  if (typeof userName !== 'string' || userName.length > 60) {
    throw new Error('Name must be 60 characters or fewer.');
  }

  const updatedSettings = {
    ...appSettings,
    userName: normalizeUserName(userName),
  };
  await writeSettings(updatedSettings);
  appSettings = updatedSettings;
  return { ...appSettings };
});

// Set the "require input to start" flag
ipcMain.handle('settings:set-require-start', async (_event, requireStart) => {
  if (typeof requireStart !== 'boolean') {
    throw new Error('Require start must be enabled or disabled.');
  }

  const updatedSettings = { ...appSettings, requireStart };
  await writeSettings(updatedSettings);
  appSettings = updatedSettings;
  return { requireStart };
});

// Set the "start app in mini view" flag
ipcMain.handle('settings:set-start-in-mini', async (_event, startInMini) => {
  if (typeof startInMini !== 'boolean') {
    throw new Error('Start in mini view must be enabled or disabled.');
  }

  const updatedSettings = { ...appSettings, startInMini };
  await writeSettings(updatedSettings);
  appSettings = updatedSettings;
  return { startInMini };
});

// Set nickname for an executable file
ipcMain.handle(
  'settings:set-executable-nickname',
  async (_event, category, executablePath, nickname) => {
    const categorySettings = {
      game: {
        pathsKey: 'gamePaths',
        nicknamesKey: 'gameExecutableNicknames'
      },
      software: {
        pathsKey: 'softwarePaths',
        nicknamesKey: 'softwareExecutableNicknames'
      }
    }[category];

    if (!categorySettings) {
      throw new Error('Choose games or software for the executable nickname.');
    }
    if (
      typeof executablePath !== 'string' ||
      path.extname(executablePath).toLowerCase() !== '.exe'
    ) {
      throw new Error('Choose a configured executable.');
    }
    if (typeof nickname !== 'string' || nickname.length > 60) {
      throw new Error('Nickname must be 60 characters or fewer.');
    }

    const resolvedExecutable = await fs.realpath(executablePath);
    const executableStats = await fs.stat(resolvedExecutable);
    if (!executableStats.isFile()) {
      throw new Error('Choose a configured executable file.');
    }

    const isConfigured = appSettings[categorySettings.pathsKey].some(
      (configuredPath) => configuredPath.toLowerCase() === resolvedExecutable.toLowerCase()
    );
    if (!isConfigured) {
      throw new Error('That executable is no longer configured.');
    }

    const nicknames = {
      ...appSettings[categorySettings.nicknamesKey]
    };
    const trimmedNickname = nickname.trim();
    if (trimmedNickname) {
      nicknames[resolvedExecutable] = trimmedNickname;
    } else {
      delete nicknames[resolvedExecutable];
    }

    const updatedSettings = {
      ...appSettings,
      [categorySettings.nicknamesKey]: nicknames
    };
    await writeSettings(updatedSettings);
    appSettings = updatedSettings;
    return { ...appSettings };
  }
);

// Open native dialogs for selecting app folders and executables
ipcMain.handle('capri-settings:select-game-paths', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Game Library Folders',
    properties: ['openDirectory', 'multiSelections']
  });

  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle('capri-settings:select-software-paths', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Software Folders',
    properties: ['openDirectory', 'multiSelections']
  });

  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle('capri-settings:select-executables', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Executables',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Applications', extensions: ['exe'] }]
  });

  return result.canceled ? [] : result.filePaths;
});

// Save directory path to settings
async function saveDirectoryPaths(paths, settingKey, description) {
  if (!Array.isArray(paths)) {
    throw new Error(`Invalid ${description} folder paths.`);
  }

  const validPaths = [];

  for (const folder of paths) {
    if (typeof folder !== 'string' || !folder.trim()) continue;

    const resolved = await fs.realpath(path.resolve(folder.trim()));
    const stats = await fs.stat(resolved);

    if (
      !stats.isDirectory() &&
      !(stats.isFile() && path.extname(resolved).toLowerCase() === '.exe')
    ) {
      throw new Error(`Not a ${description} folder or executable: ${resolved}`);
    }

    validPaths.push(resolved);
  }

  // Remove duplicates
  const uniquePaths = [
    ...new Map(
      validPaths.map(folder => [folder.toLowerCase(), folder])
    ).values()
  ];

  const updatedSettings = { ...appSettings, [settingKey]: uniquePaths };
  const nicknamesKey = settingKey === 'gamePaths'
    ? 'gameExecutableNicknames'
    : 'softwareExecutableNicknames';
  const configuredExecutablePaths = new Set(
    uniquePaths.map((configuredPath) => configuredPath.toLowerCase())
  );
  updatedSettings[nicknamesKey] = Object.fromEntries(
    Object.entries(appSettings[nicknamesKey]).filter(([executablePath]) =>
      configuredExecutablePaths.has(executablePath.toLowerCase())
    )
  );
  await writeSettings(updatedSettings);
  appSettings = updatedSettings;
  return [...appSettings[settingKey]];
}

// Set paths for applications
ipcMain.handle('capri-settings:set-game-paths', (_event, paths) =>
  saveDirectoryPaths(paths, 'gamePaths', 'game')
);
ipcMain.handle('capri-settings:set-software-paths', (_event, paths) =>
  saveDirectoryPaths(paths, 'softwarePaths', 'software')
);

// Set the starting directory
ipcMain.handle('capri-settings:select-start-directory', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Start Folder',
    defaultPath: appSettings.startDirectory || app.getPath('home'),
    properties: ['openDirectory']
  });

  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle('capri-settings:set-start-directory', async (_event, directory) => {
  if (typeof directory !== 'string' || directory.length > 1024) {
    throw new Error('Invalid start folder.');
  }

  // An empty string resets to the default
  let resolved = '';
  if (directory.trim()) {
    resolved = await fs.realpath(path.resolve(directory.trim()));
    if (!(await fs.stat(resolved)).isDirectory()) {
      throw new Error('Not a folder: ' + resolved);
    }
  }

  const updatedSettings = { ...appSettings, startDirectory: resolved };
  await writeSettings(updatedSettings);
  appSettings = updatedSettings;
  return { startDirectory: resolved };
});

// Text to speech
ipcMain.handle('capri:speak', async (_event, text) => {
  try {
    const audio = await brain.textToSpeech(text, { ...appSettings });

    return Uint8Array.from(audio);
  } catch (error) {
    console.error('Fish Audio TTS failed:', error);
    throw error;
  }
});

// Transcription
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
ipcMain.handle('capri:transcribe', async (_event, audio) => {
  try {
    if (!audio || typeof audio !== 'object') {
      throw new Error('Invalid audio recording.');
    }

    const { audio: data, mimeType } = audio;
    if (
      !(data instanceof ArrayBuffer) &&
      !ArrayBuffer.isView(data)
    ) {
      throw new Error('Invalid audio recording data.');
    }
    if (typeof mimeType !== 'string') {
      throw new Error('Invalid audio recording format.');
    }

    const buffer = Buffer.from(data);
    if (buffer.length === 0) return { text: '' };
    if (buffer.length > MAX_AUDIO_BYTES) throw new Error('Recording is too large.');
    return {
      text: await brain.transcribe(buffer, { ...appSettings }, mimeType),
    };
  } catch (error) {
    console.error('Voice transcription failed:', error);
    return { text: '', error: brain.getFriendlyErrorMessage(error) };
  }
});


let turnCounter = 0;
let activeSpeech = null;
function sendTo(webContents, channel, payload) {
  if (webContents && !webContents.isDestroyed()) webContents.send(channel, payload);
}

// Cancel text to speech
function stopSpeech() {
  activeSpeech?.cancel();
  activeSpeech = null;
}
ipcMain.on('capri:stop-speech', stopSpeech);

// Query
ipcMain.handle('capri:ask', async (event, query, options) => {
  // Wait for warmup
  await warmUp();

  const sender = event.sender;
  const turnId = ++turnCounter;
  const speak = options?.speak === true && appSettings.speechEnabled;

  transcript.push({ who: 'you', text: String(query) });
  broadcast('capri:sync', transcript, sender);

  // New question cuts off the previous answer
  stopSpeech();

  let speech = null;
  let speechTried = false;

  const startSpeech = () => {
    if (speechTried || !speak || !appSettings.speechEnabled) return;
    speechTried = true;

    try {
      const session = brain.textToSpeechStream({ ...appSettings }, {
        onAudio: (chunk) => sendTo(sender, 'capri:audio-chunk', { turnId, chunk }),
        onError: (error) => {
          console.error('Fish Audio stream failed:', error.message);
          sendTo(sender, 'capri:audio-error', {
            turnId,
            error: brain.getFriendlyErrorMessage(error),
          });
        },
      });

      speech = session;
      activeSpeech = session;
      sendTo(sender, 'capri:audio-start', { turnId, sampleRate: brain.TTS_SAMPLE_RATE });

      session.done.then(() => {
        if (activeSpeech === session) activeSpeech = null;
        sendTo(sender, 'capri:audio-end', { turnId });
      });
    } catch (error) {
      console.error('Could not start speech:', error.message);
      sendTo(sender, 'capri:audio-error', {
        turnId,
        error: brain.getFriendlyErrorMessage(error),
      });
    }
  };

  let streamed = '';
  const onText = (delta) => {
    streamed += delta;
    broadcast('capri:text-delta', { turnId, text: streamed });
    startSpeech();
    speech?.push(delta);
  };

  let reply;
  try {
    const onToolUsage = (toolUsage) =>
      broadcast('capri:tool-usage', toolUsage);
    reply = (
      await askBrain(String(query), { ...appSettings }, onToolUsage, onText)
    ).text ?? '';
  } catch (error) {
    console.error('Assistant request failed:', error);
    reply = brain.getFriendlyErrorMessage(error);
  }

  speech?.end();

  transcript.push({ who: 'capri', text: reply });
  broadcast('capri:sync', transcript, sender);
  return { text: reply, turnId };
});

// Window management
ipcMain.on('win:state', (event, state) => broadcast('capri:state', state, event.sender));
ipcMain.on('win:full', showFull);
ipcMain.on('win:portrait', showPortrait);
ipcMain.on('win:settings-close', closeSettings);
ipcMain.on('win:chat-toggle', () => (chatWin.isVisible() ? closeChat() : openChat()));
ipcMain.on('win:chat-close', closeChat);

// Dragging
let dragOrigin = null;
ipcMain.on('win:drag-start', () => {
  dragOrigin = {
    cursor: screen.getCursorScreenPoint(),
    portrait: portraitWin.getBounds(),
    chat: chatWin.isVisible() ? chatWin.getBounds() : null,
    moved: false,
  };
});
ipcMain.on('win:drag-move', () => {
  if (!dragOrigin) return;
  dragOrigin.moved = true;
  const cursor = screen.getCursorScreenPoint();
  const dx = cursor.x - dragOrigin.cursor.x;
  const dy = cursor.y - dragOrigin.cursor.y;

  // Passing width/height every time stops DPI scaling from growing the windows
  const p = dragOrigin.portrait;
  portraitWin.setBounds({ x: p.x + dx, y: p.y + dy, width: p.width, height: p.height });

  // Make chat follow on drag
  const c = dragOrigin.chat;
  if (c) chatWin.setBounds({ x: c.x + dx, y: c.y + dy, width: c.width, height: c.height });
});
ipcMain.on('win:drag-end', () => {
  const moved = dragOrigin?.moved;
  dragOrigin = null;
  // Adjust chat position if portrait moved and chat is open
  if (moved && chatWin.isVisible()) {
    const { x, y } = placeChat(portraitRect());
    chatWin.setBounds({ x, y, ...CHAT_SIZE });
  }
});

// Menu
ipcMain.on('win:menu', () => {
  Menu.buildFromTemplate([
    { label: 'Open full view', click: showFull },
    { type: 'separator' },
    { label: 'Open settings', click: openSettingsFromPortrait },
    { type: 'separator' },
    { label: 'Quit Capricorn', click: () => app.quit() },
  ]).popup({ window: portraitWin });
});

// Mouse
ipcMain.on('win:ignore-mouse', (_event, ignore) => {
  portraitWin?.setIgnoreMouseEvents(ignore === true, { forward: true });
});

// Startup
app.whenReady().then(async () => {
  const appPageUrl = pathToFileURL(page).href;
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const isAppPage = webContents.getURL().split('?')[0] === appPageUrl;
      const requestsAudio =
        permission === 'media' &&
        details.mediaTypes?.includes('audio') &&
        !details.mediaTypes.includes('video');
      callback(isAppPage && requestsAudio);
    }
  );

  try {
    await loadSettings();
  } catch (error) {
    console.error('Failed to load settings:', error.message);
  }

  const { workArea } = screen.getPrimaryDisplay();
    portraitWin = createOverlay('portrait', PORTRAIT_WINDOW, {
    x: workArea.x + workArea.width - PORTRAIT_SIZE.width - 40,
    y: workArea.y + workArea.height - PORTRAIT_SIZE.height - BUBBLE_ROOM - 40,
  });

  chatWin = createOverlay('chat', CHAT_SIZE);
  createFullWindow();
  globalShortcut.register(TOGGLE_KEY, toggleView);
});

// Closing
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());