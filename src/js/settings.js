(() => {
  // Timezone settings elements.
  const timeZoneSelect = document.querySelector('#timezone');
  const timeZoneId = document.querySelector('#timezone-id');
  const status = document.querySelector('#settings-status');
  const userNameInput = document.querySelector('#user-name');
  const userNameStatus = document.querySelector('#user-name-status');
  const requireStartInput = document.querySelector('#require-start');
  const requireStartStatus = document.querySelector('#require-start-status');
  const groqApiKeyInput = document.querySelector('#groq-api-key');
  const groqApiKeyStatus = document.querySelector('#groq-api-key-status');
  const groqTextModelInput = document.querySelector('#groq-text-model');
  const groqTextModelStatus = document.querySelector('#groq-text-model-status');
  const groqVoiceModelInput = document.querySelector('#groq-voice-model');
  const groqVoiceModelStatus = document.querySelector('#groq-voice-model-status');
  const groqApiKeySaveButton = document.querySelector('#save-groq-api-key');
  const groqTextModelSaveButton = document.querySelector('#save-groq-text-model');
  const groqVoiceModelSaveButton = document.querySelector('#save-groq-voice-model');
  const groqApiKeyToggle = document.querySelector('#toggle-groq-api-key');

  if (!timeZoneSelect) return;

  const timeZoneToggle = document.querySelector('#timezone-toggle');
  const timeZoneLabel = document.querySelector('#timezone-label');
  const timeZoneOptions = document.querySelector('#timezone-options');
  const timeZoneWrap = document.querySelector('.settings-select-wrap');

  const directorySettings = [
    {
      key: 'gamePaths',
      category: 'game',
      nicknamesKey: 'gameExecutableNicknames',
      label: 'game paths',
      emptyTitle: 'No libraries added',
      emptyDescription: 'Add folders or specific game executables for Capri to find.',
      pickerPrompt: 'Select game library folders...',
      selectMethod: 'selectGamePaths',
      saveMethod: 'setGamePaths',
      list: document.querySelector('#game-paths-list'),
      button: document.querySelector('#add-game-paths'),
      executableButton: document.querySelector('#add-game-executables'),
      status: document.querySelector('#game-paths-status')
    },
    {
      key: 'softwarePaths',
      category: 'software',
      nicknamesKey: 'softwareExecutableNicknames',
      label: 'software paths',
      emptyTitle: 'No software folders added',
      emptyDescription: 'Add folders or specific application executables Capri can launch.',
      pickerPrompt: 'Select software folders...',
      selectMethod: 'selectSoftwarePaths',
      saveMethod: 'setSoftwarePaths',
      list: document.querySelector('#software-paths-list'),
      button: document.querySelector('#add-software-paths'),
      executableButton: document.querySelector('#add-software-executables'),
      status: document.querySelector('#software-paths-status')
    }
  ].filter((directory) => directory.list);

  timeZoneSelect.disabled = true;
  for (const directory of directorySettings) {
    directory.paths = [];
    directory.nicknames = {};
    if (directory.button) directory.button.disabled = true;
    if (directory.executableButton) directory.executableButton.disabled = true;
  }
  if (userNameInput) userNameInput.disabled = true;
  if (requireStartInput) requireStartInput.disabled = true;
  for (const element of [
    groqApiKeyInput,
    groqTextModelInput,
    groqVoiceModelInput,
    groqApiKeySaveButton,
    groqTextModelSaveButton,
    groqVoiceModelSaveButton,
    groqApiKeyToggle,
  ]) {
    if (element) element.disabled = true;
  }

  let savedTimeZone = null;
  let savedUserName = '';
  let savedRequireStart = false;
  let savedGroqApiKey = '';
  let savedGroqTextModel = '';
  let savedGroqVoiceModel = '';

  // Get the current UTC offset for a timezone.
  function getOffsetMinutes(timeZone) {
    const offset = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName').value;

    const match = offset.match(/^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/);

    if (!match) {
      throw new Error(`Unsupported timezone offset: ${offset}`);
    }

    if (!match[1]) return 0;

    const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
    return match[1] === '+' ? minutes : -minutes;
  }

  // Format an offset as GMT+HH:MM or GMT-HH:MM.
  function formatOffset(offset) {
    const sign = offset < 0 ? '-' : '+';
    const absolute = Math.abs(offset);
    const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
    const minutes = String(absolute % 60).padStart(2, '0');

    return `GMT${sign}${hours}:${minutes}`;
  }

  // Build timezone options grouped by their current UTC offset.
  const zonesByOffset = new Map();
  const timeZones = [
    ...new Set([...Intl.supportedValuesOf('timeZone'), 'UTC'])
  ];

  for (const timeZone of timeZones) {
    const offset = getOffsetMinutes(timeZone);
    const zones = zonesByOffset.get(offset) || [];

    zones.push(timeZone);
    zonesByOffset.set(offset, zones);
  }

  const optionsByOffset = new Map();

  for (const [offset, zones] of [...zonesByOffset.entries()]
    .sort((a, b) => b[0] - a[0])) {

    // Prefer Karachi, UTC, and Asian timezones when offsets match.
    zones.sort((a, b) => {
      const priority = (zone) =>
        zone === 'Asia/Karachi' || (offset === 0 && zone === 'UTC')
          ? 0
          : zone.startsWith('Asia/')
            ? 1
            : 2;

      return priority(a) - priority(b) || a.localeCompare(b);
    });

    const option = document.createElement('option');
    option.value = zones[0];
    option.textContent = formatOffset(offset);

    timeZoneSelect.appendChild(option);
    optionsByOffset.set(offset, option);
  }

  function showTimeZoneId(timeZone) {
    timeZoneId.textContent = `IANA timezone: ${timeZone}`;
  }

  // Close the timezone dropdown.
  function closeOptions(returnFocus = false) {
    timeZoneOptions.hidden = true;
    timeZoneToggle.setAttribute('aria-expanded', 'false');

    if (returnFocus) timeZoneToggle.focus();
  }

  // Focus a timezone option by its index.
  function focusOption(index) {
    const options = [
      ...timeZoneOptions.querySelectorAll('[role="option"]')
    ];

    if (!options.length) return;

    const boundedIndex = Math.max(0, Math.min(index, options.length - 1));

    options[boundedIndex].focus();
    options[boundedIndex].scrollIntoView({ block: 'nearest' });
  }

  function openOptions(index = timeZoneSelect.selectedIndex) {
    timeZoneOptions.hidden = false;
    timeZoneToggle.setAttribute('aria-expanded', 'true');

    focusOption(index);
  }

  // Rebuild the custom timezone dropdown.
  function renderOptions() {
    timeZoneOptions.replaceChildren();

    for (const option of timeZoneSelect.options) {
      const item = document.createElement('button');

      item.className = 'settings-select-option';
      item.type = 'button';
      item.setAttribute(
        'role',
        'option'
      );
      item.setAttribute(
        'aria-selected',
        String(option.value === timeZoneSelect.value)
      );
      item.textContent = option.textContent;
      item.dataset.timeZone = option.value;

      timeZoneOptions.appendChild(item);
    }

    const selected = timeZoneSelect.options[timeZoneSelect.selectedIndex];

    if (selected) {
      timeZoneLabel.textContent = selected.textContent;
    }
  }

  // Save a selected timezone.
  async function chooseTimeZone(timeZone) {
    const previousTimeZone = savedTimeZone;

    timeZoneSelect.value = timeZone;
    renderOptions();
    closeOptions();

    timeZoneToggle.disabled = true;

    try {
      await window.capriSettings.setTimeZone(timeZone);

      savedTimeZone = timeZone;
      showTimeZoneId(timeZone);
      status.textContent = 'Saved';
    } catch (error) {
      timeZoneSelect.value = previousTimeZone;
      renderOptions();

      status.textContent = `Couldn't save timezone: ${error.message}`;
    } finally {
      timeZoneToggle.disabled = false;
      timeZoneToggle.focus();
    }
  }

  function normalizePaths(paths) {
    const result = [];
    const seen = new Set();

    for (const entry of Array.isArray(paths) ? paths : []) {
      if (typeof entry !== 'string' || !entry.trim()) continue;

      const directoryPath = entry.trim();
      const key = directoryPath.replace(/[\\/]+$/, '').toLowerCase()
        || directoryPath.toLowerCase();

      if (seen.has(key)) continue;

      seen.add(key);
      result.push(directoryPath);
    }

    return result;
  }

  function renderDirectoryPaths(directory) {
    directory.list.replaceChildren();

    if (directory.paths.length === 0) {
      const empty = document.createElement('li');
      const emptyIcon = createFolderIcon();
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      const description = document.createElement('span');

      empty.className = 'settings-path-empty';
      emptyIcon.classList.add('settings-empty-icon');
      title.textContent = directory.emptyTitle;
      description.textContent = directory.emptyDescription;
      copy.className = 'settings-empty-copy';
      copy.append(title, description);
      empty.append(emptyIcon, copy);

      directory.list.appendChild(empty);
      return;
    }

    for (const directoryPath of directory.paths) {
      const item = document.createElement('li');
      const details = document.createElement('div');
      const name = document.createElement('strong');
      const label = document.createElement('span');
      const isExecutable = directoryPath.toLowerCase().endsWith('.exe');

      item.className = 'settings-path-item';
      name.className = 'settings-path-name';
      name.textContent = directoryPath.split(/[\\/]/).filter(Boolean).pop() || directoryPath;
      label.className = 'settings-path-label';
      label.textContent = directoryPath;
      label.title = directoryPath;
      details.className = 'settings-path-details';
      details.appendChild(name);

      if (isExecutable) {
        item.classList.add('settings-path-item-executable');
        const pathRow = document.createElement('div');
        const nickname = document.createElement('input');

        pathRow.className = 'settings-executable-path';
        pathRow.append(createFolderIcon(), label);
        nickname.className = 'settings-executable-nickname';
        nickname.type = 'text';
        nickname.maxLength = 60;
        nickname.value = directory.nicknames[directoryPath] || '';
        nickname.placeholder = 'Nickname';
        nickname.setAttribute('aria-label', `Custom nickname for ${name.textContent}`);
        nickname.dataset.executablePath = directoryPath;
        details.append(pathRow, nickname);
      } else {
        details.appendChild(label);
      }

      const removeButton = document.createElement('button');
      removeButton.className = 'settings-path-remove';
      removeButton.type = 'button';
      removeButton.textContent = 'Remove';
      removeButton.dataset.directoryPath = directoryPath;
      removeButton.setAttribute('aria-label', `Remove ${directoryPath}`);

      if (isExecutable) {
        item.append(details, removeButton);
      } else {
        item.append(createFolderIcon(), details, removeButton);
      }
      directory.list.appendChild(item);
    }
  }

  function createFolderIcon() {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.classList.add('settings-folder-icon');
    path.setAttribute('d', 'M3.5 6.5h6l2 2H20a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 .5-1Z');
    icon.appendChild(path);

    return icon;
  }

  async function saveDirectoryPaths(directory, paths) {
    const previousPaths = [...directory.paths];
    const previousNicknames = { ...directory.nicknames };
    const nextPaths = normalizePaths(paths);

    if (!window.capriSettings?.[directory.saveMethod]) {
      directory.status.textContent = 'Folder settings are unavailable.';
      return;
    }

    const remainingPaths = new Set(
      nextPaths.map((directoryPath) => directoryPath.toLowerCase())
    );
    directory.nicknames = Object.fromEntries(
      Object.entries(directory.nicknames).filter(([executablePath]) =>
        remainingPaths.has(executablePath.toLowerCase())
      )
    );

    if (directory.button) directory.button.disabled = true;
    if (directory.executableButton) directory.executableButton.disabled = true;

    directory.paths = nextPaths;
    renderDirectoryPaths(directory);

    try {
      const result = await window.capriSettings[directory.saveMethod](nextPaths);

      directory.paths = normalizePaths(
        Array.isArray(result) ? result : nextPaths
      );

      renderDirectoryPaths(directory);
      directory.status.textContent = 'Saved';
    } catch (error) {
      directory.paths = previousPaths;
      directory.nicknames = previousNicknames;
      renderDirectoryPaths(directory);

      directory.status.textContent =
        `Couldn't save ${directory.label}: ${error.message}`;
    } finally {
      if (directory.button) directory.button.disabled = false;
      if (directory.executableButton) directory.executableButton.disabled = false;
    }
  }

  async function saveExecutableNickname(directory, input) {
    if (!window.capriSettings?.setExecutableNickname) {
      directory.status.textContent = 'Executable nicknames are unavailable.';
      return;
    }

    const executablePath = input.dataset.executablePath;
    const previousNickname = directory.nicknames[executablePath] || '';
    const nickname = input.value.trim();
    input.disabled = true;
    directory.status.textContent = 'Saving nickname...';

    try {
      const settings = await window.capriSettings.setExecutableNickname(
        directory.category,
        executablePath,
        nickname
      );
      directory.nicknames = settings[directory.nicknamesKey] || {};
      input.value = directory.nicknames[executablePath] || '';
      directory.status.textContent = 'Nickname saved';
    } catch (error) {
      input.value = previousNickname;
      directory.status.textContent =
        `Couldn't save executable nickname: ${error.message}`;
    } finally {
      input.disabled = false;
    }
  }

  async function saveUserName() {
    if (!userNameInput || !window.capriSettings?.setUserName) return;

    const userName = userNameInput.value.trim();
    if (userName === savedUserName) return;

    userNameInput.disabled = true;
    try {
      const settings = await window.capriSettings.setUserName(userName);
      savedUserName = settings.userName || '';
      userNameInput.value = savedUserName;
      userNameStatus.textContent = 'Saved';
    } catch (error) {
      userNameInput.value = savedUserName;
      userNameStatus.textContent = `Couldn't save name: ${error.message}`;
    } finally {
      userNameInput.disabled = false;
    }
  }

  async function saveRequireStart() {
    if (!requireStartInput) return;
    if (!window.capriSettings?.setRequireStart) {
      requireStartInput.checked = savedRequireStart;
      requireStartStatus.textContent = 'Startup setting is unavailable.';
      return;
    }

    requireStartInput.disabled = true;
    try {
      const settings = await window.capriSettings.setRequireStart(
        requireStartInput.checked
      );
      savedRequireStart = settings.requireStart === true;
      requireStartInput.checked = savedRequireStart;
      requireStartStatus.textContent = '';
    } catch (error) {
      requireStartInput.checked = savedRequireStart;
      requireStartStatus.textContent =
        `Couldn't save startup setting: ${error.message}`;
    } finally {
      requireStartInput.disabled = false;
    }
  }

  async function saveGroqApiKey() {
    if (!window.capriSettings?.setGroqApiKey) return;

    const apiKey = groqApiKeyInput.value.trim();
    if (apiKey === savedGroqApiKey) return;

    groqApiKeySaveButton.disabled = true;
    try {
      await window.capriSettings.setGroqApiKey(apiKey);
      savedGroqApiKey = apiKey;
      groqApiKeyInput.value = savedGroqApiKey;
      groqApiKeyStatus.textContent = '';
    } catch (error) {
      groqApiKeyStatus.textContent = `Couldn't save API key: ${error.message}`;
    } finally {
      groqApiKeySaveButton.disabled = false;
    }
  }

  async function saveGroqModel(input, status, button, settingMethod, getSavedModel, setSavedModel, label) {
    if (!window.capriSettings?.[settingMethod]) return;

    const model = input.value.trim();
    if (model === getSavedModel()) {
      status.textContent = '';
      return;
    }

    button.disabled = true;
    try {
      const settings = await window.capriSettings[settingMethod](model);
      setSavedModel(settings[settingMethod === 'setGroqTextModel'
        ? 'groqTextModel'
        : 'groqVoiceModel']);
      input.value = getSavedModel();
      status.textContent = '';
    } catch (error) {
      input.value = getSavedModel();
      status.textContent = `Couldn't save ${label.toLowerCase()}: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  }

  async function addDirectoryPaths(directory, button, selectMethod, prompt) {
    if (!window.capriSettings?.[selectMethod]) {
      directory.status.textContent = 'Path selection is unavailable.';
      return;
    }

    button.disabled = true;
    directory.status.textContent = prompt;

    try {
      const selectedPaths = await window.capriSettings[selectMethod]();

      // Cancelled dialogs return an empty array.
      if (!Array.isArray(selectedPaths) || selectedPaths.length === 0) {
        directory.status.textContent = '';
        return;
      }

      await saveDirectoryPaths(directory, [...directory.paths, ...selectedPaths]);
    } catch (error) {
      directory.status.textContent =
        `Couldn't select ${directory.label}: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  }

  // Load the saved timezone and folder settings.
  async function loadSettings() {
    let settings;

    try {
      settings = await window.capriSettings.get();
    } catch (error) {
      status.textContent = `Couldn't load settings: ${error.message}`;
      if (requireStartStatus) {
        requireStartStatus.textContent =
          `Couldn't load startup setting: ${error.message}`;
      }
      for (const directory of directorySettings) {
        directory.status.textContent =
          `Couldn't load ${directory.label} settings.`;
      }
      return;
    }

    // Restore timezone selection.
    savedUserName = typeof settings.userName === 'string'
      ? settings.userName
      : '';
    if (userNameInput) {
      userNameInput.value = savedUserName;
      userNameInput.disabled = false;
    }
    savedRequireStart = settings.requireStart === true;
    if (requireStartInput) {
      requireStartInput.checked = savedRequireStart;
      requireStartInput.disabled = false;
    }
    // The main process never sends the saved key back, so the field starts empty.
    savedGroqApiKey = typeof settings.groqApiKey === 'string'
      ? settings.groqApiKey
      : '';
    if (groqApiKeyInput) {
      groqApiKeyInput.value = savedGroqApiKey;
      groqApiKeyInput.disabled = false;
    }
    if (groqApiKeySaveButton) groqApiKeySaveButton.disabled = false;
    if (groqApiKeyToggle) groqApiKeyToggle.disabled = false;
    groqApiKeyStatus.textContent = '';
    savedGroqTextModel = typeof settings.groqTextModel === 'string'
      ? settings.groqTextModel
      : typeof settings.groqModel === 'string'
        ? settings.groqModel
        : '';
    if (groqTextModelInput) {
      groqTextModelInput.value = savedGroqTextModel;
      groqTextModelInput.disabled = false;
    }
    if (groqTextModelSaveButton) groqTextModelSaveButton.disabled = false;
    savedGroqVoiceModel = typeof settings.groqVoiceModel === 'string'
      ? settings.groqVoiceModel
      : '';
    if (groqVoiceModelInput) {
      groqVoiceModelInput.value = savedGroqVoiceModel;
      groqVoiceModelInput.disabled = false;
    }
    if (groqVoiceModelSaveButton) groqVoiceModelSaveButton.disabled = false;

    try {
      const timeZone = settings.timeZone || 'Asia/Karachi';
      const offset = getOffsetMinutes(timeZone);

      let option = optionsByOffset.get(offset);

      if (!option) {
        option = document.createElement('option');
        option.value = timeZone;
        option.textContent = formatOffset(offset);

        timeZoneSelect.appendChild(option);
        optionsByOffset.set(offset, option);
      }

      option.value = timeZone;
      timeZoneSelect.value = timeZone;
      savedTimeZone = timeZone;

      renderOptions();
      showTimeZoneId(timeZone);

      timeZoneToggle.disabled = false;
    } catch (error) {
      status.textContent = `Couldn't load timezone: ${error.message}`;
      timeZoneToggle.disabled = true;
    }

    for (const directory of directorySettings) {
      directory.paths = normalizePaths(settings[directory.key]);
      directory.nicknames = settings[directory.nicknamesKey] || {};
      renderDirectoryPaths(directory);
      if (directory.button) directory.button.disabled = false;
      if (directory.executableButton) directory.executableButton.disabled = false;
    }
  }

  // Timezone dropdown interactions.
  userNameInput?.addEventListener('change', saveUserName);
  requireStartInput?.addEventListener('change', saveRequireStart);
  groqApiKeySaveButton?.addEventListener('click', () => saveGroqApiKey());
  groqTextModelSaveButton?.addEventListener('click', () =>
    saveGroqModel(
      groqTextModelInput,
      groqTextModelStatus,
      groqTextModelSaveButton,
      'setGroqTextModel',
      () => savedGroqTextModel,
      (model) => { savedGroqTextModel = model; },
      'Text model'
    )
  );
  groqVoiceModelSaveButton?.addEventListener('click', () =>
    saveGroqModel(
      groqVoiceModelInput,
      groqVoiceModelStatus,
      groqVoiceModelSaveButton,
      'setGroqVoiceModel',
      () => savedGroqVoiceModel,
      (model) => { savedGroqVoiceModel = model; },
      'Transcription model'
    )
  );
  groqApiKeyToggle?.addEventListener('click', () => {
    const showApiKey = groqApiKeyInput.type === 'password';
    groqApiKeyInput.type = showApiKey ? 'text' : 'password';
    groqApiKeyToggle.setAttribute('aria-pressed', String(showApiKey));
    groqApiKeyToggle.setAttribute(
      'aria-label',
      showApiKey ? 'Hide API key' : 'Show API key'
    );
    groqApiKeyToggle.title = showApiKey ? 'Hide API key' : 'Show API key';
  });
  userNameInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      userNameInput.blur();
    }
  });

  timeZoneToggle.addEventListener('click', () => {
    if (timeZoneOptions.hidden) openOptions();
    else closeOptions();
  });

  timeZoneToggle.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();

      openOptions(
        timeZoneSelect.selectedIndex +
        (event.key === 'ArrowDown' ? 1 : -1)
      );
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();

      openOptions(
        event.key === 'Home' ? 0 : timeZoneSelect.options.length - 1
      );
    } else if (event.key === 'Escape' && !timeZoneOptions.hidden) {
      closeOptions();
    }
  });

  timeZoneOptions.addEventListener('click', (event) => {
    const option = event.target.closest('[role="option"]');

    if (option) {
      chooseTimeZone(option.dataset.timeZone);
    }
  });

  timeZoneOptions.addEventListener('keydown', (event) => {
    const options = [
      ...timeZoneOptions.querySelectorAll('[role="option"]')
    ];

    const index = options.indexOf(document.activeElement);

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();

      focusOption(index + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();

      focusOption(event.key === 'Home' ? 0 : options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();

      if (index >= 0) {
        chooseTimeZone(options[index].dataset.timeZone);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeOptions(true);
    }
  });

  for (const directory of directorySettings) {
    directory.button?.addEventListener('click', () =>
      addDirectoryPaths(
        directory,
        directory.button,
        directory.selectMethod,
        directory.pickerPrompt
      )
    );
    directory.executableButton?.addEventListener('click', () =>
      addDirectoryPaths(
        directory,
        directory.executableButton,
        'selectExecutables',
        'Select executable files...'
      )
    );
    directory.list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-directory-path]');
      if (!button) return;

      const directoryPath = button.dataset.directoryPath;
      saveDirectoryPaths(
        directory,
        directory.paths.filter((entry) => entry !== directoryPath)
      );
    });
    directory.list.addEventListener('change', (event) => {
      const input = event.target.closest('[data-executable-path]');
      if (input) saveExecutableNickname(directory, input);
    });
  }

  // Close the timezone dropdown when clicking outside it.
  document.addEventListener('pointerdown', (event) => {
    if (timeZoneWrap && !timeZoneWrap.contains(event.target)) {
      closeOptions();
    }
  });

  loadSettings();
})();