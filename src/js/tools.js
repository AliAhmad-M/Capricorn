const cheerio = require('cheerio');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MAX_CONTENT_CHARS = 6000;
const FETCH_TIMEOUT_MS = 30000;
const MAX_SCAN_DEPTH = 15;

// All tools that Capri can use
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
            description: 'The fully-qualified URL to fetch.'
          }
        },
        required: ['url']
      }
    }
  },
    {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web and return the top results (title, URL, snippet). ' +
        'Use if the user asks you about current events or something you are unsure of',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Short search query, 2 to 6 words.' }
        },
        required: ['query']
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
  },
  {
    type: 'function',
    function: {
      name: 'list_games',
      description:
        'List executable files that may launch games across configured game folders and directly configured executables. ' +
        'Searches recursively. Results may include non-game executables.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'launch_game',
      description:
        'Launch a game by name using an executable found in configured game folders or directly configured executables. ' +
        'Matches against executable names, custom nicknames, and game folder names. ' +
        'If multiple executables match, ask the user to clarify.',
      parameters: {
        type: 'object',
        properties: {
          game: {
            type: 'string',
            description: 'Name of the game to launch, or something similar to the name or folder'
          }
        },
        required: ['game']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_software',
      description:
        'List executable files found inside configured software folders and directly configured executables. ' +
        'Use this to check whether a software app is available to launch.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'launch_software',
      description:
        'Launch a software application by name using executables inside configured software folders or directly configured executables. ' +
        'Matches executable names and custom nicknames. If multiple executables match, ask the user to clarify.',
      parameters: {
        type: 'object',
        properties: {
          software: {
            type: 'string',
            description: 'Name of the software to launch.'
          }
        },
        required: ['software']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_system_usage',
      description:
        'Check current CPU, RAM, GPU, disk, and battery usage. ' +
        'Report unavailable metrics clearly instead of guessing.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_resource_processes',
      description:
        'Find running processes using the most CPU or memory. ' +
        'CPU usage is measured over a short sample; memory is the current working set.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            description: 'Maximum number of processes in each list, from 1 to 20.'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_network_connectivity',
      description:
        'Check whether the computer can reach the internet and list active network interfaces.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
    {
    type: 'function',
    function: {
      name: 'get_current_directory',
      description:
        'Show the folder that file tools currently work in. ' +
        'Relative paths are resolved from here.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'change_directory',
      description:
        'Change the current working directory, like cd. ' +
        'Accepts absolute paths, paths relative to the current directory, "..", "~", ' +
        'or names like downloads, desktop, documents, pictures, music, videos.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Folder to move into.'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description:
        'List the files and folders inside a folder, like dir. ' +
        'Use this when the user asks what is in a folder. ' +
        'Does not change the current directory. ' +
        'Accepts absolute paths, paths relative to the current directory, "..", "~", ' +
        'or names like downloads, desktop, documents, pictures, music, videos.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Folder to list. Defaults to the current directory.'
          },
          showHidden: {
            type: 'boolean',
            description: 'Include hidden files that start with a dot.'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_files',
      description:
        'Search for files or folders by name, searching subfolders too. ' +
        'All words in the query must appear in the name.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Part of the file name, e.g. "resume pdf" or ".png".'
          },
          path: {
            type: 'string',
            description: 'Folder to search from. Defaults to the current directory.'
          },
          type: {
            type: 'string',
            enum: ['any', 'file', 'folder'],
            description: 'Limit results to files or folders.'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_text_file',
      description:
        'Read a plain text file (notes, code, logs, config). ' +
        'Fails on binary files such as images or executables.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File to read.'
          },
          maxChars: {
            type: 'integer',
            description: 'Maximum characters to return, up to 20000.'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_text_file',
      description:
        'Create or edit a text file. Existing files are not replaced unless overwrite is true, ' +
        'and overwrite must only be set after the user has agreed to replace the file.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File to write.'
          },
          content: {
            type: 'string',
            description: 'Text to write.'
          },
          append: {
            type: 'boolean',
            description: 'Add to the end of the file instead of replacing it.'
          },
          overwrite: {
            type: 'boolean',
            description: 'Replace an existing file. Only after the user agreed.'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_directory',
      description:
        'Create a new folder, including any missing parent folders.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Folder to create.'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'copy_item',
      description:
        'Copy a file or folder. ' +
        'If the destination is an existing folder, the copy goes inside it.',
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'File or folder to copy.'
          },
          destination: {
            type: 'string',
            description: 'Target path or folder.'
          },
          overwrite: {
            type: 'boolean',
            description: 'Replace an existing item. Only after the user agreed.'
          }
        },
        required: ['source', 'destination']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'move_item',
      description:
        'Move or rename a file or folder. ' +
        'If the destination is an existing folder, the item goes inside it.',
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'File or folder to move.'
          },
          destination: {
            type: 'string',
            description: 'New path, new name, or target folder.'
          },
          overwrite: {
            type: 'boolean',
            description: 'Replace an existing item. Only after the user agreed.'
          }
        },
        required: ['source', 'destination']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_item',
      description:
        'Send a file or folder to the Recycle Bin. ' +
        'Always ask the user to confirm first, and only set confirmed to true ' +
        'once they have said yes to this exact deletion.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File or folder to delete.'
          },
          confirmed: {
            type: 'boolean',
            description: 'True only after the user explicitly confirmed this deletion.'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_path',
      description:
        'Open a file or folder with its default app, like double clicking it in Explorer.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File or folder to open.'
          }
        },
        required: ['path']
      }
    }
  }
];

