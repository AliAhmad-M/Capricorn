const Groq = require('groq-sdk');
const WebSocket = require('ws');
const { encode, decode } = require('@msgpack/msgpack');
const { toolDefinitions, executeToolCall } = require('./tools');
const { CAPRI_SYSTEM_PROMPT } = require('./prompt');

// Default model choices
const DEFAULT_TEXT_MODELS = ['qwen/qwen3.8-27b', ];
const DEFAULT_VOICE_MODELS = ['whisper-large-v3-turbo'];
const DEFAULT_TTS_MODEL = 's2.1-pro-free';
const DEFAULT_TTS_VOICE = 'fdef76c9b2e741119d817754bd8b5dd0';

// TTS model properties
const FISH_WS_URL = 'wss://api.fish.audio/v1/tts/live';
const TTS_SAMPLE_RATE = 44100;

// Tool usage properties
const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_RETRIES = 3;

// Conversation history size
const MAX_HISTORY = 10;

// Text shown on tool usage
const TOOL_ACTIVITY_LABELS = {
  fetch_url: 'Reading webpage...',
  web_search: 'Searching the web...',
  get_current_datetime: 'Checking the date and time...',
  list_games: 'Finding games...',
  launch_game: 'Launching game...',
  list_software: 'Finding software...',
  launch_software: 'Launching software...',
  get_system_usage: 'Checking system usage...',
  list_resource_processes: 'Finding resource-heavy processes...',
  check_network_connectivity: 'Checking network connectivity...',
  get_current_directory: 'Checking the current folder...',
  change_directory: 'Changing folder...',
  list_directory: 'Looking through the folder...',
  find_files: 'Searching for files...',
  read_text_file: 'Reading file...',
  write_text_file: 'Writing file...',
  create_directory: 'Creating folder...',
  copy_item: 'Copying...',
  move_item: 'Moving...',
  delete_item: 'Deleting...',
  open_path: 'Opening...',
};

const TOOL_NAMES = toolDefinitions.map((tool) => tool.function.name);

// Get Groq client using the API key
let client;
let clientApiKey;
function getClient(settings = {}) {
  const apiKey = settings.groqApiKey || process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error('Set a Groq API key in Settings or the project .env file to use Capri.');
  }

  if (!client || clientApiKey !== apiKey) {
    client = new Groq({ apiKey });
    clientApiKey = apiKey;
  }

  return client;
}

// Return set of models from the input
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
  )];
}

// Return Groq text models
function getTextModels(settings = {}) {
  const configured = normalizeModelList(settings.groqTextModels);
  if (configured.length) return configured;

  const legacy = normalizeModelList(
    settings.groqTextModel || settings.groqModel
  );
  if (legacy.length) return legacy;

  const envModels = normalizeModelList([
    ...normalizeModelList(process.env.GROQ_TEXT_MODELS),
    ...normalizeModelList(process.env.GROQ_TEXT_MODEL),
  ]);

  return envModels.length ? envModels : [...DEFAULT_TEXT_MODELS];
}

// Return Groq voice models
function getVoiceModels(settings = {}) {
  const configured = normalizeModelList(settings.groqVoiceModels);
  if (configured.length) return configured;

  const legacy = normalizeModelList(settings.groqVoiceModel);
  if (legacy.length) return legacy;

  const envModels = normalizeModelList([
    ...normalizeModelList(process.env.GROQ_VOICE_MODELS),
    ...normalizeModelList(process.env.GROQ_VOICE_MODEL),
  ]);

  return envModels.length ? envModels : [...DEFAULT_VOICE_MODELS];
}

// Return Fish Audio tts models
function getTtsModels(settings = {}) {
  const configured = normalizeModelList(settings.fishTtsModels);
  if (configured.length) return configured;

  const legacy = normalizeModelList(settings.fishModel);
  if (legacy.length) return legacy;

  const envModels = normalizeModelList([
    ...normalizeModelList(process.env.FISH_AUDIO_TTS_MODELS),
    ...normalizeModelList(process.env.FISH_AUDIO_TTS_MODEL),
  ]);

  return envModels.length ? envModels : [DEFAULT_TTS_MODEL];
}

