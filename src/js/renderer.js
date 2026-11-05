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
  chips: [...document.querySelectorAll('.chip')],
};

const appState = {
  current: 'idle',
  busy: false,
};

let conversation = [];

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

function setState(nextState) {
  appState.current = nextState;
  document.body.dataset.state = nextState;
  showSprite(nextState);
  elements.statusLabel.textContent = CONFIG.LABELS[nextState];

  elements.sprite.classList.remove('glitch');

  // Restart glitch animation on state change
  void elements.sprite.offsetWidth;
  elements.sprite.classList.add('glitch');
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

  setBusy(true);
  addMessage('you', query);

  let responseText;
  setState('think');

  // Update UI when assistant replies
  try {
    const { text = '', messages } = await ask(query, conversation);
    if (messages) conversation = messages;
    responseText = text;
  } catch (error) {
    responseText = `That request failed: ${error.message}. Try again.`;
  }

  setState('eureka');
  await sleep(CONFIG.EUREKA_MS);

  setState('respond');
  await typeOut(addMessage('capri'), responseText);

  setState('idle');
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

showSprite('idle');
bindEvents();
runLoadingScreen().then(() => {
  elements.input.focus();
  blinkLoop();
});