// Normalize strings
function normalizeText(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Fetch readable text from pages
async function fetchUrl({ url }) {
  const parsedUrl = new URL(url);

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CapriBot/1.0',
      Accept: 'text/html,application/xhtml+xml'
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, nav, footer, header, aside, noscript, iframe, form').remove();

  let text = '';

  // Prefer the main/article content, otherwise fall back to body text
  for (const selector of [
    'main',
    'article',
    '.mw-parser-output',
    '#content',
    '.content'
  ]) {
    const content = $(selector).first().text().trim();

    if (content.length > 200) {
      text = content;
      break;
    }
  }

  if (!text) text = $('body').text();

  text = text.replace(/\s+/g, ' ').trim();

  if (text.length > MAX_CONTENT_CHARS) {
    text = text.slice(0, MAX_CONTENT_CHARS) + '\n\n[Content truncated]';
  }

  return text || '(No readable text found on this page.)';
}

// Return the current date and time in the requested timezone
async function getCurrentDateTime({ timeZone = 'Asia/Karachi' } = {}) {
  const now = new Date();

  const localTime = new Intl.DateTimeFormat('en-US', {
    timeZone,
    dateStyle: 'full',
    timeStyle: 'long'
  }).format(now);

  return `Current date and time: ${localTime}\nUTC: ${now.toISOString()}`;
}

// Skip folders that rarely contain games
const IGNORED_DIRECTORIES = new Set([
  '$recycle.bin',
  'system volume information',
  'redist',
  'redistributables',
  'prerequisites',
  'support',
  'easyanticheat',
  'battleye',
  'crashreports',
  'logs',
  '.git',
  'node_modules'
]);

const IGNORED_EXECUTABLES =
  /^(unins.*|uninstall.*|setup|installer|vc_redist.*|dxsetup).*\.exe$/i;

// Recursively find executable files
async function discoverExecutables(rootPaths = [], executableNicknames = {}) {
  const executables = [];
  const visitedDirectories = new Set();
  const visitedFiles = new Set();

  function addExecutable(executablePath, rootDirectory, relativeFolder) {
    const fileKey = executablePath.toLowerCase();
    if (visitedFiles.has(fileKey)) return;
    visitedFiles.add(fileKey);

    executables.push({
      name: path.basename(executablePath, path.extname(executablePath)),
      nickname: executableNicknames[executablePath] || '',
      path: executablePath,
      directory: path.dirname(executablePath),
      rootFolder: path.basename(rootDirectory),
      relativeFolder
    });
  }

  async function scanDirectory(directory, rootDirectory, depth = 0) {
    if (depth > MAX_SCAN_DEPTH) return;

    let resolved;

    try {
      resolved = await fs.realpath(directory);

      const stats = await fs.stat(resolved);
      if (!stats.isDirectory()) return;
    } catch {
      return;
    }

    // Prevent duplicate scans and directory loops
    const directoryKey = resolved.toLowerCase();

    if (visitedDirectories.has(directoryKey)) return;
    visitedDirectories.add(directoryKey);

    let entries;

    try {
      entries = await fs.readdir(resolved, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('$')) continue;

      const fullPath = path.join(resolved, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) continue;

        await scanDirectory(fullPath, rootDirectory, depth + 1);
        continue;
      }

      if (
        !entry.isFile() ||
        path.extname(entry.name).toLowerCase() !== '.exe' ||
        IGNORED_EXECUTABLES.test(entry.name)
      ) {
        continue;
      }

      const dirName = path.dirname(fullPath);
      addExecutable(fullPath, rootDirectory, path.relative(rootDirectory, dirName));
    }
  }

  for (const configuredPath of rootPaths) {
    if (typeof configuredPath === 'string' && configuredPath.trim()) {
      try {
        const resolvedPath = await fs.realpath(configuredPath.trim());
        const stats = await fs.stat(resolvedPath);

        if (stats.isDirectory()) {
          await scanDirectory(resolvedPath, resolvedPath);
        } else if (
          stats.isFile() &&
          path.extname(resolvedPath).toLowerCase() === '.exe' &&
          !IGNORED_EXECUTABLES.test(path.basename(resolvedPath))
        ) {
          const executableName = path.basename(
            resolvedPath,
            path.extname(resolvedPath)
          );
          addExecutable(
            resolvedPath,
            path.join(path.dirname(resolvedPath), executableName),
            ''
          );
        }
      } catch {
        // Skip invalid or inaccessible configured paths.
      }
    }
  }

  return executables;
}

// List discovered games
async function listGames({
  gamePaths = [],
  gameExecutableNicknames = {}
} = {}) {
  const executables = await discoverExecutables(
    gamePaths,
    gameExecutableNicknames
  );

  if (gamePaths.length === 0) {
    return 'No game folders or executables configured. Add paths in Settings.';
  }

  if (executables.length === 0) {
    return 'No executable files found in the configured game paths.';
  }

  executables.sort((a, b) => a.name.localeCompare(b.name));

  return [
    `Found ${executables.length} executable files that may launch games:`,
    ...executables.map(
      (entry, index) =>
        `${index + 1}. ${formatExecutableName(entry)} — ${entry.path}`
    )
  ].join('\n');
}

// Launch a matching executable
async function launchGame({
  game,
  gamePaths = [],
  gameExecutableNicknames = {}
}) {
  if (typeof game !== 'string' || !game.trim()) {
    throw new Error('A game name is required.');
  }

  if (gamePaths.length === 0) {
    return 'No game folders or executables configured. Add paths in Settings.';
  }

  const executables = await discoverExecutables(
    gamePaths,
    gameExecutableNicknames
  );
  const matches = findExecutables(executables, game, (entry) =>
    ({
      exact: entry.relativeFolder.split(path.sep),
      partial: entry.relativeFolder
    })
  );
  return startExecutable(matches, game);
}

