// Renderer-side app state
const CONFIG = {
  ASSET_DIR: '../../assets',
  FILES: {
    idle: 'idle',
    blink: 'idle_blink',
    think: 'think',
    drag: 'drag',
    eureka: 'eureka',
    respond: 'respond',
  },
  LABELS: {
    idle: 'Idle',
    think: 'Thinking',
    eureka: 'Ready',
    respond: 'Responding',
  },
  EUREKA_MS: 900,
  TYPE_MS: 16,
  STEP_MS: 120,
  LOAD_MIN_MS: 1000,
  FONT_TIMEOUT_MS: 3000,
  WARMUP_TIMEOUT_MS: 130000,
  LOADER_FADE_MS: 250,
  SPEECH_TIMEOUT_MS: 180000,
  SPEECH_CHARS_PER_SEC: 15,
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
  speechToggle: document.querySelector('#speech-toggle'),
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

// Streams each assistant response
class CapriStreamPlayer {
  constructor() {
    this.ctx = null;
    this.turnId = null;
    this.sampleRate = 44100;
    this.startTime = null;
    this.nextTime = 0;
    this.leftover = null;
    this.ended = false;
    this.sources = new Set();
    this.onFinished = null;
  }

  start(turnId, sampleRate) {
    this.stop();
    this.turnId = turnId;
    this.sampleRate = sampleRate;
    this.ended = false;
    this.ctx ||= new AudioContext({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // 16-bit signed little-endian mono PCM
  push(turnId, bytes) {
    if (turnId !== this.turnId || !this.ctx) return;

    let data = bytes;
    if (this.leftover) {
      data = new Uint8Array(this.leftover.length + bytes.length);
      data.set(this.leftover);
      data.set(bytes, this.leftover.length);
    }

    const usable = data.length - (data.length % 2);
    this.leftover = usable < data.length ? data.slice(usable) : null;
    if (!usable) return;

    const frames = usable / 2;
    const view = new DataView(data.buffer, data.byteOffset, usable);
    const buffer = this.ctx.createBuffer(1, frames, this.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) channel[i] = view.getInt16(i * 2, true) / 32768;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    const now = this.ctx.currentTime;
    if (this.nextTime < now) this.nextTime = now + 0.05;
    if (this.startTime === null) this.startTime = this.nextTime;
    source.start(this.nextTime);
    this.nextTime += buffer.duration;

    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      this.checkFinished();
    };
  }

  end(turnId) {
    if (turnId !== this.turnId) return;
    this.ended = true;
    this.checkFinished();
  }

  checkFinished() {
    if (this.ended && this.sources.size === 0) {
      this.turnId = null;
      this.onFinished?.();
    }
  }

  // Seconds played so far
  elapsed() {
    if (this.startTime === null || !this.ctx) return 0;
    return Math.max(0, this.ctx.currentTime - this.startTime);
  }

  // Seconds from the first sample to the end of everything scheduled
  duration() {
    return this.startTime === null ? 0 : this.nextTime - this.startTime;
  }

  // Stop the audio streaming
  stop() {
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch {}
    }
    this.sources.clear();
    this.turnId = null;
    this.leftover = null;
    this.ended = false;
    this.startTime = null;
    this.nextTime = 0;
  }
}

// Dialogue that appears when portrait is dragged
const dragSpeech = document.getElementById('drag-speech');
const dragSpeechText = document.getElementById('drag-speech-text');
const DRAG_SPEECH_LINES = [
  'Hey, put me down!',
  'Where are you taking me?',
  'I can walk, you know.',
  'Weeeee! This is fun!',
  'Unhand me, you gonk!',
  'Take me to the top of the screen!',
  'Fine, I wanted to move anyway.',
  'Weeee. Okay, that\'s enough now.',
  'Drop me somewhere nice. Ok?',
  'This better be going somewhere good.',
];

let lastDragSpeechIndex = -1;

function showDragSpeech() {
  if (appState.current !== 'idle') return;
  
  let index;

  do {
    index = Math.floor(Math.random() * DRAG_SPEECH_LINES.length);
  } while (
    index === lastDragSpeechIndex &&
    DRAG_SPEECH_LINES.length > 1
  );

  lastDragSpeechIndex = index;
  dragSpeechText.textContent = DRAG_SPEECH_LINES[index];
  dragSpeech.hidden = false;
}

function hideDragSpeech() {
  dragSpeech.hidden = true;
}

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

// Show the portrait sprite
function showSprite(key) {
  elements.sprite.src = spritePath(key);
  elements.portrait.style.setProperty('--sprite', `url("${spriteUrl(key)}")`);
}

// Cache all sprites first
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

// Append a line to the boot log on loading
function logLine(text, bad = false) {
  const line = document.createElement('div');
  line.className = bad ? 'loader-line bad' : 'loader-line';
  line.textContent = text;
  elements.loaderLog.appendChild(line);

  while (elements.loaderLog.children.length > 6) {
    elements.loaderLog.firstChild.remove();
  }
}

// Advance the loading meter as we progress
function setLoaderProgress(done, total) {
  const fraction = done / total;
  elements.loaderFill.style.setProperty('--progress', fraction);
  elements.loaderPercent.textContent =
    `${String(Math.round(fraction * 100)).padStart(3, '0')}%`;
}

// Wait for key to start
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

// Start the loading screen initially
async function runLoadingScreen() {
  const settingsPromise = window.capriSettings.get().then(
    (settings) => ({ ok: true, settings }),
    (error) => ({ ok: false, error })
  );
  const assetTasks = [
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

  const tracked = assetTasks.map(async ({ label, run }, index) => {
    const ok = await run;
    await sleep(CONFIG.STEP_MS * (index + 1));

    finished += 1;
    setLoaderProgress(finished, assetTasks.length);
    logLine(`> ${label} ... ${ok ? 'OK' : 'FAILED'}`, !ok);
  });

  await Promise.all([...tracked, sleep(CONFIG.LOAD_MIN_MS)]);

  logLine('> assets loaded');

  // Model warmup starts only after assets finish loading
  elements.loaderLabel.textContent = 'Initializing model';

  const warmupOk = await Promise.race([
    window.capri?.warmup
      ? window.capri.warmup().catch(() => false)
      : Promise.resolve(true),
    sleep(CONFIG.WARMUP_TIMEOUT_MS).then(() => false),
  ]);

  logLine(`> model/system-prompt ... ${warmupOk ? 'OK' : 'FAILED'}`, !warmupOk);

  logLine('> loading complete');
  elements.loaderLabel.textContent = 'Ready';

  let requireStart = false;
  let startInMini = false;
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
    startInMini = startupSettings.settings.startInMini === true;
  }

  if (requireStart && VIEW === 'full') {
    elements.loader.classList.add('ready');
    await waitForStart();
  } else {
    await sleep(250);
  }

  elements.app.inert = false;
  elements.loader.classList.add('done');
  await sleep(CONFIG.LOADER_FADE_MS);
  elements.loader.remove();
  if (startInMini && VIEW === 'full') winApi?.showPortrait();
}

let isDraggingPortrait = false;

// Switch the app mood
function setState(nextState, broadcast = true) {
  appState.current = nextState;
  elements.dock.disabled = nextState !== 'idle';
  elements.settings.disabled = nextState !== 'idle';
  document.body.dataset.state = nextState;

  if (!isDraggingPortrait) {
    showSprite(nextState);
  }

  elements.statusLabel.textContent = CONFIG.LABELS[nextState];

  elements.sprite.classList.remove('glitch');

  // Replay animation on state change
  void elements.sprite.offsetWidth;
  elements.sprite.classList.add('glitch');

  // Broadcast sprite state across windows
  if (broadcast) winApi?.sendState(nextState);
}

// Sprite blink animation
function blinkLoop() {
  setTimeout(async () => {
    if (appState.current === 'idle' && !isDraggingPortrait) {
      showSprite('blink');
      await sleep(250);
      
      if (appState.current === 'idle' && !isDraggingPortrait) {
        showSprite('idle');
      }
    }
    
    blinkLoop();
  }, 2500 + Math.random() * 3000);
}

// Create a chat bubble
function addMessage(who, text = '') {
  document.querySelector('#empty')?.remove();

  const message = document.createElement('div');
  message.className = `msg ${who}`;
  message.textContent = text;
  elements.log.appendChild(message);
  elements.log.scrollTop = elements.log.scrollHeight;

  return message;
}

// Update the tool status
function updateToolUsage({ id, label, active }) {
  const existingMessage = toolUsageMessages.get(id);
  existingMessage?.remove();
  toolUsageMessages.delete(id);

  if (!active) return;

  const message = addMessage('tool-usage', `- ${label}`);
  toolUsageMessages.set(id, message);
}

// Type each message into the log gradually
async function typeOut(element, text, durationMs = null) {
  element.classList.add('typing');

  const typeMs = Number.isFinite(durationMs) && durationMs > 0
    ? durationMs / Math.max(1, text.length)
    : CONFIG.TYPE_MS;

  for (const char of text) {
    element.textContent += char;
    elements.log.scrollTop = elements.log.scrollHeight;
    await sleep(typeMs);
  }

  element.classList.remove('typing');
}

// Lock the UI during a response
function setBusy(isBusy) {
  appState.busy = isBusy;
  elements.input.disabled = isBusy;
  elements.sendBtn.disabled = isBusy;
  elements.micBtn.disabled = isBusy;

  if (!isBusy) {
    elements.input.focus();
  }
}

const ask = window.capri?.ask
  ? (query) => window.capri.ask(query, { speak: true })
  : async (query) => {
      await sleep(2000);
      return { text: `Demo mode. You asked: "${query}".` };
    };

// Stream text and audio
const player = new CapriStreamPlayer();
const speech = { pending: false };

// Text shown with audio
const reveal = {
  text: '',
  shown: 0,
  element: null,
  complete: false,
  noAudio: false,
};

// Reset the reveal animation state
function resetReveal() {
  reveal.text = '';
  reveal.shown = 0;
  reveal.element = null;
  reveal.complete = false;
  reveal.noAudio = false;
}

function finishSpeech() {
  speech.pending = false;
  reveal.noAudio = true;
}

player.onFinished = finishSpeech;

// Speech on/off toggle on the portrait
const speechSetting = { enabled: true };
function applySpeechSetting(enabled) {
  speechSetting.enabled = enabled;

  const button = elements.speechToggle;
  const label = enabled ? 'Turn speech off' : 'Turn speech on';
  button.setAttribute('aria-pressed', String(enabled));
  button.setAttribute('aria-label', label);
  button.title = label;

  if (!enabled) {
    player.stop();
    // Send the pending text normally
    if (speech.pending) finishSpeech();
  }
}

// Initialize the speech toggle button
function initSpeechToggle() {
  const button = elements.speechToggle;

  // Keep clicks off the portrait's drag, click and double click handlers
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'dblclick']) {
    button.addEventListener(type, (event) => event.stopPropagation());
  }

  button.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  button.addEventListener('click', async () => {
    const next = !speechSetting.enabled;
    button.disabled = true;

    try {
      const result = await window.capriSettings.setSpeechEnabled(next);
      applySpeechSetting(result.speechEnabled);
    } catch (error) {
      console.error('Failed to change the speech setting:', error);
    } finally {
      button.disabled = false;
    }
  });

  // Stay in sync with the other windows
  winApi?.onSpeechEnabled(applySpeechSetting);

  window.capriSettings.get().then(
    (settings) => applySpeechSetting(settings.speechEnabled !== false),
    (error) => console.error('Failed to load the speech setting:', error)
  );
}

