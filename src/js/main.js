require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { app, BrowserWindow, ipcMain, dialog, screen, Menu, globalShortcut } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const brain = require('./brain');

const PORTRAIT_SIZE = { width: 220, height: 220 };
const CHAT_SIZE = { width: 400, height: 500 };
const CHAT_GAP = 12;
const TOGGLE_KEY = 'CommandOrControl+Alt+C';
const WARMUP_TIMEOUT_MS = 120000;

const page = path.join(__dirname, '../html/index.html');
const appIcon = path.join(__dirname, '../../assets/idle_blink.jpg');
const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  // Hidden windows keep their timers, so a reply keeps typing out after a view switch
  backgroundThrottling: false,
};

let fullWin = null;
let portraitWin = null;
let chatWin = null;
let settingsOpenedFromPortrait = false;

// Conversation lives here so every window shares it
let history = [];
let transcript = [];
let appSettings = {
  timeZone: 'Asia/Karachi',
  gamePaths: [],
  softwarePaths: [],
  gameExecutableNicknames: {},
  softwareExecutableNicknames: {},
  userName: '',
  groqApiKey: '',
  groqModel: '',
};

function normalizeGroqSettings(settings) {
  return {
    groqApiKey: typeof settings.groqApiKey === 'string'
      ? settings.groqApiKey.trim()
      : '',
    groqModel: typeof settings.groqModel === 'string'
      ? settings.groqModel.trim()
      : '',
  };
}

function normalizeUserName(userName) {
  return typeof userName === 'string' ? userName.trim().slice(0, 60) : '';
}

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

function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function settingsFile() {
  return path.join(__dirname, '../../settings.json');
}

function legacySettingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function writeSettings(settings) {
  const file = settingsFile();
  const temporaryFile = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(settings, null, 2)}\n`);
  await fs.rename(temporaryFile, file);
}

async function loadSettings() {
  let contents;
  try {
    contents = await fs.readFile(settingsFile(), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;

    try {
      contents = await fs.readFile(legacySettingsFile(), 'utf8');
    } catch (legacyError) {
      if (legacyError.code === 'ENOENT') return;
      throw legacyError;
    }
    const savedSettings = JSON.parse(contents);
    if (!savedSettings || !isValidTimeZone(savedSettings.timeZone)) {
      throw new Error('Saved settings contain an invalid time zone.');
    }
    appSettings = {
      ...appSettings,
      ...savedSettings,
      gamePaths: Array.isArray(savedSettings.gamePaths)
        ? savedSettings.gamePaths.filter((folder) => typeof folder === 'string')
        : [],
      softwarePaths: Array.isArray(savedSettings.softwarePaths)
        ? savedSettings.softwarePaths.filter((folder) => typeof folder === 'string')
        : [],
      gameExecutableNicknames: normalizeExecutableNicknames(
        savedSettings.gameExecutableNicknames
      ),
      softwareExecutableNicknames: normalizeExecutableNicknames(
        savedSettings.softwareExecutableNicknames
      ),
      userName: normalizeUserName(savedSettings.userName),
      ...normalizeGroqSettings(savedSettings),
    };
    await writeSettings(appSettings);
    return;
  }

  const savedSettings = JSON.parse(contents);
  if (!savedSettings || !isValidTimeZone(savedSettings.timeZone)) {
    throw new Error('Saved settings contain an invalid time zone.');
  }
  appSettings = {
    ...appSettings,
    ...savedSettings,
    gamePaths: Array.isArray(savedSettings.gamePaths)
      ? savedSettings.gamePaths.filter((folder) => typeof folder === 'string')
      : [],
    softwarePaths: Array.isArray(savedSettings.softwarePaths)
      ? savedSettings.softwarePaths.filter((folder) => typeof folder === 'string')
      : [],
    gameExecutableNicknames: normalizeExecutableNicknames(
      savedSettings.gameExecutableNicknames
    ),
    softwareExecutableNicknames: normalizeExecutableNicknames(
      savedSettings.softwareExecutableNicknames
    ),
    userName: normalizeUserName(savedSettings.userName),
    ...normalizeGroqSettings(savedSettings),
  };
}

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

  // Hidden overlay windows would keep the process alive, so quit explicitly
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

function openChat() {
  if (!portraitWin.isVisible()) return;
  const { x, y } = placeChat(portraitWin.getBounds());
  chatWin.setBounds({ x, y, ...CHAT_SIZE });
  chatWin.show();
  chatWin.focus();
  chatWin.webContents.send('capri:focus');
}

function closeChat() {
  chatWin.hide();
}

function showFull() {
  closeChat();
  portraitWin.hide();
  if (fullWin.isMinimized()) fullWin.restore();
  fullWin.show();
  fullWin.focus();
}

function showPortrait() {
  closeChat();
  fullWin.hide();
  portraitWin.show();
}

function toggleView() {
  if (fullWin.isVisible() && !fullWin.isMinimized()) showPortrait();
  else showFull();
}

function openSettingsFromPortrait() {
  settingsOpenedFromPortrait = true;
  closeChat();
  if (fullWin.isMinimized()) fullWin.restore();
  fullWin.show();
  fullWin.focus();
  fullWin.webContents.send('capri:settings-open');
}

function closeSettings() {
  fullWin.webContents.send('capri:settings-close');
  if (settingsOpenedFromPortrait) showPortrait();
  settingsOpenedFromPortrait = false;
}

// Load the model and system prompt
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

// Assistant work stays in the main process
async function runBrain(text, settings) {
  // Pass a copy so a failed call can't leave a half-edited history behind
  const result = await brain.ask(text, [...history], settings);
  if (Array.isArray(result.messages)) history = result.messages;
  return result;
}

async function askBrain(text, settings) {
  try {
    return await runBrain(text, settings);
  } catch (error) {
    if (!/No user query/i.test(error.message)) throw error;
    history = [];
    return await runBrain(text, settings);
  }
}

ipcMain.handle('capri:warmup', () => warmUp());
ipcMain.handle('settings:get', () => {
  const { groqApiKey, ...settings } = appSettings;
  return {
    ...settings,
    ...brain.getConfiguration(appSettings),
    hasGroqApiKeyOverride: Boolean(groqApiKey),
  };
});

async function saveGroqSetting(setting, value) {
  const updatedSettings = { ...appSettings, [setting]: value };
  await writeSettings(updatedSettings);
  appSettings = updatedSettings;
  warmupPromise = null;
  return {
    ...brain.getConfiguration(appSettings),
    hasGroqApiKeyOverride: Boolean(appSettings.groqApiKey),
  };
}

ipcMain.handle('settings:set-groq-api-key', async (_event, apiKey) => {
  if (typeof apiKey !== 'string' || apiKey.length > 512) {
    throw new Error('Groq API key must be 512 characters or fewer.');
  }

  return saveGroqSetting('groqApiKey', apiKey.trim());
});

ipcMain.handle('settings:set-groq-model', async (_event, model) => {
  if (typeof model !== 'string' || model.length > 200) {
    throw new Error('Groq model must be 200 characters or fewer.');
  }

  return saveGroqSetting('groqModel', model.trim());
});

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

// Open native dialogs for selecting game libraries and software folders.
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

ipcMain.handle('capri-settings:set-game-paths', (_event, paths) =>
  saveDirectoryPaths(paths, 'gamePaths', 'game')
);

ipcMain.handle('capri-settings:set-software-paths', (_event, paths) =>
  saveDirectoryPaths(paths, 'softwarePaths', 'software')
);

ipcMain.handle('capri:ask', async (event, query) => {
  // Wait for warmup
  await warmUp();

  transcript.push({ who: 'you', text: String(query) });
  broadcast('capri:sync', transcript, event.sender);

  let reply;
  try {
    reply = (await askBrain(String(query), { ...appSettings })).text ?? '';
  } catch (error) {
    reply = `That request failed: ${error.message}. Try again.`;
  }

  transcript.push({ who: 'capri', text: reply });
  broadcast('capri:sync', transcript, event.sender);
  return { text: reply };
});

// Keep the sprite state the same in every window
ipcMain.on('win:state', (event, state) => broadcast('capri:state', state, event.sender));

ipcMain.on('win:full', showFull);
ipcMain.on('win:portrait', showPortrait);
ipcMain.on('win:settings-close', closeSettings);
ipcMain.on('win:chat-toggle', () => (chatWin.isVisible() ? closeChat() : openChat()));
ipcMain.on('win:chat-close', closeChat);

// Dragging: the renderer only says start / move / end, the cursor
// position is read here so it stays correct while the window moves
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
    const { x, y } = placeChat(portraitWin.getBounds());
    chatWin.setBounds({ x, y, ...CHAT_SIZE });
  }
});

ipcMain.on('win:menu', () => {
  Menu.buildFromTemplate([
    { label: 'Open full view', click: showFull },
    { type: 'separator' },
    { label: 'Open settings', click: openSettingsFromPortrait },
    { type: 'separator' },
    { label: 'Quit Capricorn', click: () => app.quit() },
  ]).popup({ window: portraitWin });
});

app.whenReady().then(async () => {
  try {
    await loadSettings();
  } catch (error) {
    console.error('Failed to load settings:', error.message);
  }

  // Start loading the model in parallel
  warmUp();

  const { workArea } = screen.getPrimaryDisplay();
  portraitWin = createOverlay('portrait', PORTRAIT_SIZE, {
    x: workArea.x + workArea.width - PORTRAIT_SIZE.width - 40,
    y: workArea.y + workArea.height - PORTRAIT_SIZE.height - 40,
  });
  chatWin = createOverlay('chat', CHAT_SIZE);
  createFullWindow();
  globalShortcut.register(TOGGLE_KEY, toggleView);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());