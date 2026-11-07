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
  meter: document.querySelector('#voice-meter'),
  sendBtn: document.querySelector('#form .send'),
  micBtn: document.querySelector('#form .composer-mic'),
  dock: document.querySelector('#dock'),
  settings: document.querySelector('#settings'),
  settingsPage: document.querySelector('#settings-page'),
  settingsBack: document.querySelector('#settings-back'),
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
const toolUsageMessages = new Map();

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
  const settingsPromise = window.capriSettings.get().then(
    (settings) => ({ ok: true, settings }),
    (error) => ({ ok: false, error })
  );
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

  let requireStart = false;
  const startupSettings = await settingsPromise;
  if (!startupSettings.ok) {
    const errorMessage = startupSettings.error?.message
      || String(startupSettings.error);
    console.error('Failed to load startup settings:', startupSettings.error);
    logLine(
      `> settings/startup ... FAILED (${errorMessage})`,
      true
    );
  } else {
    requireStart = startupSettings.settings.requireStart === true;
  }

  if (requireStart) {
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

function updateToolUsage({ id, label, active }) {
  const existingMessage = toolUsageMessages.get(id);
  existingMessage?.remove();
  toolUsageMessages.delete(id);

  if (!active) return;

  const message = addMessage('tool-usage', `- ${label}`);
  toolUsageMessages.set(id, message);
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
  elements.micBtn.disabled = isBusy;

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
    console.error('Assistant request failed in the chat window:', error);
    responseText = "Ugh, something went sideways on my end. Give it another shot, choom.";
  }

  setState('eureka');
  await sleep(CONFIG.EUREKA_MS);

  setState('respond');
  await typeOut(addMessage('capri'), responseText);

  setState('idle');
  appState.localRun = false;
  setBusy(false);
}

// Click once to record and again to transcribe and send.
const VOICE = {
  MAX_MS: 60000,
  BARS: 48,
  BAR_INTERVAL_MS: 40,
};

const voice = {
  active: false,
  stopRequested: false,
  recorder: null,
  stream: null,
  audioCtx: null,
  analyser: null,
  raf: 0,
  maxTimer: 0,
  chunks: [],
  levels: [],
  recordingError: false,
  lastBar: 0,
};

function drawMeter(now) {
  const { meter } = elements;
  if (!voice.analyser) return;
  const ctx = meter.getContext('2d');
  const data = new Uint8Array(voice.analyser.fftSize);
  voice.analyser.getByteTimeDomainData(data);

  // RMS of the current frame
  let sum = 0;
  for (const v of data) {
    const n = (v - 128) / 128;
    sum += n * n;
  }
  const level = Math.min(1, Math.sqrt(sum / data.length) * 5);

  if (now - voice.lastBar >= VOICE.BAR_INTERVAL_MS) {
    voice.lastBar = now;
    voice.levels.push(level);
    if (voice.levels.length > VOICE.BARS) voice.levels.shift();
  }

  const dpr = window.devicePixelRatio || 1;
  const w = meter.width / dpr;
  const h = meter.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = getComputedStyle(meter).color;

  const slot = w / VOICE.BARS;
  const barWidth = Math.max(2, slot * 0.6);
  voice.levels.forEach((l, i) => {
    const barHeight = Math.max(2, l * h);
    ctx.fillRect(i * slot, (h - barHeight) / 2, barWidth, barHeight);
  });

  voice.raf = requestAnimationFrame(drawMeter);
}

function showMeter(show) {
  const { meter, input } = elements;
  if (show) {
    // Match the input's size before hiding it
    const rect = input.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    meter.style.width = `${rect.width}px`;
    meter.style.height = `${rect.height}px`;
    meter.width = Math.round(rect.width * dpr);
    meter.height = Math.round(rect.height * dpr);
  }
  input.hidden = show;
  meter.hidden = !show;
  setMicActive(show);
}

function setMicActive(active) {
  elements.micBtn.classList.toggle('recording', active);
  elements.micBtn.setAttribute('aria-pressed', String(active));
  elements.micBtn.title = active
    ? 'Stop recording and send'
    : 'Start voice recording';
  elements.micBtn.setAttribute(
    'aria-label',
    active ? 'Stop recording and send' : 'Start voice recording'
  );
}

function releaseAudio() {
  cancelAnimationFrame(voice.raf);
  clearTimeout(voice.maxTimer);
  voice.stream?.getTracks().forEach((track) => track.stop());
  voice.audioCtx?.close().catch(() => {});
  voice.stream = voice.audioCtx = voice.analyser = voice.recorder = null;
  showMeter(false);
}

function getRecorderOptions() {
  const mimeType = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ].find((type) => MediaRecorder.isTypeSupported(type));

  return mimeType ? { mimeType } : undefined;
}

