// commandPalette.js
// --------------------------------------------------------------------------------
// The ⌘K command palette (views, actions, every election and precinct) and the
// app's global keyboard shortcuts (Escape stack, 1/2/3 views, b for browse).

import { state } from "./state.js";
import { showNotification, toggleHeader, updateThemeToggleIcon } from "./uiChrome.js";
import { setViewMode } from "./viewMode.js";
import { togglePanel, openRankerPanel, closeRankerPanel } from "./panels.js";
import { closeProfilePanel } from "./precinctPanel.js";
import { getPrecinctList, selectPrecinctByCode } from "./search.js";
import { selectElection } from "./electionWorkflow.js";
import { closeBoundaryPanel } from "./boundary.js";
import { MAP_CONFIG } from "../constants.js";
import { formatElectionName } from "../electionFilters.js";
import { toggleTheme, DARK_TILE_URL, LIGHT_TILE_URL } from "../themeManager.js";

const commandPalette = document.getElementById('command-palette');
const commandInput = document.getElementById('command-input');
const commandResults = document.getElementById('command-results');
const cmdKTrigger = document.getElementById('cmd-k-trigger');
const electionPanelEl = document.getElementById('election-panel');

export function buildCommands() {
  state.commands = [
    // View commands
    { type: 'view', title: 'Demographics View', subtitle: 'Show party lean by precinct', icon: '📊', action: () => setViewMode('demographics') },
    { type: 'view', title: 'Election View', subtitle: 'Show selected election results', icon: '🗳️', action: () => setViewMode('election') },
    { type: 'view', title: 'Turnout View', subtitle: 'Show voter turnout by precinct', icon: '📈', action: () => setViewMode('turnout') },
    { type: 'view', title: 'Reset Map', subtitle: 'Clear selection and reset view', icon: '🗺️', action: () => { state.map.setView(MAP_CONFIG.center, MAP_CONFIG.zoom); setViewMode('demographics'); } },

    // Actions
    { type: 'action', title: 'Toggle Dark Mode', subtitle: 'Switch between light and dark themes', icon: '🌙', action: () => {
      const newTheme = toggleTheme();
      updateThemeToggleIcon();
      if (state.tileLayer) {
        state.tileLayer.setUrl(newTheme === 'dark' ? DARK_TILE_URL : LIGHT_TILE_URL);
      }
    }},
    { type: 'action', title: 'Toggle Header', subtitle: 'Show or hide the header bar', icon: '📐', action: toggleHeader },
    { type: 'action', title: 'Open Election Panel', subtitle: 'Browse all elections', icon: '🗳️', action: () => { if (!electionPanelEl.classList.contains('active')) togglePanel(); } },
    { type: 'action', title: 'Search Precinct', subtitle: 'Find and zoom to a precinct by number', icon: '🔎', action: () => {
      const precinctSearchInput = document.getElementById('precinct-search-input-map');
      precinctSearchInput.focus();
      precinctSearchInput.select();
    }},
    { type: 'action', title: 'Margin of Victory', subtitle: 'Color election map by margin gradient', icon: '🎯', action: () => {
      if (state.currentElectionData) { state.electionColorMode = 'margin'; setViewMode('election'); }
      else showNotification('Select an election first');
    }},
    { type: 'action', title: 'Swing Precincts', subtitle: 'Show competitive precinct ranking', icon: '⚔️', action: () => {
      if (state.currentElectionData) openRankerPanel();
      else showNotification('Select an election first');
    }},

    // ALL Elections (searchable)
    ...state.elections.map(entry => ({
      type: 'election',
      title: entry.displayName || formatElectionName(entry.filename),
      subtitle: `${entry.year || ''} • ${entry.category || 'Election'}`,
      icon: getCategoryIcon(entry.category),
      action: () => selectElection(entry),
      filename: entry.filename
    })),

    // ALL Precincts (searchable)
    ...getPrecinctList().map(p => ({
      type: 'precinct',
      title: p.label,
      subtitle: p.meta || 'Click to zoom & view profile',
      icon: '📍',
      action: () => selectPrecinctByCode(p.code)
    }))
  ];
}

