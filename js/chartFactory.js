// chartFactory.js
// --------------------------------------------------------------------------------
// Generic chart factory to eliminate duplicate pie chart code.
// This module provides a unified interface for creating Chart.js pie charts.

import { CHART_CONFIG } from "./constants.js";

// Store chart instances by canvas ID
const chartInstances = {};

/**
 * Destroy an existing chart instance
 * @param {string} canvasId - The ID of the canvas element
 */
export function destroyChart(canvasId) {
  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
    chartInstances[canvasId] = null;
  }
}

/**
 * Create a pie chart with consistent styling
 * @param {string} canvasId - The ID of the canvas element
 * @param {Object} options - Chart options
 * @param {Array} options.dataArray - Array of { label, value } objects
 * @param {Object} options.colorMap - Map of label to color
 * @param {string} [options.title] - Optional chart title
 * @returns {Chart|null} - The Chart.js instance or null if no data
 */
export function createPieChart(canvasId, { dataArray, colorMap, title = null }) {
  // Validate input
  if (!dataArray || dataArray.length === 0) {
    console.warn(`No data available for chart: ${canvasId}`);
    return null;
  }

  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.error(`Canvas element not found: ${canvasId}`);
    return null;
  }

  // Destroy existing chart if present
  destroyChart(canvasId);

  // Extract labels, values, and colors
  const labels = dataArray.map(d => d.label);
  const values = dataArray.map(d => d.value);
  const backgroundColors = labels.map(label => colorMap[label] || "#888888");

  // Get canvas context
  const ctx = canvas.getContext("2d");

  // Build chart configuration
  const config = {
    type: "pie",
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: backgroundColors,
        borderColor: "#ffffff",
        borderWidth: 1
      }]
    },
    options: {
      responsive: CHART_CONFIG.pie.responsive,
      maintainAspectRatio: CHART_CONFIG.pie.maintainAspectRatio,
      animation: CHART_CONFIG.pie.animation,
      plugins: {
        title: title ? {
          display: true,
          text: title,
          font: { size: 16, weight: 'bold' },
          padding: { bottom: 10 }
        } : { display: false },
        datalabels: {
          ...CHART_CONFIG.datalabels,
          formatter: (value, context) => {
            const dataset = context.chart.data.datasets[0].data;
            const total = dataset.reduce((sum, v) => sum + v, 0);
            if (total === 0) return "0%";
            return ((value / total) * 100).toFixed(1) + "%";
          }
        },
        legend: {
          ...CHART_CONFIG.legend,
          labels: {
            ...CHART_CONFIG.legend.labels,
            generateLabels: (chart) => {
              const dataset = chart.data.datasets[0];
              return chart.data.labels.map((label, i) => ({
                text: getLegendLabel(label),
                fillStyle: dataset.backgroundColor[i],
                strokeStyle: dataset.borderColor,
                lineWidth: dataset.borderWidth,
                hidden: false,
                index: i
              }));
            }
          }
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const raw = ctx.raw;
              const label = ctx.label || "";
              const dataset = ctx.chart.data.datasets[0].data;
              const total = dataset.reduce((sum, v) => sum + v, 0);
              const pct = total > 0 ? ((raw / total) * 100).toFixed(1) : "0.0";
              return `${getLegendLabel(label)}: ${raw.toLocaleString()} (${pct}%)`;
            }
          }
        }
      }
    },
    plugins: [ChartDataLabels]
  };

  // Create and store the chart
  chartInstances[canvasId] = new Chart(ctx, config);
  return chartInstances[canvasId];
}

/**
 * Get friendly legend label for abbreviated party/ethnicity names
 * @param {string} label - The abbreviated label
 * @returns {string} - The full label name
 */
function getLegendLabel(label) {
  const labelMap = {
    // Party labels
    Rep: "Republican",
    Dem: "Democrat",
    Mod: "Moderate",
    Lib: "Libertarian",
    Grn: "Green",
    Ind: "Independent",
    // Ethnicity labels are already full names
  };
  return labelMap[label] || label;
}

/**
 * Get a chart instance by canvas ID
 * @param {string} canvasId - The ID of the canvas element
 * @returns {Chart|null} - The Chart.js instance or null
 */
export function getChart(canvasId) {
  return chartInstances[canvasId] || null;
}

/**
 * Update a chart's data without recreating it
 * @param {string} canvasId - The ID of the canvas element
 * @param {Array} dataArray - New data array
 * @param {Object} colorMap - Color map for labels
 */
export function updateChartData(canvasId, dataArray, colorMap) {
  const chart = chartInstances[canvasId];
  if (!chart) {
    console.warn(`No chart found for: ${canvasId}`);
    return;
  }

  const labels = dataArray.map(d => d.label);
  const values = dataArray.map(d => d.value);
  const backgroundColors = labels.map(label => colorMap[label] || "#888888");

  chart.data.labels = labels;
  chart.data.datasets[0].data = values;
  chart.data.datasets[0].backgroundColor = backgroundColors;
  chart.update();
}