// Start playing audio
window.capri?.onAudioStart?.(({ turnId, sampleRate }) => {
  speech.pending = true;
  player.start(turnId, sampleRate);
});

// Push audio chunk
window.capri?.onAudioChunk?.(({ turnId, chunk }) => player.push(turnId, chunk));

// Audio finished
window.capri?.onAudioEnd?.(({ turnId }) => player.end(turnId));

// Error in audio
window.capri?.onAudioError?.(({ error }) => {
  console.error('Fish Audio failed:', error);
  player.stop();
  finishSpeech();
});

// Collect text
window.capri?.onTextDelta?.(({ text }) => {
  if (!appState.localRun || typeof text !== 'string') return;
  reveal.text = text;

  // The answer has started arriving, so show Ready until the voice begins
  if (appState.current === 'think' && text.trim()) setState('eureka');
});

// Keep adding text
function renderReveal(count) {
  if (count <= reveal.shown) return;

  if (!reveal.element) {
    setState('respond');
    reveal.element = addMessage('capri');
    reveal.element.classList.add('typing');
  }

  reveal.element.textContent = reveal.text.slice(0, count);
  reveal.shown = count;
  elements.log.scrollTop = elements.log.scrollHeight;
}

// Type in sync with audio
function runReveal() {
  return new Promise((resolve) => {
    const began = performance.now();
    let last = began;

    const tick = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;

      // Finish if end signal never arrives
      if (now - began > CONFIG.SPEECH_TIMEOUT_MS) {
        player.stop();
        finishSpeech();
      }

      const length = reveal.text.length;
      let target = reveal.shown;

      if (reveal.noAudio) {
        // No voice, type at the normal speed
        target += Math.max(1, Math.round(dt / CONFIG.TYPE_MS));
      } else if (player.startTime !== null) {
        const elapsed = player.elapsed();

        // All audio has been generated
        const total = player.ended ? player.duration() : 0;
        target = total > 0
          ? Math.round(length * Math.min(1, elapsed / total))
          : Math.round(elapsed * CONFIG.SPEECH_CHARS_PER_SEC);
      }

      renderReveal(Math.min(length, Math.max(reveal.shown, target)));

      if (reveal.complete && reveal.shown >= length && !speech.pending) {
        reveal.element?.classList.remove('typing');
        resolve();
        return;
      }

      setTimeout(tick, 16);
    };

    tick();
  });
}

