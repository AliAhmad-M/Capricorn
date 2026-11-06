const CONFIG = {
  ASSET_DIR: '../../assets',
  FILES: {
    idle: 'idle',
    blink: 'idle_blink',
    think: 'think',
    eureka: 'eureka',
    respond: 'respond',
  },
  LABELS: {
    idle: 'Idle',
    think: 'Thinking',
    eureka: 'OK',
    respond: 'Responding',
  },
  EUREKA_MS: 900,
  TYPE_MS: 16,
  STEP_MS: 120,
  LOAD_MIN_MS: 1000,
  FONT_TIMEOUT_MS: 3000,
  WARMUP_TIMEOUT_MS: 130000,
  LOADER_FADE_MS: 250,
  REQUIRE_START: false,
};

// Cache the UI elements once
const elements = {
  app: document.querySelector('.app'),
  loader: document.querySelector('#loader'),
  loaderFill: document.querySelector('#loader-fill'),
  loaderLabel: document.querySelector('#loader-label'),
  loaderPercent: document.querySelector('#loader-percent'),
  loaderLog: document.querySelector('#loader-log'),
  sprite: document.querySelector('#sprite'),
  portrait: document.querySelector('.portrait'),
  statusLabel: document.querySelector('#status-label'),
  log: document.querySelector('#log'),
  form: document.querySelector('#form'),
  input: document.querySelector('#input'),
  sendBtn: document.querySelector('#form .send'),
  dock: document.querySelector('#dock'),
  settings: document.querySelector('#settings'),
  settingsPage: document.querySelector('#settings-page'),
  chips: [...document.querySelectorAll('.chip')],
};

// Which window this page is running in
const VIEW = new URLSearchParams(location.search).get('view') || 'full';
document.body.dataset.view = VIEW;
const winApi = window.capriWindow;

const appState = {
  current: 'idle',
  busy: false,
  localRun: false,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const spritePath = (key) => `${CONFIG.ASSET_DIR}/${CONFIG.FILES[key]}.jpg`;
const spriteUrl = (key) => new URL(spritePath(key), document.baseURI).href;

function showSprite(key) {
  elements.sprite.src = spritePath(key);
  elements.portrait.style.setProperty('--sprite', `url("${spriteUrl(key)}")`);
}

// Cache all sprites
const loadedSprites = [];

function loadSprite(key) {
  return new Promise((resolve) => {
    const sprite = new Image();
    sprite.onload = () => resolve(true);
    sprite.onerror = () => resolve(false);
    sprite.src = spritePath(key);
    loadedSprites.push(sprite);
  });
}

function logLine(text, bad = false) {
  const line = document.createElement('div');
  line.className = bad ? 'loader-line bad' : 'loader-line';
  line.textContent = text;
  elements.loaderLog.appendChild(line);

  while (elements.loaderLog.children.length > 6) {
    elements.loaderLog.firstChild.remove();
  }
}

function setLoaderProgress(done, total) {
  const fraction = done / total;
  elements.loaderFill.style.setProperty('--progress', fraction);
  elements.loaderPercent.textContent =
    `${String(Math.round(fraction * 100)).padStart(3, '0')}%`;
}

function waitForStart() {
  return new Promise((resolve) => {
    const go = () => {
      window.removeEventListener('keydown', go);
      window.removeEventListener('pointerdown', go);
      resolve();
    };
    window.addEventListener('keydown', go);
    window.addEventListener('pointerdown', go);
  });
}

async function runLoadingScreen() {
  const tasks = [
    ...Object.keys(CONFIG.FILES).map((key) => ({
      label: `sprite/${CONFIG.FILES[key]}`,
      run: loadSprite(key),
    })),
    {
      label: 'font/chakra-petch',
      run: Promise.race([
        document.fonts.ready.then(() => true),
        sleep(CONFIG.FONT_TIMEOUT_MS).then(() => false),
      ]),
    },
    {
      // Load the model and system prompt through main
      label: 'model/system-prompt',
      run: Promise.race([
        window.capri?.warmup
          ? window.capri.warmup().catch(() => false)
          : Promise.resolve(true),
        sleep(CONFIG.WARMUP_TIMEOUT_MS).then(() => false),
      ]),
    },
  ];

  logLine('> boot sequence start');

  let finished = 0;
  const tracked = tasks.map(async ({ label, run }, index) => {
    const ok = await run;
    await sleep(CONFIG.STEP_MS * (index + 1));
    finished += 1;
    setLoaderProgress(finished, tasks.length);
    logLine(`> ${label} ... ${ok ? 'OK' : 'FAILED'}`, !ok);
  });

  await Promise.all([...tracked, sleep(CONFIG.LOAD_MIN_MS)]);

  logLine('> loading complete');
  elements.loaderLabel.textContent = 'Ready';

  if (CONFIG.REQUIRE_START) {
    elements.loader.classList.add('ready');
    await waitForStart();
  } else {
    await sleep(250);
  }

  elements.app.inert = false;
  elements.loader.classList.add('done');
  await sleep(CONFIG.LOADER_FADE_MS);
  elements.loader.remove();
}

function setState(nextState, broadcast = true) {
  appState.current = nextState;
  elements.dock.disabled = nextState !== 'idle';
  elements.settings.disabled = nextState !== 'idle';
  document.body.dataset.state = nextState;
  showSprite(nextState);
  elements.statusLabel.textContent = CONFIG.LABELS[nextState];

  elements.sprite.classList.remove('glitch');

  // Replay animation on state change
  void elements.sprite.offsetWidth;
  elements.sprite.classList.add('glitch');

  // Broadcast sprite across windows
  if (broadcast) winApi?.sendState(nextState);
}

function blinkLoop() {
  setTimeout(async () => {
    if (appState.current === 'idle') {
      showSprite('blink');
      await sleep(250);
      if (appState.current === 'idle') {
        showSprite('idle');
      }
    }
    blinkLoop();
  }, 2500 + Math.random() * 3000);
}

function addMessage(who, text = '') {
  document.querySelector('#empty')?.remove();

  const message = document.createElement('div');
  message.className = `msg ${who}`;
  message.textContent = text;
  elements.log.appendChild(message);
  elements.log.scrollTop = elements.log.scrollHeight;

  return message;
}

async function typeOut(element, text) {
  element.classList.add('typing');

  for (const char of text) {
    element.textContent += char;
    elements.log.scrollTop = elements.log.scrollHeight;
    await sleep(CONFIG.TYPE_MS);
  }

  element.classList.remove('typing');
}

function setBusy(isBusy) {
  appState.busy = isBusy;
  elements.input.disabled = isBusy;
  elements.sendBtn.disabled = isBusy;
  elements.chips.forEach((chip) => {
    chip.disabled = isBusy;
  });

  if (!isBusy) {
    elements.input.focus();
  }
}

const ask = window.capri?.ask ?? (async (query) => {
  await sleep(2000);
  return { text: `Demo mode. You asked: "${query}".` };
});

async function handleRequest(rawQuery) {
  const query = rawQuery.trim();
  if (!query || appState.busy) return;

  appState.localRun = true;
  setBusy(true);
  addMessage('you', query);

  let responseText;
  setState('think');

  // Update UI when Capri replies
  try {
    const { text = '' } = await ask(query);
    responseText = text;
  } catch (error) {
    responseText = `That request failed: ${error.message}. Try again.`;
  }

  setState('eureka');
  await sleep(CONFIG.EUREKA_MS);

  setState('respond');
  await typeOut(addMessage('capri'), responseText);

  setState('idle');
  appState.localRun = false;
  setBusy(false);
}

function bindEvents() {
  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = elements.input.value;
    elements.input.value = '';
    handleRequest(query);
  });

  elements.chips.forEach((chip) => {
    chip.addEventListener('click', () => handleRequest(chip.textContent));
  });
}

