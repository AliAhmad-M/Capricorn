const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const brain = require('./brain');

function createWindow() {
  const win = new BrowserWindow({
    width: 1040,
    height: 700,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'Capricorn',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../html/index.html'));
}

// Keep assistant work in the main process
ipcMain.handle('capri:ask', (_event, query) => brain.ask(String(query)));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());