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
};

// Cache the UI elements once
const elements = {
  sprite: document.querySelector('#sprite'),
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const spritePath = (key) => `${CONFIG.ASSET_DIR}/${CONFIG.FILES[key]}.jpg`;

function preloadSprites() {
  Object.keys(CONFIG.FILES).forEach((key) => {
    const sprite = new Image();
    sprite.src = spritePath(key);
  });
}

function setState(nextState) {
  appState.current = nextState;
  document.body.dataset.state = nextState;
  elements.sprite.src = spritePath(nextState);
  elements.statusLabel.textContent = CONFIG.LABELS[nextState];

  elements.sprite.classList.remove('glitch');

  // Restart glitch animation on state change
  void elements.sprite.offsetWidth;
  elements.sprite.classList.add('glitch');
}

function blinkLoop() {
  setTimeout(async () => {
    if (appState.current === 'idle') {
      elements.sprite.src = spritePath('blink');
      await sleep(250);
      if (appState.current === 'idle') {
        elements.sprite.src = spritePath('idle');
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

preloadSprites();
bindEvents();
blinkLoop();