async function startRecording() {
  if (voice.active || appState.busy) return;
  voice.active = true;
  voice.stopRequested = false;
  setMicActive(true);

  try {
    voice.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (error) {
    voice.active = false;
    releaseAudio();
    console.error('Failed to access the microphone:', error);
    const message = error.name === 'NotAllowedError' || error.name === 'SecurityError'
      ? 'Allow microphone access to use voice input'
      : error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError'
        ? 'No microphone found'
        : error.name === 'NotReadableError' || error.name === 'TrackStartError'
          ? 'Microphone is busy or unavailable'
          : 'Could not start the microphone';
    elements.input.placeholder = message;
    setTimeout(() => {
      elements.input.placeholder = 'Type a request';
    }, 3000);
    return;
  }

  if (voice.stopRequested) {
    voice.active = false;
    releaseAudio();
    return;
  }

  voice.chunks = [];
  voice.levels = [];
  voice.recordingError = false;

  try {
    try {
      voice.audioCtx = new AudioContext();
      voice.analyser = voice.audioCtx.createAnalyser();
      voice.analyser.fftSize = 512;
      voice.audioCtx.createMediaStreamSource(voice.stream).connect(voice.analyser);
    } catch (error) {
      console.warn('Audio meter unavailable; recording will continue:', error);
      voice.audioCtx?.close().catch((closeError) =>
        console.warn('Failed to close the audio meter:', closeError)
      );
      voice.audioCtx = voice.analyser = null;
    }

    voice.recorder = new MediaRecorder(voice.stream, getRecorderOptions());
    voice.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) voice.chunks.push(event.data);
    };
    voice.recorder.onerror = (event) => {
      voice.recordingError = true;
      console.error('Audio recording failed:', event.error);
      voice.active = false;
      releaseAudio();
      elements.input.placeholder = 'Recording failed. Try again, choom.';
      setTimeout(() => {
        elements.input.placeholder = 'Type a request';
      }, 4000);
    };
    voice.recorder.onstop = finishRecording;
    voice.recorder.start(250);

    showMeter(true);
    if (voice.analyser) voice.raf = requestAnimationFrame(drawMeter);
    voice.maxTimer = setTimeout(stopRecording, VOICE.MAX_MS);
  } catch (error) {
    voice.active = false;
    releaseAudio();
    console.error('Failed to start audio recording:', error);
    elements.input.placeholder = 'Could not start recording. Try again, choom.';
    setTimeout(() => {
      elements.input.placeholder = 'Type a request';
    }, 4000);
  }
}

function stopRecording() {
  if (!voice.active) return;
  if (!voice.recorder) {
    voice.stopRequested = true;
    return;
  }
  if (voice.recorder.state !== 'recording') return;
  voice.recorder.stop();
}

async function finishRecording() {
  if (voice.recordingError) {
    voice.recordingError = false;
    releaseAudio();
    voice.active = false;
    return;
  }

  const blob = new Blob(voice.chunks, {
    type: voice.recorder?.mimeType || voice.chunks[0]?.type || 'audio/webm',
  });
  releaseAudio();
  voice.active = false;

  if (blob.size === 0) {
    elements.input.placeholder = 'No audio was recorded';
    setTimeout(() => {
      elements.input.placeholder = 'Type a request';
    }, 2000);
    return;
  }

  setBusy(true);
  elements.input.placeholder = 'Transcribing...';

  try {
    const result = await window.capri.transcribe({
      audio: await blob.arrayBuffer(),
      mimeType: blob.type,
    });
    if (result.error) {
      elements.input.placeholder = result.error;
      setTimeout(() => {
        elements.input.placeholder = 'Type a request';
      }, 4000);
      setBusy(false);
      return;
    }
    const text = result.text.trim();
    elements.input.placeholder = 'Type a request';
    setBusy(false);
    if (text) handleRequest(text);
    else {
      elements.input.placeholder = 'No speech detected';
      setTimeout(() => {
        elements.input.placeholder = 'Type a request';
      }, 2500);
    }
  } catch (error) {
    console.error('Voice transcription failed:', error);
    elements.input.placeholder =
      'Transcription failed. Give it another shot, choom.';
    setTimeout(() => {
      elements.input.placeholder = 'Type a request';
    }, 4000);
    setBusy(false);
  }
}

function initVoiceInput() {
  const mic = elements.micBtn;

  mic.addEventListener('click', () => {
    if (mic.disabled) return;
    if (voice.active) stopRecording();
    else startRecording();
  });
  mic.addEventListener('contextmenu', (event) => event.preventDefault());
}

function bindEvents() {
  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = elements.input.value;
    elements.input.value = '';
    handleRequest(query);
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
  elements.dock.textContent = VIEW === 'full' ? 'Mini view' : 'Full view';
  elements.settings.addEventListener('click', showSettingsPage);
  elements.settingsBack.addEventListener('click', () => {
    hideSettingsPage();
    winApi?.closeSettings();
  });
  elements.dock.addEventListener('click', () => {
    if (VIEW === 'full') winApi?.showPortrait();
    else winApi?.showFull();
  });

  winApi?.onSettingsOpen(showSettingsPage);
  winApi?.onSettingsClose(hideSettingsPage);
  winApi?.onToolUsage(updateToolUsage);

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
    for (const message of toolUsageMessages.values()) {
      elements.log.appendChild(message);
    }
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
initVoiceInput();
runLoadingScreen().then(() => {
  elements.input.focus();
  blinkLoop();
});