// Simplify common error messages
function getFriendlyErrorMessage(error) {
  const message = typeof error === 'string'
    ? error
    : error?.message || '';
  const status = Number(error?.status || error?.statusCode);
  const errorCode = [
    error?.code,
    error?.cause?.code,
  ].filter(Boolean).join(' ').toLowerCase();
  const errorName = `${error?.name || ''} ${error?.cause?.name || ''}`.toLowerCase();
  const details = `${message} ${errorCode} ${errorName}`.toLowerCase();

  if (/set a groq api key|missing groq api key/.test(details)) {
    return "Uh oh, it looks like you haven't set up your Groq API key yet. Add it in Settings and we'll be back in business.";
  }
  if (status === 401 || /authenticationerror|invalid api key|incorrect api key/.test(details)) {
    return "That Groq API key doesn't seem to be valid. Check it in Settings, choom.";
  }
  if (status === 403 || /permissiondeniederror|insufficient permissions/.test(details)) {
    return "Groq won't let me use that model with this API key. Check your key and model settings.";
  }
  if (status === 404 || /notfounderror|model.*not found/.test(details)) {
    return "I couldn't find that model or page. Check the model name or the address and try again.";
  }
  if (status === 429 || /ratelimiterror|rate limit|quota exceeded/.test(details)) {
    return "Groq's a little swamped or your usage limit kicked in. Give it a moment, then try again.";
  }
  if (status >= 500 || /internalservererror|service unavailable/.test(details)) {
    return "The service is having a rough moment. Give it a bit and try again, choom.";
  }
  if (
    errorName.includes('timeout') ||
    /timed out|timeout|etimedout/.test(details)
  ) {
    return "That took too long and timed out. Check your connection and give it another go.";
  }
  if (/enotfound|eai_again|econnreset|econnrefused|networkerror|failed to fetch|fetch failed/.test(details)) {
    return "I can't reach the service right now. Check your internet connection and try again.";
  }
  if (/unsupported voice recording format/.test(details)) {
    return "This recording format won't play nice with transcription. Try recording again.";
  }
  if (status === 400 || status === 422) {
    return "Groq couldn't process that request. Check the model settings and try again.";
  }

  return "Ugh, something went sideways on my end. Give it another shot, choom.";
}

// Get AI related settings
function getConfiguration(settings = {}) {
  const groqTextModels = getTextModels(settings);
  const groqVoiceModels = getVoiceModels(settings);

  return {
    groqApiKey: settings.groqApiKey || process.env.GROQ_API_KEY || '',
    groqTextModel: groqTextModels[0],
    groqTextModels,
    groqVoiceModel: groqVoiceModels[0],
    groqVoiceModels,
    fishTtsModels: getTtsModels(settings),
  };
}

// Construct the system prompt for the model
function buildSystemPrompt(settings = {}) {
  const userName = typeof settings.userName === 'string' ? settings.userName.trim() : '';

  let prompt =
    `${CAPRI_SYSTEM_PROMPT}\n` +
    'TOOL NAMES (use exactly these, nothing else)\n' +
    TOOL_NAMES.map((name) => `- ${name}`).join('\n');

  if (userName) {
    prompt += `\nUSER PROFILE\n- Preferred name: ${userName}`;
  }

  return prompt;
}


// Length of the longest ending of `text` that could be the start of `tag`
function partialTagLength(text, tag) {
  const max = Math.min(text.length, tag.length - 1);
  for (let length = max; length > 0; length--) {
    if (tag.startsWith(text.slice(-length))) return length;
  }
  return 0;
}

// Model reasoning tags to ignore
const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

// Cleans streamed text
class StreamCleaner {
  constructor() {
    this.buffer = '';
    this.inThink = false;
    this.started = false;
  }

  push(chunk) {
    this.buffer += chunk;
    let out = '';

    while (this.buffer) {
      if (this.inThink) {
        const end = this.buffer.indexOf(THINK_CLOSE);
        if (end === -1) {
          const keep = partialTagLength(this.buffer, THINK_CLOSE);
          this.buffer = this.buffer.slice(this.buffer.length - keep);
          break;
        }
        this.buffer = this.buffer.slice(end + THINK_CLOSE.length);
        this.inThink = false;
        continue;
      }

      const start = this.buffer.indexOf(THINK_OPEN);
      if (start !== -1) {
        out += this.clean(this.buffer.slice(0, start));
        this.buffer = this.buffer.slice(start + THINK_OPEN.length);
        this.inThink = true;
        continue;
      }

      // Hold back a partial tag and trailing spaces
      let safe = this.buffer.length - partialTagLength(this.buffer, THINK_OPEN);
      while (safe > 0 && /[\s—–]/.test(this.buffer[safe - 1])) safe--;
      out += this.clean(this.buffer.slice(0, safe));
      this.buffer = this.buffer.slice(safe);
      break;
    }

    return out;
  }