// Drag and double click
const DRAG_THRESHOLD_PX = 4;
const CLICK_DELAY_MS = 220;

function initPortraitMode() {
  const target = document.querySelector('.portrait-wrap');
  let start = null;
  let dragging = false;
  let clickTimer = null;

  // Stop the browser from starting its own image drag
  target.addEventListener('dragstart', (event) => event.preventDefault());

  target.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    target.setPointerCapture(event.pointerId);
    start = { x: event.screenX, y: event.screenY };
    dragging = false;
    winApi?.dragStart();
  });

  target.addEventListener('pointermove', (event) => {
    if (!start) return;
    const moved = Math.hypot(event.screenX - start.x, event.screenY - start.y);
    if (!dragging && moved < DRAG_THRESHOLD_PX) return;
    dragging = true;
    winApi?.dragMove();
  });

  function finishPress(isClickAllowed) {
    if (!start) return;
    const wasDrag = dragging;
    start = null;
    dragging = false;
    winApi?.dragEnd();
    if (wasDrag || !isClickAllowed) return;
    // Wait for double click
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => winApi?.toggleChat(), CLICK_DELAY_MS);
  }

  target.addEventListener('pointerup', () => finishPress(true));
  target.addEventListener('pointercancel', () => finishPress(false));
  target.addEventListener('lostpointercapture', () => finishPress(false));

  target.addEventListener('dblclick', () => {
    clearTimeout(clickTimer);
    winApi?.showFull();
  });

  target.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    winApi?.showMenu();
  });
}

// Focus the input when opened and Esc key to close the chat
function initChatWindow() {
  winApi?.onFocus(() => elements.input.focus());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') winApi?.closeChat();
  });
}

// State and transcript syncing and switching beteen windows
function initViewSwitching() {
  elements.dock.textContent = VIEW === 'full' ? 'Portrait mode' : 'Full view';
  elements.settings.addEventListener('click', showSettingsPage);
  elements.dock.addEventListener('click', () => {
    if (VIEW === 'full') winApi?.showPortrait();
    else winApi?.showFull();
  });

  winApi?.onSettingsOpen(showSettingsPage);
  winApi?.onSettingsClose(hideSettingsPage);

  // Copy state from another window
  winApi?.onState((state) => {
    if (appState.localRun) return;
    setState(state, false);
    setBusy(state !== 'idle');
  });

  // Update the messages UI
  winApi?.onSync((items) => {
    if (appState.localRun || !items.length) return;
    elements.log.replaceChildren();
    items.forEach(({ who, text }) => addMessage(who, text));
  });
}

function showSettingsPage() {
  elements.app.hidden = true;
  elements.settingsPage.hidden = false;
  document.body.dataset.view = 'settings';
}

function hideSettingsPage() {
  elements.settingsPage.hidden = true;
  elements.app.hidden = false;
  document.body.dataset.view = VIEW;
}

initViewSwitching();
if (VIEW === 'portrait') initPortraitMode();
if (VIEW === 'chat') initChatWindow();

showSprite('idle');
bindEvents();
runLoadingScreen().then(() => {
  elements.input.focus();
  blinkLoop();
});