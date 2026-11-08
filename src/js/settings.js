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
  const groqApiKeySaveButton = document.querySelector('#save-groq-api-key');
  const groqApiKeyToggle = document.querySelector('#toggle-groq-api-key');
  const groqTextModelList = document.querySelector('#groq-text-models');
  const groqTextModelAddButton = document.querySelector('#add-groq-text-model');
  const groqTextModelStatus = document.querySelector('#groq-text-model-status');
  const groqVoiceModelList = document.querySelector('#groq-voice-models');
  const groqVoiceModelAddButton = document.querySelector('#add-groq-voice-model');
  const groqVoiceModelStatus = document.querySelector('#groq-voice-model-status');  
  const groqTextModelSaveButton = document.querySelector('#save-groq-text-model');
  const groqVoiceModelSaveButton = document.querySelector('#save-groq-voice-model');
  const braveApiKeyInput = document.querySelector('#brave-api-key');
  const braveApiKeyStatus = document.querySelector('#brave-api-key-status');
  const braveApiKeySaveButton = document.querySelector('#save-brave-api-key');
  const braveApiKeyToggle = document.querySelector('#toggle-brave-api-key');
  const startDirectoryLabel = document.querySelector('#start-directory');
  const startDirectoryName = document.querySelector('#start-directory-name');
  const startDirectoryStatus = document.querySelector('#start-directory-status');
  const chooseStartButton = document.querySelector('#choose-start-directory');
  const resetStartButton = document.querySelector('#reset-start-directory');

  if (!timeZoneSelect) return;

  const timeZoneToggle = document.querySelector('#timezone-toggle');
  const timeZoneLabel = document.querySelector('#timezone-label');
  const timeZoneOptions = document.querySelector('#timezone-options');
  const timeZoneWrap = document.querySelector('.settings-select-wrap');
  const saveButtonLabels = new WeakMap();
  const saveButtonTimers = new WeakMap();

  function showSaved(button) {
    if (!saveButtonLabels.has(button)) {
      saveButtonLabels.set(button, button.textContent.trim());
    }

    clearTimeout(saveButtonTimers.get(button));
    button.textContent = 'Saved';
    saveButtonTimers.set(button, setTimeout(() => {
      button.textContent = saveButtonLabels.get(button);
      saveButtonTimers.delete(button);
    }, 1000));
  }

  function appendModelInput(container, model = '') {
    const row = document.createElement('div');
    const priority = document.createElement('span');
    const input = document.createElement('input');
    const removeButton = document.createElement('button');

    row.className = 'settings-model-row';

    priority.className = 'settings-model-priority';

    input.className = 'settings-text-input settings-model-input';
    input.type = 'text';
    input.maxLength = 200;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'Enter model ID';
    input.value = model;
    input.dataset.modelInput = 'true';

    removeButton.className = 'settings-path-remove settings-model-remove';
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.dataset.removeModel = 'true';

    row.append(priority, input, removeButton);
    container.appendChild(row);
  }

  function updateModelEditor(container, addButton) {
    const rows = [...container.querySelectorAll('.settings-model-row')];
    const label = container.dataset.modelLabel || 'Model';

    rows.forEach((row, index) => {
      const priority = row.querySelector('.settings-model-priority');
      const input = row.querySelector('[data-model-input]');
      const removeButton = row.querySelector('[data-remove-model]');

      priority.textContent = `${index + 1}.`;
      input.setAttribute('aria-label', `${label} model ${index + 1}`);

      removeButton.hidden = rows.length === 1;
      removeButton.setAttribute(
        'aria-label',
        `Remove ${label.toLowerCase()} model ${index + 1}`
      );
    });

    addButton.disabled = rows.length >= 3;
  }

  function renderModelInputs(container, models, addButton) {
    const values = Array.isArray(models)
      ? models
          .filter((model) => typeof model === 'string')
          .slice(0, 3)
      : [];

    container.replaceChildren();

    for (const model of values.length ? values : ['']) {
      appendModelInput(container, model);
    }

    updateModelEditor(container, addButton);
  }

  function getModelValues(container) {
    return [...container.querySelectorAll('[data-model-input]')]
      .map((input) => input.value.trim())
      .filter(Boolean);
  }

  function addModelInput(container, addButton) {
    const count = container.querySelectorAll('[data-model-input]').length;

    if (count >= 3) return;

    appendModelInput(container);
    updateModelEditor(container, addButton);

    const inputs = container.querySelectorAll('[data-model-input]');
    inputs[inputs.length - 1].focus();
  }

  function attachModelEditor(container, addButton) {
    addButton.addEventListener('click', () => {
      addModelInput(container, addButton);
    });

    container.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-remove-model]');

      if (!removeButton) return;

      const rows = container.querySelectorAll('.settings-model-row');

      if (rows.length <= 1) return;

      removeButton.closest('.settings-model-row').remove();
      updateModelEditor(container, addButton);
    });
  }
  
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
    groqTextModelAddButton,
    groqVoiceModelAddButton,
    groqApiKeySaveButton,
    groqTextModelSaveButton,
    groqVoiceModelSaveButton,
    groqApiKeyToggle,
    braveApiKeyInput,
    braveApiKeySaveButton,
    braveApiKeyToggle,
  ]) {
    if (element) element.disabled = true;
  }

  let savedTimeZone = null;
  let savedUserName = '';
  let savedRequireStart = false;
  let savedGroqApiKey = '';
  let hasSavedBraveApiKey = false;
  let savedGroqTextModels = [];
  let savedGroqVoiceModels = [];
  let savedStartDirectory = '';
  let defaultStartDirectory = '';

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
    if (apiKey === savedGroqApiKey) {
      showSaved(groqApiKeySaveButton);
      return;
    }

    groqApiKeySaveButton.disabled = true;
    try {
      await window.capriSettings.setGroqApiKey(apiKey);
      savedGroqApiKey = apiKey;
      groqApiKeyInput.value = savedGroqApiKey;
      groqApiKeyStatus.textContent = '';
      showSaved(groqApiKeySaveButton);
    } catch (error) {
      groqApiKeyStatus.textContent = `Couldn't save API key: ${error.message}`;
    } finally {
      groqApiKeySaveButton.disabled = false;
    }
  }

  async function saveBraveApiKey() {
    if (!window.capriSettings?.setBraveApiKey) {
      braveApiKeyStatus.textContent = 'Brave API key settings are unavailable.';
      return;
    }

    const apiKey = braveApiKeyInput.value.trim();
    if (!apiKey && !hasSavedBraveApiKey) {
      showSaved(braveApiKeySaveButton);
      return;
    }

    braveApiKeySaveButton.disabled = true;
    try {
      const settings = await window.capriSettings.setBraveApiKey(apiKey);
      hasSavedBraveApiKey = settings.hasBraveApiKey === true;
      braveApiKeyInput.value = '';
      braveApiKeyStatus.textContent = '';
      showSaved(braveApiKeySaveButton);
    } catch (error) {
      braveApiKeyStatus.textContent =
        `Couldn't save Brave API key: ${error.message}`;
    } finally {
      braveApiKeySaveButton.disabled = false;
    }
  }

  async function saveGroqModels(
    container,
    status,
    button,
    addButton,
    settingMethod,
    getSavedModels,
    setSavedModels,
    label
  ) {
    if (!window.capriSettings?.[settingMethod]) return;

    const models = getModelValues(container);
    const previousModels = [...getSavedModels()];

    if (models.length > 3) {
      status.textContent = 'You can configure a maximum of 3 models.';
      return;
    }

    if (
      models.length === previousModels.length &&
      models.every((model, index) => model === previousModels[index])
    ) {
      status.textContent = '';
      showSaved(button);
      return;
    }

    button.disabled = true;
    addButton.disabled = true;

    container.querySelectorAll('input, button').forEach((element) => {
      element.disabled = true;
    });

    try {
      const settings = await window.capriSettings[settingMethod](models);

      const settingKey = settingMethod === 'setGroqTextModels'
        ? 'groqTextModels'
        : 'groqVoiceModels';

      const savedModels = Array.isArray(settings[settingKey])
        ? settings[settingKey]
        : models;

      setSavedModels(savedModels);

      renderModelInputs(container, savedModels, addButton);

      status.textContent = '';
      showSaved(button);
    } catch (error) {
      renderModelInputs(container, previousModels, addButton);

      status.textContent =
        `Couldn't save ${label.toLowerCase()}: ${error.message}`;
    } finally {
      button.disabled = false;
      updateModelEditor(container, addButton);
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

  function renderStartDirectory() {
    if (!startDirectoryLabel || !startDirectoryName) return;

    const directoryPath = savedStartDirectory || defaultStartDirectory;

    startDirectoryName.textContent = directoryPath
      ? directoryPath.split(/[\\/]/).filter(Boolean).pop() || directoryPath
      : 'Default folder';

    startDirectoryLabel.textContent =
      directoryPath || 'Your Windows user folder';

    startDirectoryLabel.title = directoryPath || 'Your Windows user folder';

    chooseStartButton.disabled = false;
    resetStartButton.disabled = !savedStartDirectory;
  }

  async function saveStartDirectory(directory) {
    if (!window.capriSettings?.setStartDirectory) {
      startDirectoryStatus.textContent = 'Start folder setting is unavailable.';
      return;
    }

    chooseStartButton.disabled = true;
    resetStartButton.disabled = true;

    try {
      const result = await window.capriSettings.setStartDirectory(directory);
      savedStartDirectory = result.startDirectory || '';
      startDirectoryStatus.textContent = 'Saved';
    } catch (error) {
      startDirectoryStatus.textContent =
        "Couldn't save start folder: " + error.message;
    } finally {
      renderStartDirectory();
    }
  }

  // Load the saved timezone and folder settings
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
    hasSavedBraveApiKey = settings.hasBraveApiKey === true;
    if (braveApiKeyInput) braveApiKeyInput.disabled = false;
    if (braveApiKeySaveButton) braveApiKeySaveButton.disabled = false;
    if (braveApiKeyToggle) braveApiKeyToggle.disabled = false;
 
    // Load text models
    const textModels =
      settings.groqTextModels ??
      settings.groqTextModel ??
      settings.groqModel;

    savedGroqTextModels = Array.isArray(textModels)
      ? textModels
      : typeof textModels === 'string' && textModels.trim()
        ? [textModels.trim()]
        : [];

    renderModelInputs(
      groqTextModelList,
      savedGroqTextModels,
      groqTextModelAddButton
    );

    if (groqTextModelSaveButton) {
      groqTextModelSaveButton.disabled = false;
    }

    // Load voice models
    const voiceModels =
      settings.groqVoiceModels ??
      settings.groqVoiceModel;

    savedGroqVoiceModels = Array.isArray(voiceModels)
      ? voiceModels
      : typeof voiceModels === 'string' && voiceModels.trim()
        ? [voiceModels.trim()]
        : [];

    renderModelInputs(
      groqVoiceModelList,
      savedGroqVoiceModels,
      groqVoiceModelAddButton
    );

    if (groqVoiceModelSaveButton) {
      groqVoiceModelSaveButton.disabled = false;
    }
    defaultStartDirectory =
      typeof settings.defaultStartDirectory === 'string'
        ? settings.defaultStartDirectory
        : '';

    savedStartDirectory =
      typeof settings.startDirectory === 'string'
        ? settings.startDirectory
        : '';

    renderStartDirectory();

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

  // Update username on change
  userNameInput?.addEventListener('change', saveUserName);

  // Update start flag on change
  requireStartInput?.addEventListener('change', saveRequireStart);

  // Update API key on button press
  groqApiKeySaveButton?.addEventListener('click', () => saveGroqApiKey());

  // Update voice text on button press
  attachModelEditor(groqTextModelList, groqTextModelAddButton);  
  groqTextModelSaveButton?.addEventListener('click', () =>
    saveGroqModels(
      groqTextModelList,
      groqTextModelStatus,
      groqTextModelSaveButton,
      groqTextModelAddButton,
      'setGroqTextModels',
      () => savedGroqTextModels,
      (models) => {
        savedGroqTextModels = models;
      },
      'Text models'
    )
  );

  // Update the voice model on button press
  attachModelEditor(groqVoiceModelList, groqVoiceModelAddButton);
  groqVoiceModelSaveButton?.addEventListener('click', () =>
    saveGroqModels(
      groqVoiceModelList,
      groqVoiceModelStatus,
      groqVoiceModelSaveButton,
      groqVoiceModelAddButton,
      'setGroqVoiceModels',
      () => savedGroqVoiceModels,
      (models) => {
        savedGroqVoiceModels = models;
      },
      'Voice models'
    )
  );

  // Toggle API key visibility on button press
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

  // Update API key on button press
  braveApiKeySaveButton?.addEventListener('click', saveBraveApiKey);
  
  // Toggle API key visibility on button press
  braveApiKeyToggle?.addEventListener('click', () => {
    const showApiKey = braveApiKeyInput.type === 'password';
    braveApiKeyInput.type = showApiKey ? 'text' : 'password';
    braveApiKeyToggle.setAttribute('aria-pressed', String(showApiKey));
    braveApiKeyToggle.setAttribute(
      'aria-label',
      showApiKey ? 'Hide API key' : 'Show API key'
    );
    braveApiKeyToggle.title = showApiKey ? 'Hide API key' : 'Show API key';
  });

  // Update start folder on button press
  chooseStartButton?.addEventListener('click', async () => {
    if (!window.capriSettings?.selectStartDirectory) return;

    chooseStartButton.disabled = true;
    try {
      const [selected] = (await window.capriSettings.selectStartDirectory()) || [];
      if (selected) await saveStartDirectory(selected);
    } catch (error) {
      startDirectoryStatus.textContent =
        "Couldn't select start folder: " + error.message;
    } finally {
      renderStartDirectory();
    }
  });

  // Reset start directory on button press
  resetStartButton?.addEventListener('click', () => saveStartDirectory(''));

  // Update user name on any keydown event
  userNameInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      userNameInput.blur();
    }
  });

  // Update timezone when dropdown changed
  timeZoneToggle.addEventListener('click', () => {
    if (timeZoneOptions.hidden) openOptions();
    else closeOptions();
  });

  // Update timezone on arrow key events
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

  // Close the timezone dropdown when clicking outside it
  document.addEventListener('pointerdown', (event) => {
    if (timeZoneWrap && !timeZoneWrap.contains(event.target)) {
      closeOptions();
    }
  });

  // Add directory when the button is pressed
  for (const directory of directorySettings) {
    directory.button?.addEventListener('click', () =>
      addDirectoryPaths(
        directory,
        directory.button,
        directory.selectMethod,
        directory.pickerPrompt
      )
    );

    // Add executable when the button is pressed
    directory.executableButton?.addEventListener('click', () =>
      addDirectoryPaths(
        directory,
        directory.executableButton,
        'selectExecutables',
        'Select executable files...'
      )
    );

    // Save directory path when the button is pressed
    directory.list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-directory-path]');
      if (!button) return;

      const directoryPath = button.dataset.directoryPath;
      saveDirectoryPaths(
        directory,
        directory.paths.filter((entry) => entry !== directoryPath)
      );
    });

    // Update executable nickname when input changes
    directory.list.addEventListener('change', (event) => {
      const input = event.target.closest('[data-executable-path]');
      if (input) saveExecutableNickname(directory, input);
    });
  }

  loadSettings();
})();