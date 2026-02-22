import { loadAllData } from "./dataLoader.js";
import { createPrecinctLayer } from "./precinctLayer.js";
import { renderPrecinctSidebar } from "./sidebarController.js";
import { drawRacePieChart } from "./racialPieChart.js";
import { drawPartyPieChart } from "./partyPieChart.js";
import { downloadCSV } from "./exportCSV.js";
import { clearLayers } from "./utils.js";
import { 
  createSidebarSkeleton, 
  fadeInContent,
  createErrorState 
} from "./skeletonLoader.js";

export function renderDemographicsView(map) {
  let sidebarDiv = document.getElementById("sidebar-content");
  
  // Show skeleton loading state while data loads
  sidebarDiv.innerHTML = createSidebarSkeleton('demographics');
  sidebarDiv.classList.add('skeleton-loading');

  // Initialize map with demographic data
  initializeDemographicsMap(map, sidebarDiv);
}

/**
 * Initialize the demographics map view
 * @param {Object} map - Leaflet map instance
 * @param {HTMLElement} sidebarDiv - Sidebar container element
 */
async function initializeDemographicsMap(map, sidebarDiv) {
  try {
    // Load all data (GeoJSON + DNC CSV + Racial CSV)
    let { geojson } = await loadAllData();
    
    // Fade in the actual content after data loads
    const sidebarContent = `
      <div class="sidebar-content-animated">
        <h2>Collin County Demographics</h2>
        <button id="download-btn" class="press-effect hover-lift-subtle">Download Precinct Data</button>
        <p>Click a precinct on the map to view demographic details.</p>
      </div>
    `;
    fadeInContent(sidebarDiv, sidebarContent);

    // 3) Define a style function for precinct polygons
    // mapModule.js (excerpt)

    // mapModule.js (or wherever you define styleByLean)

    function styleByLean(feature) {
      let p = feature.properties;
      // Force partyStrength into an integer 1–3
      const strength = Math.max(1, Math.min(3, Math.round(p.partyStrength)));

      let fillColor;
      if (p.winningParty === "Rep") {
        // Republicans: strength 1 = very light red, 2 = medium, 3 = dark
        switch (strength) {
          case 1: fillColor = "#fc9a9a"; break; // very light, pinkish red
          case 2: fillColor = "#d13636"; break; // medium-light red
          case 3: fillColor = "#630202"; break; // dark red
          default: fillColor = "#E06666";
        }
      }
      else if (p.winningParty === "Dem") {
        // Democrats: strength 1 = very light blue, 2 = medium, 3 = dark
        switch (strength) {
          case 1: fillColor = "#D6EAF8"; break; // very light blue
          case 2: fillColor = "#6D9EEB"; break; // medium blue
          case 3: fillColor = "#27408B"; break; // dark blue
          default: fillColor = "#6D9EEB";
        }
      }
      else {
        // Moderates (purple): strength 1 = more distinct light purple, 2 = medium, 3 = dark
        switch (strength) {
          case 1: fillColor = "#DDCCFF"; break; // light lavender (distinct from light red)
          case 2: fillColor = "#B19CD9"; break; // medium purple
          case 3: fillColor = "#5E2A7E"; break; // darkest purple
          default: fillColor = "#B19CD9";
        }
      }

      return {
        fillColor: fillColor,
        fillOpacity: 0.4,
        color: "black",       // outline now matches the party's color
        weight: p.partyStrength || 0.5
      };
    }
    // 4) Define what happens when a precinct is clicked/hovered
    let onClickPrecinct = function handlePrecinctClick(properties, layer) {
      // Render the sidebar HTML (header + party info + demographics)
      renderPrecinctSidebar(properties);
      // Then draw the Chart.js pie inside the #racePieChart canvas
      drawRacePieChart(properties);
      drawPartyPieChart(properties);
    };

    let onHoverPrecinct = function handlePrecinctHover(properties, layer) {
      // For example: highlight boundary on hover
      layer.setStyle({ weight: properties.partyStrength + 1 });
    };

    let onHoverOut = function handlePrecinctHoverOut(properties, layer) {
      // Reset weight when the mouse leaves
      layer.setStyle({ weight: properties.partyStrength });
    };

    // 5) Create the precinct layer (handles tooltips + events + styles)
    map.currentLayer = createPrecinctLayer(map, geojson, {
      styleFn: styleByLean,
      onClickPrecinct,
      onHoverPrecinct,
      onHoverOut
    });

    let allPrecinctProps = geojson.features.map(f => ({ ...f.properties }));

    document.getElementById("download-btn").addEventListener("click", function handleDownloadClick() {
      downloadCSV(allPrecinctProps, "precinct-data.csv");
    });
  } catch (err) {
    console.error("Error initializing demographics view:", err);
    // Show error state with fade-in
    fadeInContent(sidebarDiv, createErrorState(
      'Unable to load demographics',
      'Please check your connection and try again.'
    ));
  }
}