// Send a user prompt and render result
async function handleRequest(rawQuery) {
  const query = rawQuery.trim();
  if (!query || appState.busy) return;

  appState.localRun = true;
  setBusy(true);
  addMessage('you', query);

  resetReveal();
  if (!speechSetting.enabled) reveal.noAudio = true;
  player.stop();
  const revealed = runReveal();
  let responseText;
  setState('think');

  // Update the GUI when Capri replies
  try {
    const { text = '' } = await ask(query);
    responseText = text;
  } catch (error) {
    console.error('Assistant request failed in the chat window:', error);
    responseText = "Ugh, something went sideways on my end. Give it another shot, choom.";
    reveal.noAudio = true;
  }

  // No voice to wait for, move to ready state
  if (!speech.pending && reveal.shown === 0) {
    setState('eureka');
    await sleep(CONFIG.EUREKA_MS);
  }

  // Respond with the final text
  reveal.text = responseText;
  if (!speech.pending) reveal.noAudio = true;
  reveal.complete = true;

  await revealed;

  if (reveal.element) reveal.element.textContent = responseText;

  setState('idle');
  appState.localRun = false;
  setBusy(false);
}

// Click once to record audio
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

// Live voice input meter
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
  const level = Math.min(1, Math.sqrt(sum / data.length) * 7);

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