function getCategoryIcon(category) {
  const icons = {
    'Federal': '🏛️',
    'State': '⚖️',
    'County': '🏢',
    'City': '🏙️',
    'ISD': '🏫',
    'MUD': '💧'
  };
  return icons[category] || '📋';
}

function filterCommands(query) {
  if (!query) return state.commands.slice(0, 10);

  const lowerQuery = query.toLowerCase();
  return state.commands.filter(cmd =>
    cmd.title.toLowerCase().includes(lowerQuery) ||
    cmd.subtitle.toLowerCase().includes(lowerQuery)
  ).slice(0, 10);
}

function renderCommands(commands) {
  if (!commandResults) return;

  if (commands.length === 0) {
    commandResults.innerHTML = `
      <div class="command-item" style="opacity: 0.5; cursor: default;">
        <div class="command-item-icon">🔍</div>
        <div class="command-item-content">
          <div class="command-item-title">No results found</div>
          <div class="command-item-subtitle">Try a different search term</div>
        </div>
      </div>
    `;
    return;
  }

  commandResults.innerHTML = commands.map((cmd, idx) => `
    <div class="command-item ${idx === state.commandSelectedIndex ? 'selected' : ''}" data-index="${idx}">
      <div class="command-item-icon">${cmd.icon}</div>
      <div class="command-item-content">
        <div class="command-item-title">${cmd.title}</div>
        <div class="command-item-subtitle">${cmd.subtitle}</div>
      </div>
    </div>
  `).join('');

  // Attach click handlers
  commandResults.querySelectorAll('.command-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.index);
      const cmd = filterCommands(commandInput.value)[idx];
      if (cmd) {
        cmd.action();
        closeCommandPalette();
      }
    });
  });
}

function openCommandPalette() {
  commandPalette.classList.add('active');
  commandPalette.setAttribute('aria-hidden', 'false');
  commandInput.focus();
  state.commandSelectedIndex = 0;
  renderCommands(filterCommands(''));
}

function closeCommandPalette() {
  commandPalette.classList.remove('active');
  commandPalette.setAttribute('aria-hidden', 'true');
  commandInput.value = '';
}

commandInput.addEventListener('input', (e) => {
  state.commandSelectedIndex = 0;
  renderCommands(filterCommands(e.target.value));
});

commandInput.addEventListener('keydown', (e) => {
  const commands = filterCommands(commandInput.value);

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    state.commandSelectedIndex = Math.min(state.commandSelectedIndex + 1, commands.length - 1);
    renderCommands(commands);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    state.commandSelectedIndex = Math.max(state.commandSelectedIndex - 1, 0);
    renderCommands(commands);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const cmd = commands[state.commandSelectedIndex];
    if (cmd) {
      cmd.action();
      closeCommandPalette();
    }
  }
});

// Global keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Cmd+K or Ctrl+K to open command palette
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    if (commandPalette.classList.contains('active')) {
      closeCommandPalette();
    } else {
      openCommandPalette();
    }
    return;
  }

  // Escape to close modals
  if (e.key === 'Escape') {
    if (commandPalette.classList.contains('active')) {
      closeCommandPalette();
    } else if (document.getElementById('boundary-changes-panel').classList.contains('open')) {
      closeBoundaryPanel();
    } else if (document.getElementById('competitive-ranker-panel').classList.contains('active')) {
      closeRankerPanel();
    } else if (document.getElementById('precinct-profile-panel').classList.contains('active')) {
      closeProfilePanel();
    } else if (electionPanelEl.classList.contains('active')) {
      togglePanel();
    }
  }

  // E2: Keyboard shortcuts - only when no input/textarea is focused
  const activeEl = document.activeElement;
  const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
  if (!isInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
    switch (e.key) {
      case '1': setViewMode('demographics'); break;
      case '2': setViewMode('election'); break;
      case '3': setViewMode('turnout'); break;
      case 'b':
        e.preventDefault();
        togglePanel();
        break;
    }
  }
});

cmdKTrigger.addEventListener('click', openCommandPalette);

// Click outside to close
commandPalette.addEventListener('click', (e) => {
  if (e.target === commandPalette) {
    closeCommandPalette();
  }
});
