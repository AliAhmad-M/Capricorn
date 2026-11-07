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

      const content = result.ok ? result.result : `Error: ${result.error}`;

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

module.exports = { ask, warmup, getConfiguration, transcribe };