// List discovered softwares
async function listSoftware({
  softwarePaths = [],
  softwareExecutableNicknames = {}
} = {}) {
  const executables = await discoverExecutables(
    softwarePaths,
    softwareExecutableNicknames
  );

  if (softwarePaths.length === 0) {
    return 'No software folders or executables configured. Add paths in Settings.';
  }

  if (executables.length === 0) {
    return 'No executable files found in the configured software paths.';
  }

  executables.sort((a, b) =>
    a.rootFolder.localeCompare(b.rootFolder) || a.name.localeCompare(b.name)
  );

  return [
    `Found ${executables.length} executable files in configured software folders:`,
    ...executables.map(
      (entry, index) =>
        `${index + 1}. ${entry.rootFolder}: ${formatExecutableName(entry)} — ${entry.path}`
    )
  ].join('\n');
}

// Launch a software
async function launchSoftware({
  software,
  softwarePaths = [],
  softwareExecutableNicknames = {}
}) {
  if (typeof software !== 'string' || !software.trim()) {
    throw new Error('A software name is required.');
  }

  if (softwarePaths.length === 0) {
    return 'No software folders or executables configured. Add paths in Settings.';
  }

  const executables = await discoverExecutables(
    softwarePaths,
    softwareExecutableNicknames
  );
  const matches = findExecutables(executables, software, (entry) => ({
    exact: [entry.rootFolder, ...entry.relativeFolder.split(path.sep)],
    partial: `${entry.rootFolder}${entry.relativeFolder}`
  }));
  return startExecutable(matches, software);
}

// Find executable apps
function findExecutables(executables, requestedName, getFolderNames) {
  const search = normalizeText(requestedName);
  if (!search) return [];

  let matches = executables.filter(
    (entry) => normalizeText(entry.nickname) === search
  );

  if (matches.length === 0) {
    matches = executables.filter(
      (entry) => normalizeText(entry.nickname).includes(search)
    );
  }

  if (matches.length === 0) {
    matches = executables.filter(
      (entry) => normalizeText(entry.name) === search
    );
  }

  if (matches.length === 0) {
    matches = executables.filter(
      (entry) => normalizeText(entry.name).includes(search)
    );
  }

  if (matches.length === 0) {
    matches = executables.filter((entry) =>
      getFolderNames(entry).exact.some((folder) => normalizeText(folder) === search)
    );
  }

  if (matches.length === 0) {
    matches = executables.filter((entry) =>
      normalizeText(getFolderNames(entry).partial).includes(search)
    );
  }

  return matches;
}

// Handle nicknames
function formatExecutableName(entry) {
  return entry.nickname
    ? `${entry.nickname} (${entry.name})`
    : entry.name;
}

// Start an executable app
async function startExecutable(matches, requestedName) {
  if (matches.length === 0) {
    return `No executable matching "${requestedName}" was found.`;
  }

  if (matches.length > 1) {
    return [
      'Multiple executables matched. Ask the user to choose one:',
      ...matches.slice(0, 20).map(
        (entry) => `${entry.name} — ${entry.path}`
      )
    ].join('\n');
  }

  const selected = matches[0];

  await new Promise((resolve, reject) => {
    const child = spawn(selected.path, [], {
      cwd: selected.directory,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      shell: false
    });

    child.once('error', reject);

    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });

  return `Started ${selected.name} from ${selected.path}.`;
}

// Web search parameters
const MAX_SEARCH_RESULTS = 5;
const MAX_SNIPPET_CHARS = 200;
const clip = (text, max) =>
  text.length > max ? `${text.slice(0, max).trim()}...` : text;

// Unwrap DuckDuckGo links
function unwrapDuckDuckGoUrl(href) {
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    return url.searchParams.get('uddg') || url.href;
  } catch {
    return href;
  }
}

// Search the web using DuckDuckGo
async function searchDuckDuckGo(query) {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://html.duckduckgo.com/'
    },
    body: new URLSearchParams({
      q: query,
      b: '',
      kl: 'wt-wt'
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });

  if (res.status === 202) {
    throw new Error('Search Failed: DuckDuckGo returned a bot challenge.');
  }
  if (!res.ok) throw new Error(`Search Failed: HTTP ${res.status}`);

  const $ = cheerio.load(await res.text());
  const results = [];

  $('.result').each((_, el) => {
    const link = $(el).find('a.result__a').first();
    const href = link.attr('href');
    if (!href || href.includes('/y.js')) return; // skip ads

    results.push({
      title: link.text().trim(),
      url: unwrapDuckDuckGoUrl(href),
      snippet: $(el).find('.result__snippet').text().trim()
    });

    if (results.length >= MAX_SEARCH_RESULTS) return false;
  });

  return results;
}

// Search the web using Brave
async function searchBrave(query, apiKey) {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(MAX_SEARCH_RESULTS));

  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });

  if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);

  const data = await res.json();
  return (data.web?.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url,
    snippet: String(r.description ?? '').replace(/<[^>]+>/g, '')
  }));
}

// Search the web, prefer Brave, fallback to DuckDuckGo
async function webSearch({ query, apiKey: configuredApiKey }) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('A search query is required.');
  }

  const q = query.trim().slice(0, 200);
  const apiKey = configuredApiKey || process.env.BRAVE_API_KEY;
  const results = apiKey
    ? await searchBrave(q, apiKey)
    : await searchDuckDuckGo(q);

  if (results.length === 0) {
    throw new Error(`Search Failed: No results for "${q}". The search provider may be blocking requests.`);
  }

  return results
    .slice(0, MAX_SEARCH_RESULTS)
    .map((r, i) =>
      `${i + 1}. ${clip(r.title, 80)}\n${r.url}\n${clip(r.snippet, MAX_SNIPPET_CHARS)}`
    )
    .join('\n\n');
}