  flush() {
    const rest = this.inThink ? '' : this.buffer;
    this.buffer = '';
    return this.clean(rest).trimEnd();
  }

  clean(text) {
    let result = text.replace(/\s*[—–]\s*/g, ', ');
    if (!this.started) {
      result = result.trimStart();
      if (result) this.started = true;
    }
    return result;
  }
}

// Remove reasoning that some models return inline in content
function stripReasoning(text) {
  if (typeof text !== 'string') return text;
  const end = text.lastIndexOf(THINK_CLOSE);
  const answer = end === -1 ? text : text.slice(end + THINK_CLOSE.length);
  return answer.replace(/<think>[\s\S]*$/i, '').trim();
}

// Trim history to the last MAX_HISTORY messages
function trimHistory(conversation) {
  const history = conversation.slice(-MAX_HISTORY);
  const firstUser = history.findIndex((message) => message.role === 'user');
  return firstUser === -1 ? [] : history.slice(firstUser);
}

// Check if there was an error when calling tools
function isToolCallFailure(error) {
  return (
    error?.status === 400 &&
    /tool_use_failed|tool call validation failed/i.test(error.message || '')
  );
}

// Decide when to fallback to the next model
function shouldFallbackToNextModel(error) {
  if (
    error?.code === 'MODEL_OUTPUT_LIMIT' ||
    error?.code === 'MODEL_EMPTY_RESPONSE' ||
    isToolCallFailure(error)
  ) {
    return true;
  }

  const status = Number(error?.status || error?.statusCode);
  const details = [
    error?.message,
    error?.code,
    error?.cause?.code,
    error?.name,
  ].filter(Boolean).join(' ').toLowerCase();

  // Authentication errors
  if (
    status === 401 ||
    /authenticationerror|invalid api key|incorrect api key/.test(details)
  ) {
    return false;
  }

  // Availability errors
  if ([403, 404, 408, 409, 413, 429].includes(status) || status >= 500) {
    return true;
  }

  return /model.{0,50}(not found|unavailable|unsupported|decommissioned)|unsupported.{0,30}model|permission.{0,30}model|rate.?limit|quota|overload|capacity|(?:token|context).{0,40}(?:limit|maximum|exceed|too large|capacity|length)|(?:limit|maximum|exceed).{0,40}(?:token|context)|request.{0,20}too large|econnreset|econnrefused|enotfound|eai_again|etimedout|failed to fetch|fetch failed/.test(details);
}

// Stream the model completion response
async function streamCompletion(settings, model, messages, onText) {
  const cleaner = new StreamCleaner();
  const toolCalls = [];
  let content = '';
  let finishReason = null;
  let received = false;
  let emitted = false;

  const emit = (text) => {
    if (!text) return;
    emitted = true;
    onText(text);
  };

  try {
    const stream = await getClient(settings).chat.completions.create({
      model,
      messages,
      tools: toolDefinitions,
      temperature: 0.4,
      stream: true,
    });

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      received = true;

      const delta = choice.delta || {};

      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        emit(cleaner.push(delta.content));
      }

      // Tool calls arrive in pieces, so assemble them by index
      for (const part of delta.tool_calls || []) {
        const index = part.index ?? 0;
        const call = (toolCalls[index] ||= {
          id: '',
          type: 'function',
          function: { name: '', arguments: '' },
        });
        if (part.id) call.id = part.id;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments) call.function.arguments += part.function.arguments;
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    emit(cleaner.flush());

    if (!received) {
      const error = new Error(`Model "${model}" returned an empty response.`);
      error.code = 'MODEL_EMPTY_RESPONSE';
      throw error;
    }

    // Throw error in case of truncated tool calls or replies
    const calls = toolCalls.filter(Boolean);
    console.log('[capri:round]', JSON.stringify({
      model,
      content,
      tools: calls.map((call) => call.function.name),
      finishReason,
    }));
    if (finishReason === 'length' && (calls.length || !emitted)) {
      const error = new Error(`Model "${model}" reached its output token limit.`);
      error.code = 'MODEL_OUTPUT_LIMIT';
      throw error;
    }

    const message = { role: 'assistant', content };
    if (calls.length) message.tool_calls = calls;
    return message;
  } catch (error) {
    error.partialEmitted = emitted;
    throw error;
  }
}

