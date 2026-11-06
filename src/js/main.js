const { app, BrowserWindow, ipcMain, screen, Menu, globalShortcut } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const brain = require('./brain');

const PORTRAIT_SIZE = { width: 220, height: 220 };
const CHAT_SIZE = { width: 340, height: 460 };
const CHAT_GAP = 12;
const TOGGLE_KEY = 'CommandOrControl+Alt+C';
const WARMUP_TIMEOUT_MS = 120000;

const page = path.join(__dirname, '../html/index.html');
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
let appSettings = { timeZone: 'Asia/Karachi' };

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
  return path.join(app.getPath('userData'), 'settings.json');
}

async function loadSettings() {
  try {
    const savedSettings = JSON.parse(await fs.readFile(settingsFile(), 'utf8'));
    if (!savedSettings || !isValidTimeZone(savedSettings.timeZone)) {
      throw new Error('Saved settings contain an invalid time zone.');
    }
    appSettings = { ...appSettings, ...savedSettings };
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
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
  if (settingsOpenedFromPortrait) showFull();
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
      .then(() => brain.warmup())
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
ipcMain.handle('settings:get', () => ({ ...appSettings }));
ipcMain.handle('settings:set-time-zone', async (_event, timeZone) => {
  if (!isValidTimeZone(timeZone)) {
    throw new Error('Choose a valid IANA time zone.');
  }

  const updatedSettings = { ...appSettings, timeZone };
  await fs.writeFile(settingsFile(), `${JSON.stringify(updatedSettings, null, 2)}\n`);
  appSettings = updatedSettings;
  return { ...appSettings };
});

ipcMain.handle('capri:ask', async (event, query) => {
  // A message sent during warm-up waits for it instead of racing it
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