// Get the CPU usage of the PC
function sampleCpuUsage() {
  return os.cpus().reduce(
    (total, cpu) => {
      const times = cpu.times;
      total.idle += times.idle;
      total.total += times.user + times.nice + times.sys + times.idle + times.irq;
      return total;
    },
    { idle: 0, total: 0 }
  );
}
async function getCpuUsage() {
  const before = sampleCpuUsage();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const after = sampleCpuUsage();
  const total = after.total - before.total;
  const idle = after.idle - before.idle;

  if (total <= 0) {
    throw new Error('CPU usage could not be sampled.');
  }

  return Math.round(((total - idle) / total) * 1000) / 10;
}

// Run a powershell command
function runPowerShell(script, timeoutMs = 15000) {
  if (process.platform !== 'win32') {
    throw new Error('System monitoring through PowerShell is only available on Windows.');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true }
    );
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not start PowerShell: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        reject(new Error('System monitoring timed out while querying Windows.'));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Windows system query failed: ${stderr.trim() || `PowerShell exited with code ${code}.`}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error(`Windows system query returned invalid data: ${stderr.trim() || stdout.trim()}`));
      }
    });
  });
}

// Get all system usage data
async function getSystemUsage() {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$gpuAdapters = @(Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion)',
    '$gpuCounterError = $null',
    'try {',
    '  $gpuEngines = @(Get-CimInstance -Namespace root/cimv2 -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Where-Object { $_.UtilizationPercentage -gt 0 } | Sort-Object UtilizationPercentage -Descending | Select-Object -First 12 Name, UtilizationPercentage)',
    '} catch {',
    '  $gpuEngines = @()',
    '  $gpuCounterError = $_.Exception.Message',
    '}',
    '$disks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, VolumeName, Size, FreeSpace)',
    '$batteries = @(Get-CimInstance Win32_Battery | Select-Object Name, EstimatedChargeRemaining, BatteryStatus)',
    '[PSCustomObject]@{ gpuAdapters = $gpuAdapters; gpuEngines = $gpuEngines; gpuCounterError = $gpuCounterError; disks = $disks; batteries = $batteries } | ConvertTo-Json -Depth 5 -Compress'
  ].join('; ');
  const [cpuPercent, windowsData] = await Promise.all([
    getCpuUsage(),
    runPowerShell(script)
  ]);
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();

  return JSON.stringify({
    cpu: { usagePercent: cpuPercent, logicalProcessors: os.cpus().length },
    memory: {
      totalGB: Math.round((totalMemory / 1024 ** 3) * 10) / 10,
      usedGB: Math.round(((totalMemory - freeMemory) / 1024 ** 3) * 10) / 10,
      usagePercent: Math.round(((totalMemory - freeMemory) / totalMemory) * 1000) / 10
    },
    gpu: {
      adapters: Array.isArray(windowsData.gpuAdapters)
        ? windowsData.gpuAdapters
        : windowsData.gpuAdapters ? [windowsData.gpuAdapters] : [],
      activeEngines: (Array.isArray(windowsData.gpuEngines)
        ? windowsData.gpuEngines
        : windowsData.gpuEngines ? [windowsData.gpuEngines] : []
      ).map((engine) => {
        const name = engine.Name || '';
        const processId = name.match(/(?:^|_)pid_(\d+)(?:_|$)/);
        const engineType = name.match(/(?:^|_)engtype_(.+)$/);

        return {
          processId: processId ? Number(processId[1]) : undefined,
          engineType: engineType ? engineType[1] : name,
          utilizationPercent: engine.UtilizationPercentage
        };
      }),
      utilizationNote: windowsData.gpuCounterError
        ? `GPU utilization counters unavailable: ${windowsData.gpuCounterError}`
        : 'GPU usage is reported per engine. Percentages may total over 100%; processId identifies the owning process when available.'
    },
    disks: (Array.isArray(windowsData.disks)
      ? windowsData.disks
      : windowsData.disks ? [windowsData.disks] : []
    ).map((disk) => ({
      drive: disk.DeviceID,
      label: disk.VolumeName,
      totalGB: Math.round((disk.Size / 1024 ** 3) * 10) / 10,
      freeGB: Math.round((disk.FreeSpace / 1024 ** 3) * 10) / 10,
      usagePercent: Math.round(((disk.Size - disk.FreeSpace) / disk.Size) * 1000) / 10
    })),
    batteries: (Array.isArray(windowsData.batteries)
      ? windowsData.batteries
      : windowsData.batteries ? [windowsData.batteries] : []
    ).map((battery) => ({
      name: battery.Name,
      chargePercent: battery.EstimatedChargeRemaining,
      statusCode: battery.BatteryStatus,
      status: ({
        0: 'Unknown',
        1: 'Discharging',
        2: 'Connected to AC',
        3: 'Fully charged',
        4: 'Low',
        5: 'Critical',
        6: 'Charging',
        7: 'Charging (high)',
        8: 'Charging (low)',
        9: 'Charging (critical)',
        10: 'Undefined',
        11: 'Partially charged'
      })[battery.BatteryStatus] || 'Unknown'
    })),
    batteryNote: windowsData.batteries && windowsData.batteries.length === 0
      ? 'No battery detected.'
      : undefined
  }, null, 2);
}

