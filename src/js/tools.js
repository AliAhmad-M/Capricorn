const cheerio = require('cheerio');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const MAX_CONTENT_CHARS = 8000;
const FETCH_TIMEOUT_MS = 30000;
const MAX_SCAN_DEPTH = 15;

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
  }
];

// Normalize strings by removing spaces, hyphens, underscores, and punctuation
function normalizeText(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Fetch and extract readable webpage text
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

// List discovered executables
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

function formatExecutableName(entry) {
  return entry.nickname
    ? `${entry.nickname} (${entry.name})`
    : entry.name;
}

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

const toolImplementations = {
  fetch_url: fetchUrl,
  get_current_datetime: getCurrentDateTime,
  list_games: listGames,
  launch_game: launchGame,
  list_software: listSoftware,
  launch_software: launchSoftware,
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