// precinctExport.js
// --------------------------------------------------------------------------------
// Export precinct report as PDF (via print) or Markdown download.

import { CATEGORY_ORDER, calculateTurnout } from "./precinctHistory.js";
import { populationOf } from "./utils.js";

/**
 * Export the current report as PDF via the browser print dialog.
 * Print CSS in precinct.html handles formatting.
 */
export function exportAsPDF() {
  window.print();
}

/**
 * Generate a full Markdown report for a precinct and trigger download.
 * @param {Object} data - Report data bundle
 * @param {string} data.code - Precinct code
 * @param {string} data.boundaryLabel - Active boundary label
 * @param {Object} [data.partyData] - Party registration data
 * @param {Object} [data.racialData] - Racial demographics data
 * @param {Object} [data.officials] - Officials/districts data
 * @param {Object} [data.census] - Census profile data
 * @param {Object} [data.votingHistory] - Voting history from buildVotingHistory
 */
export function exportAsMarkdown(data) {
  let lines = [];
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  lines.push(`# Precinct ${data.code} Report`);
  lines.push(`**Boundary:** ${data.boundaryLabel}  `);
  lines.push(`**Generated:** ${date}`);
  lines.push("");

  // Summary
  if (data.partyData || data.census) {
    lines.push("## Summary");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");
    // "Population" = racial-data total (sitewide convention), not census.population
    let popVal = populationOf(data.racialData, data.census);
    if (popVal != null) {
      lines.push(`| Population | ${Number(popVal).toLocaleString()} |`);
    }
    if (data.census?.households?.total != null) {
      lines.push(`| Households | ${Number(data.census.households.total).toLocaleString()} |`);
    }
    if (data.census?.income?.medianHousehold != null) {
      lines.push(`| Median Income | $${Number(data.census.income.medianHousehold).toLocaleString()} |`);
    }
    if (data.partyData?.winningParty) {
      lines.push(`| Party Lean | ${data.partyData.winningParty} (Strength ${data.partyData.partyStrength || "N/A"}/3) |`);
    }
    lines.push("");
  }

  // Party Registration
  if (data.partyData) {
    lines.push("## Party Registration");
    lines.push("");
    lines.push("| Party | Count | Share |");
    lines.push("|-------|-------|-------|");
    lines.push(`| Republican | ${fmtNum(data.partyData.rep)} | ${fmtPct(data.partyData.repShare)} |`);
    lines.push(`| Moderate | ${fmtNum(data.partyData.mod)} | ${fmtPct(data.partyData.modShare)} |`);
    lines.push(`| Democrat | ${fmtNum(data.partyData.dem)} | ${fmtPct(data.partyData.demShare)} |`);
    lines.push("");
  }

  // Racial Demographics
  if (data.racialData) {
    lines.push("## Racial Demographics");
    lines.push("");
    lines.push("| Group | Count | Share |");
    lines.push("|-------|-------|-------|");
    lines.push(`| White | ${fmtNum(data.racialData.white)} | ${fmtPct(data.racialData.pct_white)} |`);
    lines.push(`| Asian | ${fmtNum(data.racialData.asian)} | ${fmtPct(data.racialData.pct_asian)} |`);
    lines.push(`| Hispanic | ${fmtNum(data.racialData.hispanic)} | ${fmtPct(data.racialData.pct_hispanic)} |`);
    lines.push(`| Black | ${fmtNum(data.racialData.black)} | ${fmtPct(data.racialData.pct_black)} |`);
    lines.push(`| Others | ${fmtNum(data.racialData.others)} | ${fmtPct(data.racialData.pct_others)} |`);
    lines.push("");
  }

  // Districts & Officials
  if (data.officials) {
    let rows = buildOfficialsRows(data.officials);
    if (rows.length > 0) {
      lines.push("## Districts & Officials");
      lines.push("");
      lines.push("| Office | District/Name |");
      lines.push("|--------|--------------|");
      for (const row of rows) {
        lines.push(`| ${row.label} | ${row.value} |`);
      }
      lines.push("");
    }
  }

  // Election History
  if (data.votingHistory && data.votingHistory.races && data.votingHistory.races.length > 0) {
    lines.push("## Election History");
    lines.push("");
    let pr = data.votingHistory.partyRecord;
    lines.push(`**Party Record:** Rep ${pr.Rep} | Dem ${pr.Dem} | Other ${pr.Other}`);
    lines.push("");

    for (const category of CATEGORY_ORDER) {
      let races = data.votingHistory.byCategory[category];
      if (!races || races.length === 0) continue;

      lines.push(`### ${category} (${races.length})`);
      lines.push("");
      lines.push("| Race | Winner | Party | Votes | Turnout |");
      lines.push("|------|--------|-------|-------|---------|");
      for (const race of races) {
        let turnout = calculateTurnout(race.totalVotes, race.registeredVoters);
        lines.push(`| ${race.raceName} | ${race.winner} | ${race.winningParty} | ${fmtNum(race.totalVotes)} | ${turnout.toFixed(1)}% |`);
      }
      lines.push("");
    }
  }

  // Census Details
  if (data.census) {
    let p = data.census;
    lines.push("## Census Details");
    lines.push("");

    if (p.age) {
      lines.push("### Age & Gender");
      lines.push(`- Median Age: ${p.age.medianAge ?? "N/A"}`);
      if (p.gender) {
        lines.push(`- Male: ${fmtPct(p.gender.male)} / Female: ${fmtPct(p.gender.female)}`);
      }
      lines.push("");
    }

    if (p.income) {
      lines.push("### Income");
      lines.push(`- Median Household: $${fmtNum(p.income.medianHousehold)}`);
      lines.push(`- Poverty Rate: ${fmtPct(p.income.povertyRate)}`);
      lines.push("");
    }

    if (p.education) {
      lines.push("### Education");
      lines.push(`- High School or Less: ${fmtPct(p.education.highSchoolOrLess)}`);
      lines.push(`- Some College: ${fmtPct(p.education.someCollege)}`);
      lines.push(`- Bachelor's: ${fmtPct(p.education.bachelors)}`);
      lines.push(`- Graduate/Professional: ${fmtPct(p.education.graduateProfessional)}`);
      lines.push("");
    }

    if (p.housing) {
      lines.push("### Housing");
      lines.push(`- Median Home Value: $${fmtNum(p.housing.medianHomeValue)}`);
      lines.push(`- Median Rent: $${fmtNum(p.housing.medianRent)}`);
      lines.push(`- Homeowners: ${fmtPct(p.housing.ownerOccupied)}`);
      lines.push("");
    }

    if (p.households) {
      lines.push("### Households");
      lines.push(`- Total: ${fmtNum(p.households.total)}`);
      lines.push(`- Average Size: ${p.households.averageSize ?? "N/A"}`);
      lines.push("");
    }
  }

  let content = lines.join("\n");
  downloadFile(content, `precinct-${data.code}-report.md`, "text/markdown");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function fmtNum(n) {
  if (n == null || isNaN(n)) return "N/A";
  return Number(n).toLocaleString("en-US");
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return "N/A";
  return (n * 100).toFixed(1) + "%";
}

function buildOfficialsRows(officials) {
  let rows = [];
  if (officials.CONG != null) {
    let name = officials.CONG_N ? ` - ${officials.CONG_N}` : "";
    rows.push({ label: "US Congress", value: `District ${officials.CONG}${name}` });
  }
  if (officials.SEN != null) {
    let name = officials.SEN_N ? ` - ${officials.SEN_N}` : "";
    rows.push({ label: "TX Senate", value: `District ${officials.SEN}${name}` });
  }
  if (officials.SHR != null) {
    let name = officials.SHR_N ? ` - ${officials.SHR_N}` : "";
    rows.push({ label: "TX House", value: `District ${officials.SHR}${name}` });
  }
  if (officials.SED != null) {
    let name = officials.SED_N ? ` - ${officials.SED_N}` : "";
    rows.push({ label: "State Board of Ed", value: `District ${officials.SED}${name}` });
  }
  if (officials.COMMISH != null) {
    let name = officials.COMMISH_N ? ` - ${officials.COMMISH_N}` : "";
    rows.push({ label: "Commissioner", value: `Precinct ${officials.COMMISH}${name}` });
  }
  if (officials.JP_N != null) {
    rows.push({ label: "Justice of Peace", value: String(officials.JP_N) });
  }
  if (officials.CONST_N != null) {
    rows.push({ label: "Constable", value: String(officials.CONST_N) });
  }
  return rows;
}

function downloadFile(content, filename, mimeType) {
  let blob = new Blob([content], { type: mimeType + ";charset=utf-8;" });
  let url = URL.createObjectURL(blob);
  let a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