// List top 10 most resource heavy processes
async function listResourceProcesses({ limit = 10 } = {}) {
  const boundedLimit = Number.isInteger(limit) ? Math.min(20, Math.max(1, limit)) : 10;
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$limit = ${boundedLimit}`,
    '$processorCount = [Environment]::ProcessorCount',
    '$before = @{}',
    'Get-Process | ForEach-Object { if ($null -ne $_.CPU) { $before[$_.Id] = [double]$_.CPU } }',
    '$timer = [Diagnostics.Stopwatch]::StartNew()',
    'Start-Sleep -Milliseconds 1000',
    '$timer.Stop()',
    '$elapsedSeconds = [Math]::Max($timer.Elapsed.TotalSeconds, 0.001)',
    '$all = @(Get-Process | ForEach-Object {',
    '  $cpuPercent = 0.0',
    '  if ($before.ContainsKey($_.Id) -and $null -ne $_.CPU) { $cpuPercent = [Math]::Max(0, (([double]$_.CPU - $before[$_.Id]) / $elapsedSeconds / $processorCount) * 100) }',
    '  [PSCustomObject]@{ name = $_.ProcessName; pid = $_.Id; cpuPercent = [Math]::Round($cpuPercent, 1); memoryMB = [Math]::Round($_.WorkingSet64 / 1MB, 1) }',
    '})',
    '[PSCustomObject]@{ processCount = $all.Count; sampleSeconds = [Math]::Round($elapsedSeconds, 2); topCpu = @($all | Sort-Object cpuPercent -Descending | Select-Object -First $limit); topMemory = @($all | Sort-Object memoryMB -Descending | Select-Object -First $limit) } | ConvertTo-Json -Depth 5 -Compress'
  ].join('; ');
  return JSON.stringify(await runPowerShell(script, 20000), null, 2);
}

// Check for network connectivity
async function checkNetworkConnectivity() {
  const interfaces = Object.entries(os.networkInterfaces())
    .flatMap(([name, addresses]) =>
      (addresses || [])
        .filter((address) => !address.internal)
        .map((address) => ({ name, address: address.address, family: address.family }))
    );
  const startedAt = Date.now();

  try {
    const response = await fetch('https://www.google.com/generate_204', {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    });
    return JSON.stringify({
      internetConnected: response.ok,
      statusCode: response.status,
      latencyMs: Date.now() - startedAt,
      interfaces
    }, null, 2);
  } catch (error) {
    console.error('Network connectivity check failed:', error);
    return JSON.stringify({
      internetConnected: false,
      error: error.name === 'TimeoutError'
        ? 'Timed out while checking internet access.'
        : 'Could not reach the connectivity check service.',
      interfaces
    }, null, 2);
  }
}

// File management properties
const MAX_LIST_ENTRIES = 100;
const MAX_FIND_RESULTS = 30;
const MAX_FIND_DEPTH = 8;
const FIND_TIMEOUT_MS = 10000;
const MAX_READ_BYTES = 1024 * 1024;
const DEFAULT_READ_CHARS = 6000;
const MAX_READ_CHARS = 20000;
const MAX_WRITE_CHARS = 200000;

const KNOWN_FOLDERS = ['desktop', 'documents', 'downloads', 'music', 'pictures', 'videos'];
const HIDDEN_NAMES = /^(desktop\.ini|thumbs\.db)$/i;
const SEARCH_IGNORED = new Set([
  '$recycle.bin',
  'system volume information',
  '.git',
  'node_modules',
  'appdata',
  'windows',
  'program files',
  'program files (x86)'
]);

class UserError extends Error {}

const ERROR_MESSAGES = {
  ENOENT: 'That path does not exist.',
  EACCES: 'Permission denied.',
  EPERM: 'Permission denied. The item may be in use or protected.',
  EBUSY: 'The item is in use by another program.',
  ENOTEMPTY: 'That folder is not empty.',
  EEXIST: 'Something with that name already exists.',
  EISDIR: 'That is a folder, not a file.',
  ENOTDIR: 'Part of that path is not a folder.'
};

// Simplify a file error message
function describeError(error) {
  if (error instanceof UserError) return `Error: ${error.message}`;
  return `Error: ${ERROR_MESSAGES[error?.code] || error?.message || 'Unknown file error.'}`;
}

// Tools return their errors as text
function guarded(fn) {
  return async (args) => {
    try {
      return await fn(args || {});
    } catch (error) {
      return describeError(error);
    }
  };
}

// Get an instance of electron
function getElectron() {
  try {
    const electron = require('electron');
    return typeof electron === 'object' ? electron : null;
  } catch {
    return null;
  }
}

// Get confirmation to run tool
async function confirmAction(message, detail) {
  const dialog = getElectron()?.dialog;
  if (!dialog) {
    throw new UserError('Could not ask for confirmation, so nothing was changed.');
  }

  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Allow', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Capricorn',
    message,
    detail
  });

  if (response !== 0) {
    throw new UserError('The user declined, so nothing was changed.');
  }
}

// Get a folder from known path
function getKnownFolder(name) {
  try {
    const app = getElectron()?.app;
    if (app?.getPath) return app.getPath(name);
  } catch {
    // Fall through to the default location
  }
  return path.join(os.homedir(), name[0].toUpperCase() + name.slice(1));
}

// Check if target file/directory exists
async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

// Check if the target is a directory
async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

// Working directory
let currentDirectory = null;
let lastStartDirectory = null;
async function getCurrentDirectory(startDirectory = '') {
  const start = String(startDirectory || '').trim() || os.homedir();

  if (
    currentDirectory === null ||
    start !== lastStartDirectory ||
    !(await isDirectory(currentDirectory))
  ) {
    lastStartDirectory = start;
    currentDirectory = (await isDirectory(start)) ? start : os.homedir();
  }

  return currentDirectory;
}

// Turn model response into an absolute path
async function resolvePath(input, cwd) {
  let target = String(input ?? '').trim().replace(/^["']+|["']+$/g, '');

  if (!target || target === '.') return cwd;
  if (/^[a-z]:$/i.test(target)) target += path.sep;
  if (target === '~' || /^~[\\/]/.test(target)) {
    return path.join(os.homedir(), target.slice(1));
  }
  if (path.isAbsolute(target)) return path.normalize(target);

  // Prefer real folder over well known alias
  const direct = path.resolve(cwd, target);
  if (await exists(direct)) return direct;

  const [first, ...rest] = target.split(/[\\/]+/);
  const key = first.toLowerCase();

  if (KNOWN_FOLDERS.includes(key)) {
    return path.join(getKnownFolder(key), ...rest);
  }
  if (key === 'home') return path.join(os.homedir(), ...rest);

  return direct;
}

// Return list of system folders
function systemFolders() {
  return [
    process.env.SystemRoot,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData
  ].filter(Boolean).map((folder) => path.resolve(folder).toLowerCase());
}

// Nothing may be changed inside these
function assertNotSystemPath(target) {
  const lower = path.resolve(target).toLowerCase();
  if (systemFolders().some((folder) => lower === folder || lower.startsWith(folder + path.sep))) {
    throw new UserError(`Refusing to modify a system location: ${target}`);
  }
}

// Top-level folders can't be deleted or moved as a whole
function assertNotProtectedRoot(target) {
  const resolved = path.resolve(target);
  const lower = resolved.toLowerCase();
  const protectedPaths = new Set([
    path.parse(resolved).root.toLowerCase(),
    os.homedir().toLowerCase(),
    ...KNOWN_FOLDERS.map((name) => path.resolve(getKnownFolder(name)).toLowerCase())
  ]);

  if (protectedPaths.has(lower)) {
    throw new UserError(`Refusing to delete or move a top-level folder: ${target}`);
  }
}

// Recursive directory walker used by find_files
async function walkDirectory(root, {
  maxDepth = MAX_SCAN_DEPTH,
  visited = new Set(),
  isIgnoredDir = () => false,
  shouldStop = () => false,
  onDirectory,
  onFile
} = {}) {
  async function visit(directory, depth) {
    if (depth > maxDepth || shouldStop()) return;

    let resolved;
    try {
      resolved = await fs.realpath(directory);
      if (!(await fs.stat(resolved)).isDirectory()) return;
    } catch {
      return;
    }

    // Prevent duplicate scans and loops
    const key = resolved.toLowerCase();
    if (visited.has(key)) return;
    visited.add(key);

    let entries;
    try {
      entries = await fs.readdir(resolved, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (shouldStop()) return;
      if (entry.name.startsWith('$')) continue;

      const fullPath = path.join(resolved, entry.name);

      if (entry.isDirectory()) {
        if (isIgnoredDir(entry.name)) continue;
        await onDirectory?.(fullPath, depth);
        await visit(fullPath, depth + 1);
      } else if (entry.isFile()) {
        await onFile?.(fullPath, entry, depth);
      }
    }
  }

  await visit(root, 0);
}

// Format size from bytes into KB, GB, etc.
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

const formatDate = (date) => date.toISOString().slice(0, 10);

// Return the current directory
async function getCurrentDirectoryTool({ startDirectory }) {
  return `Current directory: ${await getCurrentDirectory(startDirectory)}`;
}

// CHange the current directory
async function changeDirectory({ path: requested, startDirectory }) {
  const cwd = await getCurrentDirectory(startDirectory);
  const target = await resolvePath(requested, cwd);

  if (!(await isDirectory(target))) {
    throw new UserError(`"${requested}" is not a folder. Looked for ${target}`);
  }

  try {
    currentDirectory = await fs.realpath(target);
  } catch {
    currentDirectory = target;
  }

  return `Now in ${currentDirectory}`;
}

// List all sub directories and files
async function listDirectory({ path: requested, showHidden = false, startDirectory }) {
  const cwd = await getCurrentDirectory(startDirectory);
  const target = await resolvePath(requested, cwd);

  if (!(await isDirectory(target))) {
    throw new UserError(`"${requested}" is not a folder. Looked for ${target}`);
  }

  const entries = await fs.readdir(target, { withFileTypes: true });
  const rows = (await Promise.all(entries.map(async (entry) => {
    if (!showHidden && (entry.name.startsWith('.') || HIDDEN_NAMES.test(entry.name))) {
      return null;
    }

    let stats = null;
    try {
      stats = await fs.stat(path.join(target, entry.name));
    } catch {
      // Broken links and locked files do not display stats
    }

    return {
      name: entry.name,
      isDirectory: stats ? stats.isDirectory() : entry.isDirectory(),
      size: stats?.size ?? 0,
      modified: stats?.mtime
    };
  }))).filter(Boolean);

  rows.sort((a, b) =>
    Number(b.isDirectory) - Number(a.isDirectory) ||
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  );

  const folderCount = rows.filter((row) => row.isDirectory).length;
  const lines = rows.slice(0, MAX_LIST_ENTRIES).map((row) =>
    row.isDirectory
      ? `[folder] ${row.name}`
      : `[file] ${row.name} (${formatSize(row.size)}${row.modified ? `, ${formatDate(row.modified)}` : ''})`
  );

  if (rows.length === 0) return `${target} is empty.`;

  const header =
    `Contents of ${target} (${folderCount} folders, ${rows.length - folderCount} files):`;
  const footer = rows.length > MAX_LIST_ENTRIES
    ? [`...and ${rows.length - MAX_LIST_ENTRIES} more. Use find_files to narrow it down.`]
    : [];

  return [header, ...lines, ...footer].join('\n');
}

// Run a file search query
async function findFiles({ query, path: searchPath, type = 'any', startDirectory }) {
  const words = String(query ?? '')
    .toLowerCase()
    .replace(/\*/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) throw new UserError('A search query is required.');

  const cwd = await getCurrentDirectory(startDirectory);
  const root = await resolvePath(searchPath, cwd);

  if (!(await isDirectory(root))) {
    throw new UserError(`"${searchPath}" is not a folder. Looked for ${root}`);
  }

  const results = [];
  const deadline = Date.now() + FIND_TIMEOUT_MS;
  let timedOut = false;

  const check = (fullPath, isDir) => {
    if (results.length >= MAX_FIND_RESULTS) return;

    const name = path.basename(fullPath).toLowerCase();
    if (words.every((word) => name.includes(word))) {
      results.push(`${isDir ? '[folder]' : '[file]'} ${fullPath}`);
    }
  };

  await walkDirectory(root, {
    maxDepth: MAX_FIND_DEPTH,
    isIgnoredDir: (name) => SEARCH_IGNORED.has(name.toLowerCase()),
    shouldStop: () => {
      if (Date.now() > deadline) {
        timedOut = true;
        return true;
      }
      return results.length >= MAX_FIND_RESULTS;
    },
    onDirectory: (fullPath) => {
      if (type !== 'file') check(fullPath, true);
    },
    onFile: (fullPath) => {
      if (type !== 'folder') check(fullPath, false);
    }
  });

  if (results.length === 0) {
    return `No matches for "${query}" under ${root}${timedOut ? ' (search timed out)' : ''}.`;
  }

  const notes = [];
  if (results.length >= MAX_FIND_RESULTS) notes.push(`Stopped at ${MAX_FIND_RESULTS} results.`);
  if (timedOut) notes.push('Search timed out, so results may be incomplete.');

  return [`Matches for "${query}" under ${root}:`, ...results, ...notes].join('\n');
}

// Read data from a text file
async function readTextFile({ path: requested, maxChars = DEFAULT_READ_CHARS, startDirectory }) {
  const cwd = await getCurrentDirectory(startDirectory);
  const target = await resolvePath(requested, cwd);
  const stats = await fs.stat(target);

  if (stats.isDirectory()) {
    throw new UserError(`${target} is a folder. Use list_directory instead.`);
  }
  if (stats.size > MAX_READ_BYTES) {
    throw new UserError(`${path.basename(target)} is ${formatSize(stats.size)}, too large to read.`);
  }

  const buffer = await fs.readFile(target);
  if (buffer.subarray(0, 8000).includes(0)) {
    throw new UserError(`${path.basename(target)} looks like a binary file, not text.`);
  }

  const limit = Number.isInteger(maxChars)
    ? Math.min(MAX_READ_CHARS, Math.max(100, maxChars))
    : DEFAULT_READ_CHARS;
  const text = buffer.toString('utf8');

  return text.length > limit
    ? `${text.slice(0, limit)}\n\n[Truncated, file has ${text.length} characters]`
    : text || '(The file is empty.)';
}

// Write data to a text file
async function writeTextFile({
  path: requested,
  content,
  append = false,
  overwrite = false,
  startDirectory
}) {
  if (typeof content !== 'string') throw new UserError('File content must be text.');
  if (content.length > MAX_WRITE_CHARS) throw new UserError('That content is too large to write.');

  const cwd = await getCurrentDirectory(startDirectory);
  const target = await resolvePath(requested, cwd);
  assertNotSystemPath(target);

  if (await isDirectory(target)) throw new UserError(`${target} is a folder.`);
  if (!(await isDirectory(path.dirname(target)))) {
    throw new UserError(`The folder ${path.dirname(target)} does not exist. Create it first.`);
  }

  if (!append && !overwrite && (await exists(target))) {
    return `${target} already exists. Ask the user whether to replace it, then call again with overwrite set to true.`;
  }

  const replacing = !append && (await exists(target));
  await confirmAction(
    append ? 'Append to this file?' : replacing ? 'Replace this file?' : 'Create this file?',
    target
  );

  await (append ? fs.appendFile : fs.writeFile)(target, content, 'utf8');
  return `${append ? 'Appended to' : 'Wrote'} ${target}.`;
}

async function createDirectory({ path: requested, startDirectory }) {
  const cwd = await getCurrentDirectory(startDirectory);
  const target = await resolvePath(requested, cwd);
  assertNotSystemPath(target);

  if (await isDirectory(target)) return `${target} already exists.`;

  await fs.mkdir(target, { recursive: true });
  return `Created folder ${target}.`;
}

// Resolve a path from source to destination
async function resolveDestination(source, destination, cwd) {
  let target = await resolvePath(destination, cwd);

  // Moving or copying into an existing folder keeps the original name
  if (await isDirectory(target)) target = path.join(target, path.basename(source));

  assertNotSystemPath(target);
  return target;
}

// Copy a file/directory from source to destination
async function copyItem({ source, destination, overwrite = false, startDirectory }) {
  const cwd = await getCurrentDirectory(startDirectory);
  const from = await resolvePath(source, cwd);

  if (!(await exists(from))) throw new UserError(`${from} does not exist.`);

  const to = await resolveDestination(from, destination, cwd);

  if (!overwrite && (await exists(to))) {
    return `${to} already exists. Ask the user whether to replace it, then call again with overwrite set to true.`;
  }

  await confirmAction('Copy this item?', `${from}\n -> ${to}`);
  await fs.cp(from, to, { recursive: true, force: overwrite, errorOnExist: !overwrite });
  return `Copied ${from} to ${to}.`;
}

// Move a file/directory from source to destination
async function moveItem({ source, destination, overwrite = false, startDirectory }) {
  const cwd = await getCurrentDirectory(startDirectory);
  const from = await resolvePath(source, cwd);

  if (!(await exists(from))) throw new UserError(`${from} does not exist.`);

  assertNotSystemPath(from);
  assertNotProtectedRoot(from);

  const to = await resolveDestination(from, destination, cwd);

  if (path.resolve(from) === path.resolve(to)) return `${from} is already there.`;
  if (!overwrite && (await exists(to)) && from.toLowerCase() !== to.toLowerCase()) {
    return `${to} already exists. Ask the user whether to replace it, then call again with overwrite set to true.`;
  }

  await confirmAction('Move this item?', `${from}\n -> ${to}`);
  try {
    await fs.rename(from, to);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;

    // Different drives can't be renamed across, so copy and then remove
    await fs.cp(from, to, { recursive: true, force: overwrite, errorOnExist: !overwrite });
    await fs.rm(from, { recursive: true, force: true });
  }

  return `Moved ${from} to ${to}.`;
}

// Delete a file/directory
async function deleteItem({ path: requested, confirmed = false, startDirectory }) {
  const cwd = await getCurrentDirectory(startDirectory);
  const target = await resolvePath(requested, cwd);

  if (!(await exists(target))) throw new UserError(`${target} does not exist.`);

  assertNotSystemPath(target);
  assertNotProtectedRoot(target);

  if (confirmed !== true) {
    return `Not deleted yet. Ask the user to confirm deleting ${target}, then call again with confirmed set to true.`;
  }

  confirmAction('Move this to the Recycle Bin?', target);
  const shell = getElectron()?.shell;
  if (!shell?.trashItem) {
    throw new UserError('The Recycle Bin is unavailable, so nothing was deleted.');
  }

  await shell.trashItem(target);
  return `Moved ${target} to the Recycle Bin.`;
}

// Open a directory path
async function openPath({ path: requested, startDirectory }) {
  const cwd = await getCurrentDirectory(startDirectory);
  const target = await resolvePath(requested, cwd);

  if (!(await exists(target))) throw new UserError(`${target} does not exist.`);

  const shell = getElectron()?.shell;
  if (!shell?.openPath) throw new UserError('Opening files is unavailable here.');

  // openPath resolves to an empty string on success, or an error message
  const failure = await shell.openPath(target);
  if (failure) throw new UserError(failure);

  return `Opened ${target}.`;
}

const toolImplementations = {
  fetch_url: fetchUrl,
  web_search: webSearch,
  get_current_datetime: getCurrentDateTime,
  list_games: listGames,
  launch_game: launchGame,
  list_software: listSoftware,
  launch_software: launchSoftware,
  get_system_usage: getSystemUsage,
  list_resource_processes: listResourceProcesses,
  check_network_connectivity: checkNetworkConnectivity,
  get_current_directory: guarded(getCurrentDirectoryTool),
  change_directory: guarded(changeDirectory),
  list_directory: guarded(listDirectory),
  find_files: guarded(findFiles),
  read_text_file: guarded(readTextFile),
  write_text_file: guarded(writeTextFile),
  create_directory: guarded(createDirectory),
  copy_item: guarded(copyItem),
  move_item: guarded(moveItem),
  delete_item: guarded(deleteItem),
  open_path: guarded(openPath)
};

// Execute a tool call and return result or error message
async function executeToolCall(toolCall, settings = {}) {
  const name = toolCall.function.name;
  const rawArgs = toolCall.function.arguments;

  const parsedArgs =
    typeof rawArgs === 'string'
      ? JSON.parse(rawArgs || '{}')
      : rawArgs || {};

  const args =
    parsedArgs && typeof parsedArgs === 'object'
      ? parsedArgs
      : {};

  const fn = toolImplementations[name];

  if (!fn) {
    return { ok: false, error: `Unknown tool: ${name}` };
  }

  try {
    let effectiveArgs = args;

    // Use the saved timezone unless the model specifies one
    if (name === 'get_current_datetime' && !args.timeZone) {
      effectiveArgs = {
        ...args,
        timeZone: settings.timeZone || 'Asia/Karachi'
      };
    }

    if (name === 'web_search') {
      effectiveArgs = {
        ...args,
        apiKey: settings.braveApiKey || ''
      };
    }

    // Game tools
    if (name === 'list_games' || name === 'launch_game') {
      effectiveArgs = {
        ...args,
        gamePaths: Array.isArray(settings.gamePaths)
          ? settings.gamePaths
          : [],
        gameExecutableNicknames:
          settings.gameExecutableNicknames &&
          typeof settings.gameExecutableNicknames === 'object'
            ? settings.gameExecutableNicknames
            : {}
      };
    }

    if (name === 'list_software' || name === 'launch_software') {
      effectiveArgs = {
        ...args,
        softwarePaths: Array.isArray(settings.softwarePaths)
          ? settings.softwarePaths
          : [],
        softwareExecutableNicknames:
          settings.softwareExecutableNicknames &&
          typeof settings.softwareExecutableNicknames === 'object'
            ? settings.softwareExecutableNicknames
            : {}
      };
    }

    // File tools
    if (
      [
        'get_current_directory',
        'change_directory',
        'list_directory',
        'find_files',
        'read_text_file',
        'write_text_file',
        'create_directory',
        'copy_item',
        'move_item',
        'delete_item',
        'open_path'
      ].includes(name)
    ) {
      effectiveArgs = {
        ...args,
        startDirectory: settings.startDirectory || ''
      };
    }

    const result = await fn(effectiveArgs);

    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err)
    };
  }
}

module.exports = { toolDefinitions, executeToolCall };