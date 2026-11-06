const ollama = require('ollama').default;
const { toolDefinitions, executeToolCall } = require('./tools');
const { CAPRI_SYSTEM_PROMPT } = require('./prompt');

const MODEL           = process.env.OLLAMA_MODEL || 'qwen-local';
const MAX_TOOL_ROUNDS = 5;
const MAX_HISTORY     = 10;
const KEEP_ALIVE      = '30m';

const OPTIONS = {
  num_ctx: 2048,
  temperature: 0.4,
};

// Builds the model request
function buildRequest(messages, options = {}) {
  return {
    model: MODEL,
    messages,
    tools: toolDefinitions,
    stream: false,
    think: false,
    keep_alive: KEEP_ALIVE,
    options: { ...OPTIONS, ...options },
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
  const firstUser = history.findIndex((m) => m.role === 'user');
  return firstUser === -1 ? [] : history.slice(firstUser);
}

// Load the model and process the system prompt
async function warmup() {
  await ollama.chat(
    buildRequest(
      [
        { role: 'system', content: CAPRI_SYSTEM_PROMPT },
        { role: 'user', content: 'ping' },
      ],
      { num_predict: 1 }
    )
  );
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
    const response = await ollama.chat(buildRequest(messages));

    const msg = response.message;
    messages.push(msg);

    // No tool calls, return the message content
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { text: msg.content || '', messages: messages.slice(1) };
    }

    // Run every tool call the model requested
    for (const call of msg.tool_calls) {
      console.log(
        `[capri:tool] ${call.function.name}(${JSON.stringify(call.function.arguments)})`
      );

      const result = await executeToolCall(call, settings);
      const content = result.ok ? result.result : `Error: ${result.error}`;

      messages.push({
        role: 'tool',
        content,
        tool_name: call.function.name,
      });
    }

    round++;
  }

  return {
    text: 'Got stuck, choom. Try again.',
    messages: messages.slice(1),
  };
}

module.exports = { ask, warmup };