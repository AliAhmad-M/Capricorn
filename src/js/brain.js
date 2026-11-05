const ollama = require('ollama').default;
const { toolDefinitions, executeToolCall, fetchUrl } = require('./tools');
const { CAPRI_SYSTEM_PROMPT } = require('./prompt');

const MODEL           = process.env.OLLAMA_MODEL || 'qwen-local';
const MAX_TOOL_ROUNDS = 5;
const MAX_HISTORY = 10;

// Ask the model a question
async function ask(query, conversation = []) {
  const history = conversation.slice(-MAX_HISTORY);

  const messages = [
    { role: 'system', content: CAPRI_SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: query }
  ];

  let round = 0;

  while (round < MAX_TOOL_ROUNDS) {
    const response = await ollama.chat({
      model: MODEL,
      messages,
      tools: toolDefinitions,
      stream: false,
      think: false,
      options: {
        num_ctx: 2048,
        temperature: 0.4
      }
    });

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

      const result = await executeToolCall(call);
      const content = result.ok ? result.result : `Error: ${result.error}`;

      messages.push({
        role: 'tool',
        content,
        tool_name: call.function.name
      });
    }

    round++;
  }

  return {
    text: "Got stuck, choom. Try again.",
    messages: messages.slice(1)
  };
}

module.exports = { ask };