const Groq = require('groq-sdk');
const { toolDefinitions, executeToolCall } = require('./tools');
const { CAPRI_SYSTEM_PROMPT } = require('./prompt');

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const MAX_TOOL_ROUNDS = 5;
const MAX_HISTORY = 10;

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
  return settings.groqModel || process.env.GROQ_MODEL || DEFAULT_MODEL;
}

function getConfiguration(settings = {}) {
  return {
    groqApiKey: settings.groqApiKey || process.env.GROQ_API_KEY || '',
    groqModel: getModel(settings),
  };
}

// Embed the user profile
function buildSystemPrompt(settings = {}) {
  const userName = typeof settings.userName === 'string' ? settings.userName.trim() : '';

  if (!userName) {
    return CAPRI_SYSTEM_PROMPT;
  }

  return `${CAPRI_SYSTEM_PROMPT}\nUSER PROFILE\n- Preferred name: ${userName}`;
}

// Trim history to the last MAX_HISTORY messages
function trimHistory(conversation) {
  const history = conversation.slice(-MAX_HISTORY);
  const firstUser = history.findIndex((message) => message.role === 'user');
  return firstUser === -1 ? [] : history.slice(firstUser);
}

// Verify Groq credentials and connectivity before the UI finishes loading.
async function warmup(settings = {}) {
  await getClient(settings).chat.completions.create({
    model: getModel(settings),
    messages: [
      { role: 'system', content: CAPRI_SYSTEM_PROMPT },
      { role: 'user', content: 'ping' },
    ],
    max_tokens: 1,
  });
}

// Ask the model a question
async function ask(query, conversation = [], settings = {}) {
  const messages = [
    { role: 'system', content: buildSystemPrompt(settings) },
    ...trimHistory(conversation),
    { role: 'user', content: query },
  ];

  let round = 0;

  while (round < MAX_TOOL_ROUNDS) {
    const response = await getClient(settings).chat.completions.create({
      model: getModel(settings),
      messages,
      tools: toolDefinitions,
      temperature: 0.4,
    });

    const msg = response.choices[0].message;
    messages.push(msg);

    // No tool calls, return the message content
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { text: msg.content || '', messages: messages.slice(1) };
    }

    // Run every tool call the model requested
    for (const call of msg.tool_calls) {
      console.log(
        `[capri:tool] ${call.function.name}(${call.function.arguments})`
      );

      const result = await executeToolCall(call, settings);
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

module.exports = { ask, warmup, getConfiguration };
