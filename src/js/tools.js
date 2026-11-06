const cheerio = require('cheerio');

const MAX_CONTENT_CHARS = 8000;
const FETCH_TIMEOUT_MS = 30000;

// Tools exposed to the model
const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description:
        'Fetch a URL and return its readable text content. ' +
        'Use this whenever the user shares a link or you need up-to-date info from the web.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The fully-qualified URL to fetch, e.g. https://www.google.com/'
          }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_current_datetime',
      description:
        'Get the current date and time. Use for questions about today, ' +
        'tomorrow, yesterday, or the current time. Defaults to the saved timezone setting.',
      parameters: {
        type: 'object',
        properties: {
          timeZone: {
            type: 'string',
            description: 'IANA timezone, e.g. Asia/Karachi or Europe/London.'
          }
        },
        required: []
      }
    }
  }
];

// Function to fetch the URL
async function fetchUrl({ url }) {
  const res = await fetch(url, {
    headers: {
      // Avoid bot blocks
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CapriBot/1.0',
      'Accept': 'text/html,application/xhtml+xml'
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // Drop noise
  $('script, style, nav, footer, header, aside, noscript, iframe, form').remove();

  // Try to grab main content first, fall back to body
  let text = '';
  for (const sel of ['main', 'article', '.mw-parser-output', '#content', '.content']) {
    const t = $(sel).first().text().trim();
    if (t.length > 200) { text = t; break; }
  }
  if (!text) text = $('body').text();

  text = text.replace(/\s+/g, ' ').trim();

  if (text.length > MAX_CONTENT_CHARS) {
    text = text.slice(0, MAX_CONTENT_CHARS) + '\n\n[Content truncated]';
  }
  return text || '(No readable text found on this page.)';
}

// Function to get the date and time
async function getCurrentDateTime({ timeZone = 'Asia/Karachi' } = {}) {
  const now = new Date();

  const localTime = new Intl.DateTimeFormat('en-US', {
    timeZone,
    dateStyle: 'full',
    timeStyle: 'long'
  }).format(now);

  return `Current date and time: ${localTime}\nUTC: ${now.toISOString()}`;
}

const toolImplementations = {
  fetch_url: fetchUrl,
  get_current_datetime: getCurrentDateTime
};

// Executes one tool call and returns { ok, result | error }
async function executeToolCall(toolCall, settings = {}) {
  const name = toolCall.function.name;
  const rawArgs = toolCall.function.arguments;
  const parsedArgs =
    typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : rawArgs || {};
  const args = parsedArgs && typeof parsedArgs === 'object' ? parsedArgs : {};
  const fn = toolImplementations[name];
  if (!fn) return { ok: false, error: `Unknown tool: ${name}` };

  try {
    const effectiveArgs =
      name === 'get_current_datetime' && !args.timeZone
        ? { ...args, timeZone: settings.timeZone }
        : args;
    const result = await fn(effectiveArgs);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = { toolDefinitions, executeToolCall };