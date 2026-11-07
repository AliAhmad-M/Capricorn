const Groq = require('groq-sdk');
const { toolDefinitions, executeToolCall } = require('./tools');
const { CAPRI_SYSTEM_PROMPT } = require('./prompt');

const DEFAULT_TEXT_MODEL = 'qwen/qwen3.8-27b';
const DEFAULT_VOICE_MODEL = 'whisper-large-v3-turbo';
const MAX_TOOL_ROUNDS = 5;
const MAX_TOOL_RETRIES = 3;
const MAX_HISTORY = 10;
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
};

const TOOL_NAMES = toolDefinitions.map((tool) => tool.function.name);

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

function getModel(settings = {}) {
  return settings.groqTextModel || settings.groqModel ||
    process.env.GROQ_TEXT_MODEL || DEFAULT_TEXT_MODEL;
}

function getVoiceModel(settings = {}) {
  return settings.groqVoiceModel || process.env.GROQ_VOICE_MODEL || DEFAULT_VOICE_MODEL;
}

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

function getConfiguration(settings = {}) {
  return {
    groqApiKey: settings.groqApiKey || process.env.GROQ_API_KEY || '',
    groqTextModel: getModel(settings),
    groqVoiceModel: getVoiceModel(settings),
  };
}

// Persona prompt, exact tool names, and the user profile
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

// Remove reasoning that some models return inline in content
function stripReasoning(text) {
  if (typeof text !== 'string') return text;
  const end = text.lastIndexOf('</think>');
  const answer = end === -1 ? text : text.slice(end + '</think>'.length);
  return answer.replace(/<think>[\s\S]*$/i, '').trim();
}

// Trim history to the last MAX_HISTORY messages
function trimHistory(conversation) {
  const history = conversation.slice(-MAX_HISTORY);
  const firstUser = history.findIndex((message) => message.role === 'user');
  return firstUser === -1 ? [] : history.slice(firstUser);
}

// Groq rejects the request when the model names a tool that isn't in `tools`
function isToolCallFailure(error) {
  return (
    error?.status === 400 &&
    /tool_use_failed|tool call validation failed/i.test(error.message || '')
  );
}

// Sampling again usually produces a valid tool call
async function createCompletion(settings, messages) {
  const model = getModel(settings);

  for (let attempt = 0; ; attempt++) {
    try {
      return await getClient(settings).chat.completions.create({
        model,
        messages,
        tools: toolDefinitions,
        temperature: 0.4,
      });
    } catch (error) {
      if (!isToolCallFailure(error) || attempt >= MAX_TOOL_RETRIES) throw error;
      console.warn(`[capri:retry] bad tool call (${attempt + 1}/${MAX_TOOL_RETRIES})`);
    }
  }
}

// Verify Groq before the UI finishes loading, using the same prompt as real requests
async function warmup(settings = {}) {
  const model = getModel(settings);

  await getClient(settings).chat.completions.create({
    model,
    messages: [
      { role: 'system', content: buildSystemPrompt(settings) },
      { role: 'user', content: 'ping' },
    ],
    max_tokens: 1,
  });
}

async function transcribe(audio, settings = {}, mimeType = 'audio/webm') {
  const mediaType = mimeType.split(';', 1)[0].trim().toLowerCase();
  const extensions = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'mp4',
  };
  const extension = extensions[mediaType];
  if (!extension) {
    throw new Error(`Unsupported voice recording format: ${mediaType || 'unknown'}.`);
  }

  const file = await Groq.toFile(audio, `voice.${extension}`, { type: mediaType });
  const result = await getClient(settings).audio.transcriptions.create({
    file,
    model: getVoiceModel(settings),
    language: 'en',
    temperature: 0,
  });
  return (result.text || '').trim();
}

// Ask the model a question
async function ask(query, conversation = [], settings = {}, onToolUsage = () => {}) {
  const messages = [
    { role: 'system', content: buildSystemPrompt(settings) },
    ...trimHistory(conversation),
    { role: 'user', content: query },
  ];

  let round = 0;

  while (round < MAX_TOOL_ROUNDS) {
    const response = await createCompletion(settings, messages);
    const msg = response.choices[0].message;

    // Keep any inline reasoning out of the reply
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
};