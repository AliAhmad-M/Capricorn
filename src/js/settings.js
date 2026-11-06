(() => {
  // Timezone settings elements.
  const timeZoneSelect = document.querySelector('#timezone');
  const timeZoneId = document.querySelector('#timezone-id');
  const status = document.querySelector('#settings-status');
  const userNameInput = document.querySelector('#user-name');
  const userNameStatus = document.querySelector('#user-name-status');

  if (!timeZoneSelect) return;

  const timeZoneToggle = document.querySelector('#timezone-toggle');
  const timeZoneLabel = document.querySelector('#timezone-label');
  const timeZoneOptions = document.querySelector('#timezone-options');
  const timeZoneWrap = document.querySelector('.settings-select-wrap');

  // Game folder settings elements.
  const gamePathsList = document.querySelector('#game-paths-list');
  const addGamePathsButton = document.querySelector('#add-game-paths');
  const gamePathsStatus = document.querySelector('#game-paths-status');

  timeZoneSelect.disabled = true;
  if (addGamePathsButton) addGamePathsButton.disabled = true;
  if (userNameInput) userNameInput.disabled = true;

  let savedTimeZone = null;
  let savedGamePaths = [];
  let savedUserName = '';

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
    status.textContent = 'Saving...';

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

  // Remove duplicate game paths
  function normalizeGamePaths(paths) {
    const result = [];
    const seen = new Set();

    for (const entry of Array.isArray(paths) ? paths : []) {
      if (typeof entry !== 'string' || !entry.trim()) continue;

      const gamePath = entry.trim();
      const key = gamePath.replace(/[\\/]+$/, '').toLowerCase()
        || gamePath.toLowerCase();

      if (seen.has(key)) continue;

      seen.add(key);
      result.push(gamePath);
    }

    return result;
  }

  // Render the configured game folders.
  function renderGamePaths() {
    if (!gamePathsList) return;

    gamePathsList.replaceChildren();

    if (savedGamePaths.length === 0) {
      const empty = document.createElement('li');
      const emptyIcon = createFolderIcon();
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      const description = document.createElement('span');

      empty.className = 'settings-path-empty';
      emptyIcon.classList.add('settings-empty-icon');
      title.textContent = 'No libraries added';
      description.textContent = 'Add a folder to let Capri find your installed games.';
      copy.className = 'settings-empty-copy';
      copy.append(title, description);
      empty.append(emptyIcon, copy);

      gamePathsList.appendChild(empty);
      return;
    }

    for (const gamePath of savedGamePaths) {
      const item = document.createElement('li');
      const details = document.createElement('div');
      const name = document.createElement('strong');
      const label = document.createElement('span');

      item.className = 'settings-path-item';
      name.className = 'settings-path-name';
      name.textContent = gamePath.split(/[\\/]/).filter(Boolean).pop() || gamePath;
      label.className = 'settings-path-label';
      label.textContent = gamePath;
      label.title = gamePath;
      details.className = 'settings-path-details';
      details.append(name, label);

      const removeButton = document.createElement('button');
      removeButton.className = 'settings-path-remove';
      removeButton.type = 'button';
      removeButton.textContent = 'Remove';
      removeButton.dataset.gamePath = gamePath;
      removeButton.setAttribute('aria-label', `Remove ${gamePath}`);

      item.append(createFolderIcon(), details, removeButton);
      gamePathsList.appendChild(item);
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

  // Save all configured game folders.
  async function saveGamePaths(paths) {
    const previousPaths = [...savedGamePaths];
    const nextPaths = normalizeGamePaths(paths);

    if (!window.capriSettings?.setGamePaths) {
      gamePathsStatus.textContent = 'Game folder settings are unavailable.';
      return;
    }

    if (addGamePathsButton) addGamePathsButton.disabled = true;

    savedGamePaths = nextPaths;
    renderGamePaths();
    gamePathsStatus.textContent = 'Saving...';

    try {
      const result = await window.capriSettings.setGamePaths(nextPaths);

      savedGamePaths = normalizeGamePaths(
        Array.isArray(result) ? result : nextPaths
      );

      renderGamePaths();
      gamePathsStatus.textContent = 'Saved';
    } catch (error) {
      savedGamePaths = previousPaths;
      renderGamePaths();

      gamePathsStatus.textContent =
        `Couldn't save game folders: ${error.message}`;
    } finally {
      if (addGamePathsButton) {
        addGamePathsButton.disabled = false;
      }
    }
  }

  async function saveUserName() {
    if (!userNameInput || !window.capriSettings?.setUserName) return;

    const userName = userNameInput.value.trim();
    if (userName === savedUserName) return;

    userNameInput.disabled = true;
    userNameStatus.textContent = 'Saving...';
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

  // Open the native folder picker and append selected folders.
  async function addGamePaths() {
    if (!window.capriSettings?.selectGamePaths) {
      gamePathsStatus.textContent = 'Folder selection is unavailable.';
      return;
    }

    addGamePathsButton.disabled = true;
    gamePathsStatus.textContent = 'Select Steam library folders...';

    try {
      const selectedPaths = await window.capriSettings.selectGamePaths();

      // Cancelled dialogs return an empty array.
      if (!Array.isArray(selectedPaths) || selectedPaths.length === 0) {
        gamePathsStatus.textContent = '';
        return;
      }

      await saveGamePaths([...savedGamePaths, ...selectedPaths]);
    } catch (error) {
      gamePathsStatus.textContent =
        `Couldn't select game folders: ${error.message}`;
    } finally {
      addGamePathsButton.disabled = false;
    }
  }

  // Load the saved timezone and game folders.
  async function loadSettings() {
    let settings;

    try {
      settings = await window.capriSettings.get();
    } catch (error) {
      status.textContent = `Couldn't load settings: ${error.message}`;
      gamePathsStatus.textContent = 'Couldn\'t load game folder settings.';
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

    // Restore all saved game folders.
    savedGamePaths = normalizeGamePaths(settings.gamePaths);
    renderGamePaths();

    if (addGamePathsButton) {
      addGamePathsButton.disabled = false;
    }
  }

  // Timezone dropdown interactions.
  userNameInput?.addEventListener('change', saveUserName);
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

  // Add multiple Steam library folders.
  addGamePathsButton?.addEventListener('click', addGamePaths);

  // Remove an individual folder from the saved list.
  gamePathsList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-game-path]');

    if (!button) return;

    const gamePath = button.dataset.gamePath;

    saveGamePaths(
      savedGamePaths.filter((entry) => entry !== gamePath)
    );
  });

  // Close the timezone dropdown when clicking outside it.
  document.addEventListener('pointerdown', (event) => {
    if (timeZoneWrap && !timeZoneWrap.contains(event.target)) {
      closeOptions();
    }
  });

  loadSettings();
})();