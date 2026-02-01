// partyPieChart.js
// --------------------------------------------------------------------------------
// Create/destroy a Chart.js pie chart for party affiliation.
// Uses the shared chartFactory for consistent styling.

import { buildPartyChartData, partyColorMap } from "./utils.js";
import { createPieChart, destroyChart } from "./chartFactory.js";

const CANVAS_ID = "partyPieChart";

export function destroyPartyPieChart() {
  destroyChart(CANVAS_ID);
}

export function drawPartyPieChart(properties) {
  const dataArray = buildPartyChartData(properties);
  
  if (dataArray.length === 0) {
    // Optionally show "No data" message
    const canvas = document.getElementById(CANVAS_ID);
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = "14px Arial";
      ctx.fillStyle = "#666";
      ctx.textAlign = "center";
      ctx.fillText("No party affiliation data available", canvas.width / 2, canvas.height / 2);
    }
    return null;
  }

  return createPieChart(CANVAS_ID, {
    dataArray,
    colorMap: partyColorMap,
    title: "Party Affiliation"
  });
}
