(() => {
const timeZoneSelect = document.querySelector('#timezone');
const timeZoneId = document.querySelector('#timezone-id');
const status = document.querySelector('#settings-status');
if (!timeZoneSelect) return;
const timeZoneToggle = document.querySelector('#timezone-toggle');
const timeZoneLabel = document.querySelector('#timezone-label');
const timeZoneOptions = document.querySelector('#timezone-options');
const timeZoneWrap = document.querySelector('.settings-select-wrap');
timeZoneSelect.disabled = true;
let savedTimeZone = null;

function getOffsetMinutes(timeZone) {
  const offset = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName').value;
  const match = offset.match(/^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/);
  if (!match) throw new Error(`Unsupported timezone offset: ${offset}`);
  if (!match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === '+' ? minutes : -minutes;
}

function formatOffset(offset) {
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  return `GMT${sign}${hours}:${minutes}`;
}

const zonesByOffset = new Map();
const timeZones = [...new Set([...Intl.supportedValuesOf('timeZone'), 'UTC'])];
for (const timeZone of timeZones) {
  const offset = getOffsetMinutes(timeZone);
  const zones = zonesByOffset.get(offset) || [];
  zones.push(timeZone);
  zonesByOffset.set(offset, zones);
}

const optionsByOffset = new Map();
for (const [offset, zones] of [...zonesByOffset.entries()].sort((a, b) => b[0] - a[0])) {
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

function closeOptions(returnFocus = false) {
  timeZoneOptions.hidden = true;
  timeZoneToggle.setAttribute('aria-expanded', 'false');
  if (returnFocus) timeZoneToggle.focus();
}

function focusOption(index) {
  const options = [...timeZoneOptions.querySelectorAll('[role="option"]')];
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

function renderOptions() {
  timeZoneOptions.replaceChildren();
  for (const option of timeZoneSelect.options) {
    const item = document.createElement('button');
    item.className = 'settings-select-option';
    item.type = 'button';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(option.value === timeZoneSelect.value));
    item.textContent = option.textContent;
    item.dataset.timeZone = option.value;
    timeZoneOptions.appendChild(item);
  }
  const selected = timeZoneSelect.options[timeZoneSelect.selectedIndex];
  if (selected) timeZoneLabel.textContent = selected.textContent;
}

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

async function loadSettings() {
  try {
    const settings = await window.capriSettings.get();
    const offset = getOffsetMinutes(settings.timeZone);
    let option = optionsByOffset.get(offset);
    if (!option) {
      option = document.createElement('option');
      option.value = settings.timeZone;
      option.textContent = formatOffset(offset);
      timeZoneSelect.appendChild(option);
      optionsByOffset.set(offset, option);
    }
    option.value = settings.timeZone;
    timeZoneSelect.value = settings.timeZone;
    savedTimeZone = settings.timeZone;
    renderOptions();
    showTimeZoneId(settings.timeZone);
    timeZoneToggle.disabled = false;
  } catch (error) {
    status.textContent = `Couldn't load settings: ${error.message}`;
    timeZoneToggle.disabled = true;
  }
}

timeZoneToggle.addEventListener('click', () => {
  if (timeZoneOptions.hidden) openOptions();
  else closeOptions();
});

timeZoneToggle.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    openOptions(timeZoneSelect.selectedIndex + (event.key === 'ArrowDown' ? 1 : -1));
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    openOptions(event.key === 'Home' ? 0 : timeZoneSelect.options.length - 1);
  } else if (event.key === 'Escape' && !timeZoneOptions.hidden) {
    closeOptions();
  }
});

timeZoneOptions.addEventListener('click', (event) => {
  const option = event.target.closest('[role="option"]');
  if (option) chooseTimeZone(option.dataset.timeZone);
});

timeZoneOptions.addEventListener('keydown', (event) => {
  const options = [...timeZoneOptions.querySelectorAll('[role="option"]')];
  const index = options.indexOf(document.activeElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    focusOption(index + (event.key === 'ArrowDown' ? 1 : -1));
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    focusOption(event.key === 'Home' ? 0 : options.length - 1);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (index >= 0) chooseTimeZone(options[index].dataset.timeZone);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeOptions(true);
  }
});

document.addEventListener('pointerdown', (event) => {
  if (!timeZoneWrap.contains(event.target)) closeOptions();
});

document.querySelector('#settings-back').addEventListener('click', () => {
  window.capriWindow.closeSettings();
});

loadSettings();
})();
