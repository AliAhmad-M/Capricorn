const cheerio = require('cheerio');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MAX_CONTENT_CHARS = 6000;
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

const MAX_SEARCH_RESULTS = 5;
const MAX_SNIPPET_CHARS = 200;

const clip = (text, max) =>
  text.length > max ? `${text.slice(0, max).trim()}...` : text;

// DuckDuckGo wraps result links in a redirect; the real URL is in ?uddg=
function unwrapDuckDuckGoUrl(href) {
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    return url.searchParams.get('uddg') || url.href;
  } catch {
    return href;
  }
}

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

async function webSearch({ query }) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('A search query is required.');
  }

  const q = query.trim().slice(0, 200);
  const apiKey = process.env.BRAVE_API_KEY;
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
  check_network_connectivity: checkNetworkConnectivity
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