// sidebarController.js
// --------------------------------------------------------------------------------
// Expose functions that "drive" the sidebar DOM. For example:
//   - clearSidebar()
//   - renderPrecinctSidebar(properties) → sets #sidebar-content.innerHTML
//   - optionally: open/close sidebar animation, selected-state highlighting, etc.
//
// Workstream 2: Updated to use card-based design system
//
// Usage in app.js:
//   import { renderPrecinctSidebar, clearSidebar } from "./sidebarController.js";
//   ... 
//   onClickPrecinct = (properties, layer) => {
//     renderPrecinctSidebar(properties);
//     drawRacePieChart(properties); // from chartModule.js
//   }
//

import {
  precinctHeader,
  precinctPartyInfoHTML,
  createCard,
  createCardWithSubtitle,
  createStatGrid,
  createDivider,
  ICONS
} from "./sidebarTemplates.js";

export function clearSidebar() {
  let sidebarDiv = document.getElementById("sidebar-content");
  sidebarDiv.innerHTML = "";
}

export function renderPrecinctSidebar(properties) {
  let sidebarDiv = document.getElementById("sidebar-content");

  // Build party stats using the new stat grid
  let partyStats = createStatGrid([
    {
      label: 'Rep Share',
      value: ((properties.repShare || 0) * 100).toFixed(1) + '%',
      colorClass: 'rep'
    },
    {
      label: 'Mod Share',
      value: ((properties.modShare || 0) * 100).toFixed(1) + '%',
      colorClass: 'mod'
    },
    {
      label: 'Dem Share',
      value: ((properties.demShare || 0) * 100).toFixed(1) + '%',
      colorClass: 'dem'
    }
  ]);

  // Build the info stats
  let infoStats = createStatGrid([
    { label: 'Party Lean', value: properties.winningParty || 'N/A' },
    { label: 'Strength', value: properties.partyStrength || 'N/A' }
  ]);

  // Create card content with charts
  let cardContent = `
    ${infoStats}
    ${createDivider('Party Distribution')}
    ${partyStats}
    ${createDivider('Demographics')}
    <div class="pie-wrapper">
      <canvas id="racePieChart"></canvas>
    </div>
    ${createDivider('Party Breakdown')}
    <div class="pie-wrapper">
      <canvas id="partyPieChart"></canvas>
    </div>
  `;

  // Build HTML using the new card system
  let html = createCardWithSubtitle(
    `Precinct ${properties.PRECINCT}`,
    'Click for detailed analysis',
    ICONS.mapPin,
    cardContent,
    { colorClass: 'blue' }
  );

  sidebarDiv.innerHTML = html;
}

export function renderPrecinctElectionSidebar(properties) {
  let sidebarDiv = document.getElementById("sidebar-content");
  console.log("Rendering precinct election sidebar with properties:", properties);

  // Build party stats using the new stat grid
  let partyStats = createStatGrid([
    {
      label: 'Rep Share',
      value: ((properties.repShare || 0) * 100).toFixed(1) + '%',
      colorClass: 'rep'
    },
    {
      label: 'Mod Share',
      value: ((properties.modShare || 0) * 100).toFixed(1) + '%',
      colorClass: 'mod'
    },
    {
      label: 'Dem Share',
      value: ((properties.demShare || 0) * 100).toFixed(1) + '%',
      colorClass: 'dem'
    }
  ]);

  // Build the info stats
  let infoStats = createStatGrid([
    { label: 'Party Lean', value: properties.winningParty || 'N/A' },
    { label: 'Strength', value: properties.partyStrength || 'N/A' }
  ]);

  // Create card content for election view
  let cardContent = `
    ${infoStats}
    ${createDivider('Party Distribution')}
    ${partyStats}
    ${createDivider('Simulated Results')}
    <div class="election-info">
      <p>Simulated election results for this precinct based on current voter turnout adjustments.</p>
    </div>
  `;

  // Build HTML using the new card system
  let html = createCardWithSubtitle(
    `Precinct ${properties.PRECINCT}`,
    'Election Forecast',
    ICONS.vote,
    cardContent,
    { colorClass: 'blue' }
  );

  sidebarDiv.innerHTML = html;
}
