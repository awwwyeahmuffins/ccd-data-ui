# Election Data Pipeline

This directory contains the data pipeline for harvesting, parsing, and processing Collin County election data.

## Overview

The pipeline consists of three main components:

1. **Harvest Engine** (`collin_harvest.py`): Scrapes election data from Collin County's website
2. **Unified Parser** (`unified_parser.py`): Parses CSV files in multiple formats
3. **Manifest Generator** (`manifest_generator.py`): Generates `data/elections.json` manifest

## Installation

Install required Python packages:

```bash
pip install -r requirements.txt
```

Required packages:
- `pandas` - Data manipulation and CSV parsing
- `beautifulsoup4` - HTML parsing for web scraping
- `requests` - HTTP requests for downloading files
- `lxml` - XML/HTML parser backend

## Usage

### Full Pipeline

Run the complete pipeline (harvest → parse → manifest):

```bash
# Harvest with limit (recommended for testing)
python pipeline.py --harvest-limit 10

# Full harvest (no limit)
python pipeline.py

# Use existing harvest data (skip harvest step)
python pipeline.py --use-existing
```

### Individual Components

#### Harvest Only

```bash
python collin_harvest.py
```

This will:
- Fetch election pages from `https://www.collincountytx.gov/Elections/election-results-archive`
- Download CSV/export files to `collin_elections_master/`
- Generate `collin_election_data_index.csv` with metadata

#### Parse Existing Files

To process existing CSV files (e.g., `2022_election.csv`, `2024_election.csv`):

```bash
python process_existing.py
```

This processes the existing multi-header CSV files and generates:
- Individual race CSVs in `data/` with year suffixes (e.g., `Governor_2024.csv`)
- Updated `data/elections.json` manifest

#### Test Parser

Test the parser with existing data:

```bash
python test_parser.py
```

## Pipeline Steps

### Step 1: Harvest

The harvest engine (`CollinElectionDataEngine`):

1. **Fetches archive page**: Scrapes the election results archive to discover election pages
2. **Extracts file links**: On each election page, finds links to CSV/export files
3. **Downloads files**: Saves files to `collin_elections_master/<election_name>/`
4. **Generates index**: Creates `collin_election_data_index.csv` with metadata:
   - `election`: Election name
   - `year`: Inferred year (from URL/filename)
   - `file_name`: Downloaded filename
   - `source_url`: Original URL
   - `local_path`: Local file path
   - `election_type`: federal/state/county/local/isd/mud

**Rate limiting**: 1 second delay between requests to be respectful to the server.

### Step 2: Parse

The unified parser supports three CSV formats:

1. **Multi-row header** (current format):
   - Row 0: Race names
   - Row 1: Candidate names
   - Example: `2024_election.csv`, `2022_election.csv`

2. **Single-header CSV**:
   - One header row with columns like `Precinct, Race, Candidate, Votes`
   - Or one column per candidate

3. **One race per file**:
   - Single race in file, single header row

**Output**:
- One CSV per race per election
- Filenames include year: `RaceName_YYYY.csv` (e.g., `Governor_2024.csv`)
- Written to `data/` directory

### Step 3: Manifest Generation

Generates `data/elections.json` with schema:

```json
[
  {
    "filename": "Governor_2024.csv",
    "year": 2024,
    "category": "State",
    "displayName": "Governor (2024)"
  },
  ...
]
```

**Fields**:
- `filename`: CSV filename relative to `data/`
- `year`: Election year (number or null)
- `category`: Federal, State, County, City, ISD, MUD
- `displayName`: Human-readable name (optional)

## Canonical Schema

All parsed CSVs follow this schema (column order):

### Static Columns
1. `COUNTY NUMBER` - County identifier (e.g., "COLL")
2. `PRECINCT CODE` - Precinct code
3. `PRECINCT NAME` - Precinct name
4. `REGISTERED VOTERS TOTAL` - Total registered voters
5. `BALLOTS CAST TOTAL` - Total ballots cast
6. `BALLOTS CAST BLANK` - Blank ballots

### Candidate Columns
- One column per candidate (party abbreviation + name, e.g., "Rep John Doe")
- `Write-in` column if present

### Metadata Columns
- `OVER VOTES` - Over votes count
- `UNDER VOTES` - Under votes count
- `Winning Candidate` - Name of winning candidate per precinct
- `Winning Party` - Party abbreviation of winner

**Aggregation**: Data is aggregated by `(COUNTY NUMBER, PRECINCT CODE, PRECINCT NAME)`:
- Static fields: `first()` (take first value)
- Vote counts: `sum()` (sum across rows)

**Winning Candidate**: Computed per precinct as the candidate with maximum votes.

## File Structure

```
data_processor/
├── collin_harvest.py      # Harvest engine
├── unified_parser.py       # Parser for multiple CSV formats
├── manifest_generator.py   # Manifest generator
├── pipeline.py            # Main pipeline orchestrator
├── process_existing.py    # Process existing CSV files
├── test_parser.py         # Test parser
├── requirements.txt       # Python dependencies
└── README.md             # This file

collin_elections_master/  # Harvested raw files (created by harvest)
├── 2024-general/
│   ├── all_races.csv
│   └── ...
└── collin_election_data_index.csv

data/                     # Parsed output (created by parser)
├── Governor_2024.csv
├── President_Vice_President_2024.csv
├── ...
└── elections.json        # Manifest (generated)
```

## Sample Run

Example with limit (for testing):

```bash
$ python pipeline.py --harvest-limit 10

============================================================
Starting Election Data Pipeline
============================================================
Step 1: Harvesting election data...
INFO: Fetching archive page: https://www.collincountytx.gov/...
INFO: Discovered 25 election pages
INFO: Processing election 1/10: https://www.collincountytx.gov/...
...
INFO: Harvest complete: 15 files downloaded

Step 2: Parsing election files...
INFO: Parsing 1/15: all_races.csv
...
INFO: Parsed 58 race files

Step 3: Generating manifest...
INFO: Manifest written: data/elections.json (58 entries)

============================================================
Pipeline Complete!
============================================================
```

## Error Handling

- **Harvest errors**: Failed downloads are logged but don't stop the pipeline
- **Parse errors**: Files that can't be parsed are logged and skipped
- **Missing data**: Missing columns are filled with defaults (e.g., COUNTY NUMBER = "COLL")

## Notes

- **Rate limiting**: 1 second delay between requests to avoid overwhelming the server
- **File naming**: Race names are sanitized (special chars → underscores)
- **Year inference**: Year is extracted from URL path, filename, or election name
- **Category inference**: Uses same logic as `js/electionFilters.js` `categorizeElection()`
- **Backward compatibility**: Existing files without year suffixes are supported

## Troubleshooting

**Import errors**: Ensure all dependencies are installed:
```bash
pip install -r requirements.txt
```

**Harvest fails**: Check network connection and that the archive URL is accessible.

**Parse errors**: Check CSV format - the parser auto-detects format but may need adjustment for unusual structures.

**Missing columns**: The parser fills missing static columns with defaults, but candidate columns must exist.

## Future Enhancements

- Support for Excel files (.xlsx, .xls)
- Precinct mapping for comparing elections with different precinct boundaries
- Validation of vote totals against expected values
- Incremental updates (only process new files)
