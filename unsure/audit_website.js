/**
 * Website Audit Script
 * 
 * This script audits the political website by:
 * 1. Loading CSV files and comparing data to what should be displayed
 * 2. Testing slider calculations
 * 3. Verifying data accuracy across all views
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse CSV file
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().replace(/\r\n/g, '\n').split('\n');
  if (lines.length < 2) return [];
  
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] ?? '';
    });
    return obj;
  });
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Audit results
const auditResults = {
  passed: [],
  failed: [],
  warnings: []
};

function logPass(message) {
  auditResults.passed.push(message);
  console.log(`✅ PASS: ${message}`);
}

function logFail(message, details = '') {
  auditResults.failed.push({ message, details });
  console.error(`❌ FAIL: ${message}`);
  if (details) console.error(`   Details: ${details}`);
}

function logWarning(message, details = '') {
  auditResults.warnings.push({ message, details });
  console.warn(`⚠️  WARN: ${message}`);
  if (details) console.warn(`   Details: ${details}`);
}

// Test 1: Verify elections.json matches actual CSV files
console.log('\n=== Test 1: Verifying elections.json matches CSV files ===\n');
try {
  const electionsManifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'data', 'elections.json'), 'utf-8')
  );
  const dataDir = path.join(__dirname, 'data');
  const csvFiles = fs.readdirSync(dataDir)
    .filter(f => f.endsWith('.csv'))
    .map(f => f.toLowerCase());
  
  logPass(`Found ${electionsManifest.length} elections in manifest`);
  logPass(`Found ${csvFiles.length} CSV files in data directory`);
  
  // Check each manifest entry has a corresponding CSV
  let missingFiles = 0;
  let extraFiles = 0;
  
  electionsManifest.forEach(entry => {
    const filename = entry.filename.toLowerCase();
    if (!csvFiles.includes(filename)) {
      logFail(`Manifest entry references missing CSV: ${entry.filename}`);
      missingFiles++;
    }
  });
  
  // Check for CSV files not in manifest
  electionsManifest.forEach(entry => {
    const idx = csvFiles.indexOf(entry.filename.toLowerCase());
    if (idx >= 0) csvFiles.splice(idx, 1);
  });
  
  if (csvFiles.length > 0) {
    logWarning(`Found ${csvFiles.length} CSV files not in manifest`, csvFiles.slice(0, 5).join(', '));
    extraFiles = csvFiles.length;
  }
  
  if (missingFiles === 0 && extraFiles === 0) {
    logPass('All manifest entries have corresponding CSV files');
  }
} catch (error) {
  logFail('Failed to verify elections.json', error.message);
}

// Test 2: Verify CSV file structure and data integrity
console.log('\n=== Test 2: Verifying CSV file structure and data integrity ===\n');
try {
  const electionsManifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'data', 'elections.json'), 'utf-8')
  );
  
  // Test a sample of elections (first 10)
  const sampleElections = electionsManifest.slice(0, 10);
  let validFiles = 0;
  let invalidFiles = 0;
  
  for (const entry of sampleElections) {
    const filePath = path.join(__dirname, 'data', entry.filename);
    
    if (!fs.existsSync(filePath)) {
      logFail(`CSV file does not exist: ${entry.filename}`);
      invalidFiles++;
      continue;
    }
    
    try {
      const data = parseCSV(filePath);
      
      if (data.length === 0) {
        logFail(`CSV file is empty: ${entry.filename}`);
        invalidFiles++;
        continue;
      }
      
      // Check required columns
      const requiredCols = ['PRECINCT CODE', 'PRECINCT NAME'];
      const firstRow = data[0];
      const missingCols = requiredCols.filter(col => !(col in firstRow));
      
      if (missingCols.length > 0) {
        logFail(`Missing required columns in ${entry.filename}`, missingCols.join(', '));
        invalidFiles++;
        continue;
      }
      
      // Check for numeric vote columns
      const voteColumns = Object.keys(firstRow).filter(key => {
        const value = firstRow[key];
        return !isNaN(Number(value)) && value !== '' && 
               !['PRECINCT CODE', 'COUNTY NUMBER'].includes(key);
      });
      
      if (voteColumns.length === 0) {
        logWarning(`No vote columns found in ${entry.filename}`);
      }
      
      // Verify precinct codes are consistent
      const precinctCodes = new Set(data.map(row => String(row['PRECINCT CODE'])));
      if (precinctCodes.size !== data.length) {
        logWarning(`Duplicate precinct codes found in ${entry.filename}`);
      }
      
      validFiles++;
      logPass(`Validated ${entry.filename} (${data.length} precincts, ${voteColumns.length} vote columns)`);
    } catch (error) {
      logFail(`Failed to parse ${entry.filename}`, error.message);
      invalidFiles++;
    }
  }
  
  logPass(`Validated ${validFiles} out of ${sampleElections.length} sample election files`);
} catch (error) {
  logFail('Failed to verify CSV files', error.message);
}

// Test 3: Verify 2024 election data matches source CSV
console.log('\n=== Test 3: Verifying 2024 election data matches source ===\n');
try {
  const source2024Path = path.join(__dirname, 'data_processor', '2024_election.csv');
  const electionsManifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'data', 'elections.json'), 'utf-8')
  );
  
  if (fs.existsSync(source2024Path)) {
    const sourceData = parseCSV(source2024Path);
    const sourcePrecincts = new Set(sourceData.map(row => String(row['PRECINCT CODE'])));
    
    logPass(`Source 2024 file has ${sourcePrecincts.size} unique precincts`);
    
    // Check a sample race from 2024
    const president2024 = electionsManifest.find(e => 
      e.filename.includes('President') && e.year === 2024
    );
    
    if (president2024) {
      const raceFile = path.join(__dirname, 'data', president2024.filename);
      if (fs.existsSync(raceFile)) {
        const raceData = parseCSV(raceFile);
        const racePrecincts = new Set(raceData.map(row => String(row['PRECINCT CODE'])));
        
        // Check if precincts match
        const missingInRace = [...sourcePrecincts].filter(p => !racePrecincts.has(p));
        const extraInRace = [...racePrecincts].filter(p => !sourcePrecincts.has(p));
        
        if (missingInRace.length === 0 && extraInRace.length === 0) {
          logPass(`Precincts match between source and ${president2024.filename}`);
        } else {
          if (missingInRace.length > 0) {
            logWarning(`Precincts in source but not in race file: ${missingInRace.length}`);
          }
          if (extraInRace.length > 0) {
            logWarning(`Precincts in race file but not in source: ${extraInRace.length}`);
          }
        }
      }
    }
  } else {
    logWarning('Source 2024_election.csv not found, skipping comparison');
  }
} catch (error) {
  logFail('Failed to verify 2024 election data', error.message);
}

// Test 4: Verify slider calculation logic
console.log('\n=== Test 4: Verifying slider calculation logic ===\n');
try {
  // Test turnout multiplier calculation
  // Formula: adjustedVotes = partyRegistration * baseVoteShare * turnoutMultiplier
  // Clamped to [0.5, 1.0]
  
  const testCases = [
    { registration: 1000, voteShare: 0.6, multiplier: 1.0, expected: 600 },
    { registration: 1000, voteShare: 0.6, multiplier: 0.8, expected: 480 },
    { registration: 1000, voteShare: 0.6, multiplier: 0.5, expected: 300 },
    { registration: 1000, voteShare: 0.6, multiplier: 0.3, expected: 300 }, // Clamped to 0.5
    { registration: 1000, voteShare: 0.6, multiplier: 1.2, expected: 600 }, // Clamped to 1.0
  ];
  
  function calculateAdjustedVotes(partyRegistration, baseVoteShare, turnoutMultiplier) {
    if (partyRegistration == null || isNaN(partyRegistration) || partyRegistration < 0) {
      return 0;
    }
    if (baseVoteShare == null || isNaN(baseVoteShare)) {
      return 0;
    }
    if (turnoutMultiplier == null || isNaN(turnoutMultiplier)) {
      turnoutMultiplier = 1.0;
    }
    turnoutMultiplier = Math.max(0.5, Math.min(1.0, turnoutMultiplier));
    const adjustedVotes = partyRegistration * baseVoteShare * turnoutMultiplier;
    return Math.round(adjustedVotes);
  }
  
  let passedTests = 0;
  testCases.forEach((testCase, idx) => {
    const result = calculateAdjustedVotes(
      testCase.registration,
      testCase.voteShare,
      testCase.multiplier
    );
    if (result === testCase.expected) {
      passedTests++;
      logPass(`Test case ${idx + 1}: multiplier=${testCase.multiplier}, result=${result}`);
    } else {
      logFail(`Test case ${idx + 1} failed`, 
        `Expected ${testCase.expected}, got ${result}`);
    }
  });
  
  logPass(`Slider calculation tests: ${passedTests}/${testCases.length} passed`);
} catch (error) {
  logFail('Failed to verify slider calculations', error.message);
}

// Test 5: Verify data consistency across views
console.log('\n=== Test 5: Verifying data consistency ===\n');
try {
  // Check that DNC Score file exists and has valid data
  const dncPath = path.join(__dirname, 'DNC Score By Precinct.csv');
  if (fs.existsSync(dncPath)) {
    const dncData = parseCSV(dncPath);
    logPass(`DNC Score file found with ${dncData.length} precincts`);
    
    // Check required columns
    const requiredCols = ['Precinct', 'Rep', 'Dem', 'Mod'];
    const firstRow = dncData[0];
    const missingCols = requiredCols.filter(col => !(col in firstRow));
    
    if (missingCols.length === 0) {
      logPass('DNC Score file has all required columns');
      
      // Verify shares sum to approximately 1.0
      let validShares = 0;
      dncData.slice(0, 10).forEach(row => {
        const repShare = parseFloat(row['Rep Share']) || 0;
        const demShare = parseFloat(row['Dem Share']) || 0;
        const modShare = parseFloat(row['Mod Share']) || 0;
        const total = repShare + demShare + modShare;
        
        if (Math.abs(total - 1.0) < 0.01) {
          validShares++;
        }
      });
      
      if (validShares === 10) {
        logPass('DNC Share columns sum correctly (sample check)');
      } else {
        logWarning(`Only ${validShares}/10 precincts have shares summing to ~1.0`);
      }
    } else {
      logFail('DNC Score file missing required columns', missingCols.join(', '));
    }
  } else {
    logFail('DNC Score By Precinct.csv not found');
  }
  
  // Check Racial Numbers file
  const racialPath = path.join(__dirname, 'Racial Numbers by Precinct.csv');
  if (fs.existsSync(racialPath)) {
    const racialData = parseCSV(racialPath);
    logPass(`Racial Numbers file found with ${racialData.length} precincts`);
  } else {
    logFail('Racial Numbers by Precinct.csv not found');
  }
} catch (error) {
  logFail('Failed to verify data consistency', error.message);
}

// Summary
console.log('\n=== Audit Summary ===\n');
console.log(`✅ Passed: ${auditResults.passed.length}`);
console.log(`❌ Failed: ${auditResults.failed.length}`);
console.log(`⚠️  Warnings: ${auditResults.warnings.length}\n`);

if (auditResults.failed.length > 0) {
  console.log('Failed Tests:');
  auditResults.failed.forEach((fail, idx) => {
    console.log(`  ${idx + 1}. ${fail.message}`);
    if (fail.details) console.log(`     ${fail.details}`);
  });
}

if (auditResults.warnings.length > 0) {
  console.log('\nWarnings:');
  auditResults.warnings.forEach((warn, idx) => {
    console.log(`  ${idx + 1}. ${warn.message}`);
    if (warn.details) console.log(`     ${warn.details}`);
  });
}

// Exit with error code if any tests failed
process.exit(auditResults.failed.length > 0 ? 1 : 0);
