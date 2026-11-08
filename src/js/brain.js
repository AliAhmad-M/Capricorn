const Groq = require('groq-sdk');
const { toolDefinitions, executeToolCall } = require('./tools');
const { CAPRI_SYSTEM_PROMPT } = require('./prompt');

const DEFAULT_TEXT_MODELS = ['qwen/qwen3.8-27b', ];
const DEFAULT_VOICE_MODELS = ['whisper-large-v3-turbo'];
const MAX_TOOL_ROUNDS = 8;
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

function getTextModels(settings = {}) {
  const configured = normalizeModelList(settings.groqTextModels);
  if (configured.length) return configured;

  // Support older single-model settings.
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

function getVoiceModels(settings = {}) {
  const configured = normalizeModelList(settings.groqVoiceModels);
  if (configured.length) return configured;

  // Support older single-model settings.
  const legacy = normalizeModelList(settings.groqVoiceModel);
  if (legacy.length) return legacy;

  const envModels = normalizeModelList([
    ...normalizeModelList(process.env.GROQ_VOICE_MODELS),
    ...normalizeModelList(process.env.GROQ_VOICE_MODEL),
  ]);

  return envModels.length ? envModels : [...DEFAULT_VOICE_MODELS];
}

function getModel(settings = {}) {
  return getTextModels(settings)[0];
}

function getVoiceModel(settings = {}) {
  return getVoiceModels(settings)[0];
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
  const groqTextModels = getTextModels(settings);
  const groqVoiceModels = getVoiceModels(settings);

  return {
    groqApiKey: settings.groqApiKey || process.env.GROQ_API_KEY || '',
    groqTextModel: groqTextModels[0],
    groqTextModels,
    groqVoiceModel: groqVoiceModels[0],
    groqVoiceModels,
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

  // Handle token limits, context limits, unavailable models and network errors
  return /model.{0,50}(not found|unavailable|unsupported|decommissioned)|unsupported.{0,30}model|permission.{0,30}model|rate.?limit|quota|overload|capacity|(?:token|context).{0,40}(?:limit|maximum|exceed|too large|capacity|length)|(?:limit|maximum|exceed).{0,40}(?:token|context)|request.{0,20}too large|econnreset|econnrefused|enotfound|eai_again|etimedout|failed to fetch|fetch failed/.test(details);
}

// Create query and get response or error
async function createCompletion(settings, messages) {
  const models = getTextModels(settings);
  let lastError;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const model = models[modelIndex];

    for (let attempt = 0; ; attempt++) {
      try {
        const response = await getClient(settings).chat.completions.create({
          model,
          messages,
          tools: toolDefinitions,
          temperature: 0.4,
        });

        const choice = response.choices?.[0];

        if (!choice) {
          const error = new Error(`Model "${model}" returned an empty response.`);
          error.code = 'MODEL_EMPTY_RESPONSE';
          throw error;
        }

        // Truncated response error
        if (choice.finish_reason === 'length') {
          const error = new Error(
            `Model "${model}" reached its output token limit.`
          );
          error.code = 'MODEL_OUTPUT_LIMIT';
          throw error;
        }

        return response;
      } catch (error) {
        // Retry on the same model first
        if (isToolCallFailure(error) && attempt < MAX_TOOL_RETRIES) {
          console.warn(
            `[capri:retry] bad tool call on ${model} (${attempt + 1}/${MAX_TOOL_RETRIES})`
          );
          continue;
        }

        // Try the next model if needed
        if (
          modelIndex < models.length - 1 &&
          shouldFallbackToNextModel(error)
        ) {
          const nextModel = models[modelIndex + 1];

          console.warn(
            `[capri:fallback] ${model} failed: ${error.message}. Trying ${nextModel}.`
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