// Show voice input meter
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

// Update mic button state
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

// Update GUI when audio sent
function releaseAudio() {
  cancelAnimationFrame(voice.raf);
  clearTimeout(voice.maxTimer);
  voice.stream?.getTracks().forEach((track) => track.stop());
  voice.audioCtx?.close().catch(() => {});
  voice.stream = voice.audioCtx = voice.analyser = voice.recorder = null;
  showMeter(false);
}

// Return type of audio
function getRecorderOptions() {
  const mimeType = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ].find((type) => MediaRecorder.isTypeSupported(type));

  return mimeType ? { mimeType } : undefined;
}

// Begin recording and update GUI
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

// Stop recording and update GUI
function stopRecording() {
  if (!voice.active) return;
  if (!voice.recorder) {
    voice.stopRequested = true;
    return;
  }
  if (voice.recorder.state !== 'recording') return;
  voice.recorder.stop();
}

// Finish recording and update GUI
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

// Initialize mic button
function initVoiceInput() {
  const mic = elements.micBtn;

  mic.addEventListener('click', () => {
    if (mic.disabled) return;
    if (voice.active) stopRecording();
    else startRecording();
  });
  mic.addEventListener('contextmenu', (event) => event.preventDefault());
}

// Bind the form, buttons, and window events
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