// Create a response from text models
async function createCompletion(settings, messages, onText = () => {}) {
  const models = getTextModels(settings);
  let lastError;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const model = models[modelIndex];

    for (let attempt = 0; ; attempt++) {
      try {
        return await streamCompletion(settings, model, messages, onText);
      } catch (error) {
        // Once text has been shown or spoken, retrying would repeat it
        const canRetry = !error.partialEmitted;

        if (canRetry && isToolCallFailure(error) && attempt < MAX_TOOL_RETRIES) {
          console.warn(
            `[capri:retry] bad tool call on ${model} (${attempt + 1}/${MAX_TOOL_RETRIES})`
          );
          continue;
        }

        if (
          canRetry &&
          modelIndex < models.length - 1 &&
          shouldFallbackToNextModel(error)
        ) {
          console.warn(
            `[capri:fallback] ${model} failed: ${error.message}. Trying ${models[modelIndex + 1]}.`
          );
          lastError = error;
          break;
        }

        throw error;
      }
    }
  }

  throw lastError || new Error('No text models are configured.');
}

// Verify Groq before the UI finishes loading
async function warmup(settings = {}) {
  // const model = getModel(settings);

  // await getClient(settings).chat.completions.create({
  //   model,
  //   messages: [
  //     { role: 'system', content: buildSystemPrompt(settings) },
  //     { role: 'user', content: 'ping' },
  //   ],
  //   max_tokens: 1,
  // });
}