const waitFrames = (count) =>
  new Promise((resolve) => {
    const tick = () => (--count <= 0 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });

// Initialize the mini view window
function initPortraitMode() {
  const target = document.querySelector('.portrait-wrap');
  let start = null;
  let dragging = false;
  let clickTimer = null;

  function updateDragSprite() {
    if (VIEW !== 'portrait' || appState.current !== 'idle') return;

    if (isDraggingPortrait) {
      showSprite('drag');
    } else if (appState.current === 'think') {
      showSprite('think');
    } else {
      showSprite(appState.current);
    }
  }
  // Stop the browser from starting its own image drag
  target.addEventListener('dragstart', (event) => event.preventDefault());

  // Drag when pointer is held down
  target.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    target.setPointerCapture(event.pointerId);
    start = { x: event.screenX, y: event.screenY };
    dragging = false;
    winApi?.dragStart();
  });

  // Drag when the pointer is moved
  target.addEventListener('pointermove', (event) => {
    if (!start) return;

    const dx = event.screenX - start.x;
    const dy = event.screenY - start.y;

    if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      dragging = true;
      isDraggingPortrait = true;

      showDragSpeech();
      updateDragSprite();
    }

    if (dragging) {
      winApi?.dragMove();
    }
  });

  // Stop dragging
  function finishPress(isClickAllowed) {
    if (!start) return;

    const wasDrag = dragging;

    start = null;
    dragging = false;
    isDraggingPortrait = false;

    hideDragSpeech();
    winApi?.dragEnd();

    updateDragSprite();

    if (wasDrag || !isClickAllowed) return;

    // Wait for double click
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => winApi?.toggleChat(), CLICK_DELAY_MS);
  }

  target.addEventListener('pointerup', () => finishPress(true));
  target.addEventListener('pointercancel', () => finishPress(false));
  target.addEventListener('lostpointercapture', () => finishPress(false));

  // Go to full view on double click
  target.addEventListener('dblclick', () => {
    clearTimeout(clickTimer);
    winApi?.showFull();
  });

  // Handle context menu
  target.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    winApi?.showMenu();
  });

  // Handle ignore mouse
  let ignoring = null;
  const setIgnore = (value) => {
    if (ignoring === value) return;
    ignoring = value;
    winApi?.setIgnoreMouse(value);
  };
  setIgnore(true);
  document.addEventListener('mousemove', (event) => {
    if (start) return;
    setIgnore(!event.target.closest('.portrait-wrap'));
  });
}

// Initialize chat window in mini view
function initChatWindow() {
  winApi?.onFocus(() => elements.input.focus());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') winApi?.closeChat();
  });
}

// Initialize view switching logic
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

// Reveal the settings panel
function showSettingsPage() {
  elements.app.hidden = true;
  elements.settingsPage.hidden = false;
  document.body.dataset.view = 'settings';
}

// Hide the settings panel
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
initSpeechToggle();

runLoadingScreen().then(() => {
  elements.input.focus();
  blinkLoop();
});