// Convert the assistant's answer into audio bytes
async function textToSpeech(text, settings = {}) {
  const apiKey =
    settings.fishApiKey ||
    process.env.FISH_AUDIO_API_KEY;

  const voiceId =
    settings.fishVoiceId ||
    process.env.FISH_AUDIO_VOICE_ID?.trim() ||
    DEFAULT_TTS_VOICE;

  if (!apiKey) {
    throw new Error('Set a Fish Audio API key in Settings or .env.');
  }

  if (!voiceId) {
    throw new Error('Set a Fish Audio voice ID in Settings or .env.');
  }

  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('No text provided for speech synthesis.');
  }

  const models = getTtsModels(settings);
  let lastError;

  for (let index = 0; index < models.length; index++) {
    const model = models[index];

    try {
      const response = await fetch('https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          model,
        },
        body: JSON.stringify({
          text: text.trim(),
          reference_id: voiceId,
          format: 'mp3',
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Fish Audio error: ${response.status} - ${await response.text()}`
        );
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;

      if (index < models.length - 1) {
        console.warn(
          `[capri:fallback] TTS model ${model} failed: ${error.message}. Trying ${models[index + 1]}.`
        );
      }
    }
  }

  throw lastError;
}

// Create web socket session and stream audio
function textToSpeechStream(settings = {}, { onAudio = () => {}, onError = () => {} } = {}) {
  const apiKey = settings.fishApiKey || process.env.FISH_AUDIO_API_KEY;
  const voiceId =
    settings.fishVoiceId ||
    process.env.FISH_AUDIO_VOICE_ID?.trim() ||
    DEFAULT_TTS_VOICE;
  const models = getTtsModels(settings);

  if (!apiKey) {
    throw new Error('Set a Fish Audio API key in Settings or .env.');
  }

  // Everything sent so far
  const textChunks = [];
  let stopRequested = false;
  let audioReceived = false;
  let finished = false;
  let current = null;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  const finish = () => {
    finished = true;
    resolveDone();
  };

  // Queue frames until the socket is open
  const send = (attempt, frame) => {
    const data = encode(frame);
    if (attempt.isOpen) attempt.socket.send(data);
    else attempt.pending.push(data);
  };

  const connect = (index) => {
    const model = models[index];
    const socket = new WebSocket(FISH_WS_URL, {
      headers: { Authorization: `Bearer ${apiKey}`, model },
    });
    const attempt = {
      socket,
      isOpen: false,
      pending: [],
      failed: false,
      gotFinish: false,
    };
    current = attempt;

    // Only fall back if error before audio has started
    const fail = (error) => {
      if (finished || attempt.failed || current !== attempt) return;
      attempt.failed = true;
      socket.terminate();

      if (!audioReceived && index < models.length - 1) {
        console.warn(
          `[capri:fallback] TTS model ${model} failed: ${error.message}. Trying ${models[index + 1]}.`
        );
        connect(index + 1);
        return;
      }

      onError(error);
      finish();
    };

    socket.on('open', () => {
      attempt.isOpen = true;
      for (const data of attempt.pending.splice(0)) socket.send(data);
    });

    socket.on('message', (raw) => {
      if (current !== attempt || attempt.failed) return;

      let frame;
      try {
        frame = decode(raw);
      } catch {
        return;
      }

      if (frame.event === 'audio') {
        if (frame.audio?.length) {
          audioReceived = true;
          onAudio(frame.audio.slice());
        }
      } else if (frame.event === 'error') {
        fail(new Error(`Fish Audio error: ${frame.error}`));
      } else if (frame.event === 'finish') {
        attempt.gotFinish = true;
        socket.close();
      }
    });

    socket.on('error', fail);

    socket.on('close', () => {
      if (current !== attempt || attempt.failed || finished) return;

      if (attempt.gotFinish || audioReceived) finish();
      else fail(new Error('Fish Audio closed the connection before sending audio.'));
    });

    send(attempt, {
      event: 'start',
      request: {
        text: '',
        format: 'pcm',
        sample_rate: TTS_SAMPLE_RATE,
        latency: 'balanced',
        reference_id: voiceId,
      },
    });

    for (const text of textChunks) send(attempt, { event: 'text', text });
    if (stopRequested) send(attempt, { event: 'stop' });
  };

  connect(0);

  return {
    push(text) {
      if (!text || finished) return;
      textChunks.push(text);
      send(current, { event: 'text', text });
    },
    // No more text
    end() {
      if (finished) return;
      stopRequested = true;
      send(current, { event: 'stop' });
    },
    cancel() {
      finished = true;
      current?.socket.terminate();
      resolveDone();
    },
    done,
  };
}

// Convert user voice request into text
async function transcribe(audio, settings = {}, mimeType = 'audio/webm') {
  const mediaType = mimeType.split(';', 1)[0].trim().toLowerCase();

  const extensions = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'mp4',
  };

  const extension = extensions[mediaType];

  if (!extension) {
    throw new Error(
      `Unsupported voice recording format: ${mediaType || 'unknown'}.`
    );
  }

  const models = getVoiceModels(settings);

  for (let index = 0; index < models.length; index++) {
    const model = models[index];

    try {
      const file = await Groq.toFile(
        audio,
        `voice.${extension}`,
        { type: mediaType }
      );

      const result = await getClient(settings).audio.transcriptions.create({
        file,
        model,
        language: 'en',
        temperature: 0,
      });

      return (result.text || '').trim();
    } catch (error) {
      if (
        index < models.length - 1 &&
        shouldFallbackToNextModel(error)
      ) {
        console.warn(
          `[capri:fallback] Voice model ${model} failed: ${error.message}. Trying ${models[index + 1]}.`
        );

        continue;
      }

      throw error;
    }
  }

  throw new Error('All configured voice models failed.');
}

// Send a prompt to the model
async function ask(query, conversation = [], settings = {}, onToolUsage = () => {}, onText = () => {}) {
  const messages = [
    { role: 'system', content: buildSystemPrompt(settings) },
    ...trimHistory(conversation),
    { role: 'user', content: query },
  ];

  let round = 0;

  while (round < MAX_TOOL_ROUNDS) {
    const msg = await createCompletion(settings, messages, onText);

    // Clean the text and add the new message
    msg.content = msg.content.replace(/\s*[—–]\s*/g, ', ');
    msg.content = stripReasoning(msg.content);
    messages.push(msg);

    // No tool calls, return the message content
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { text: msg.content || '', messages: messages.slice(1) };
    }

    // Run every tool call the model requested
    for (const call of msg.tool_calls) {
      const activity = {
        id: call.id,
        label: TOOL_ACTIVITY_LABELS[call.function.name] || 'Working...',
        active: true,
      };
      onToolUsage(activity);

      let result;
      try {
        result = await executeToolCall(call, settings);
      } finally {
        onToolUsage({ ...activity, active: false });
      }

      if (!result.ok) {
        console.error(`[capri:tool] ${call.function.name} failed:`, result.error);
      }
      const content = result.ok
        ? result.result
        : getFriendlyErrorMessage(result.error);

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: typeof content === 'string' ? content : JSON.stringify(content),
      });
    }

    round++;
  }

  return {
    text: 'Got stuck, choom. Try again.',
    messages: messages.slice(1),
  };
}

module.exports = {
  ask,
  warmup,
  getConfiguration,
  getFriendlyErrorMessage,
  transcribe,
  textToSpeech,
  textToSpeechStream,
  TTS_SAMPLE_RATE,
};