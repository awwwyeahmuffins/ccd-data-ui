# Election Data Layout Specification v2.0

**Last Updated**: January 31, 2026  
**Status**: Current Production Layout

This document specifies the exact data contract between the data pipeline and the frontend application. Any changes to this layout must be coordinated with the frontend team.

---

## 1. Manifest File

### Location
- **Path**: `data/elections.json`
- **Format**: JSON array
- **Encoding**: UTF-8

### Entry Schema

Each entry in the manifest array is an object with the following structure:

```json
{
  "filename": "Governor_2024.csv",
  "year": 2024,
  "category": "State",
  "displayName": "Governor (2024)"
}
```

#### Required Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `filename` | string | CSV filename relative to `data/` directory. Can be flat (`Governor_2024.csv`) or include subdirectories (`2024/Governor.csv`) | `"State_Senator_District_8_2024.csv"` |

#### Optional Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `year` | number \| null | Election year. Extracted from filename if not provided | `2024` |
| `category` | string | Election category. One of: `"Federal"`, `"State"`, `"County"`, `"City"`, `"ISD"`, `"MUD"` | `"State"` |
| `displayName` | string | Human-readable display name for UI | `"Governor (2024)"` |
| `raceKey` | string | Unique race identifier for trends/comparison (optional) | `"governor-2024"` |
| `sourceUrl` | string | Source URL for the data (optional) | `"https://..."` |

### Example Manifest

```json
[
  {
    "filename": "Governor_2024.csv",
    "year": 2024,
    "category": "State",
    "displayName": "Governor (2024)"
  },
  {
    "filename": "State_Senator_District_8_2024.csv",
    "year": 2024,
    "category": "State",
    "displayName": "State Senator District 8 (2024)"
  },
  {
    "filename": "President_Vice_President.csv",
    "year": 2024,
    "category": "Federal",
    "displayName": "President Vice President"
  }
]
```

### Legacy Format Support

The manifest supports legacy format (array of strings) for backward compatibility:

```json
[
  "Governor_2024.csv",
  "State_Senator_District_8_2024.csv"
]
```

Legacy entries are automatically normalized to objects with inferred `year` and `category` fields.

---

## 2. CSV File Location

### Current Layout (Flat Structure)

**Rule**: All CSV files are stored directly in the `data/` directory with flat filenames.

**Path Building**:
- If `filename` in manifest is `"Governor_2024.csv"`, the full path is `data/Governor_2024.csv`
- The `filename` field is used as-is relative to the `data/` directory

### Future Layout (Subdirectory Support)

**Rule**: CSV files can be organized in subdirectories by year or category.

**Path Building**:
- If `filename` in manifest is `"2024/Governor.csv"`, the full path is `data/2024/Governor.csv`
- If `filename` is `"State/Governor_2024.csv"`, the full path is `data/State/Governor_2024.csv`
- The `filename` field includes the full relative path from `data/`

**Note**: The frontend code supports both flat and subdirectory layouts. No code changes are required if switching to subdirectories, as long as the `filename` field contains the full relative path.

---

## 3. CSV Schema

### File Format
- **Format**: CSV (Comma-Separated Values)
- **Encoding**: UTF-8
- **Line Endings**: Unix (LF) or Windows (CRLF) - both supported
- **Header Row**: First row contains column names
- **Data Rows**: One row per precinct

### Column Structure

Each CSV file contains the following columns in this order:

#### 3.1 Static Metadata Columns (Required)

These columns appear in every CSV file and contain precinct and turnout information:

| Column Name | Type | Description | Example |
|-------------|------|-------------|---------|
| `COUNTY NUMBER` | string | County identifier | `"COLL"` |
| `PRECINCT CODE` | string | Precinct code (unique identifier) | `"1"` or `"PCT 001"` |
| `PRECINCT NAME` | string | Human-readable precinct name | `"PCT 001"` |
| `REGISTERED VOTERS TOTAL` | number | Total registered voters in precinct | `2737` |
| `BALLOTS CAST TOTAL` | number | Total ballots cast | `1491` |
| `BALLOTS CAST BLANK` | number | Number of blank ballots | `0` |

#### 3.2 Candidate Columns (Variable)

One column per candidate containing vote counts. Column names follow the pattern:

**Format**: `{PARTY_ABBREV} {Candidate Name}`

**Examples**:
- `REP Greg Abbott` - Republican candidate
- `DEM Beto O'Rourke` - Democratic candidate
- `LIB Mark Tippetts` - Libertarian candidate
- `GRN Delilah Barrios` - Green Party candidate

**Party Abbreviations**:
- `REP` or `Rep` - Republican
- `DEM` or `Dem` - Democrat
- `LIB` or `Lib` - Libertarian
- `GRN` or `Grn` - Green
- `MOD` or `Mod` - Moderate
- `IND` or `Ind` - Independent
- `CON` or `Con` - Constitution

**Note**: Party abbreviation may be uppercase or mixed case. The first word in the column name is used to identify the party.

#### 3.3 Special Columns (Optional)

| Column Name | Type | Description | Example |
|-------------|------|-------------|---------|
| `Write-in` | number | Write-in vote count | `0` |
| `OVER VOTES` | number | Over votes (ballots with too many selections) | `0` |
| `UNDER VOTES` | number | Under votes (ballots with too few selections) | `4` |
| `Winning Candidate` | string | Name of winning candidate for this precinct | `"REP Greg Abbott"` |
| `Winning Party` | string | Party abbreviation of winning candidate | `"REP"` |

### Example CSV Row

```csv
COUNTY NUMBER,PRECINCT CODE,PRECINCT NAME,REGISTERED VOTERS TOTAL,BALLOTS CAST TOTAL,BALLOTS CAST BLANK,REP Greg Abbott,DEM Beto O'Rourke,LIB Mark Tippetts,GRN Delilah Barrios,Write-in,OVER VOTES,UNDER VOTES,Winning Candidate,Winning Party
COLL,1,PCT 001,2737,1491,0,824,638,21,4,0,0,4,REP Greg Abbott,REP
```

### Candidate Column Detection

**Rule**: All columns that are **NOT** in the metadata columns list are considered candidate columns.

**Metadata Columns List** (excluded from candidate detection):
- `COUNTY NUMBER`
- `PRECINCT CODE`
- `PRECINCT NAME`
- `REGISTERED VOTERS TOTAL`
- `BALLOTS CAST TOTAL`
- `BALLOTS CAST BLANK`
- `Write-in`
- `OVER VOTES`
- `UNDER VOTES`
- `Winning Candidate`
- `Winning Party`

**Example**: If a CSV has columns `[PRECINCT CODE, PRECINCT NAME, REP John Doe, DEM Jane Smith]`, then `REP John Doe` and `DEM Jane Smith` are candidate columns.

### Data Types

| Column Type | Expected Type | Notes |
|-------------|---------------|-------|
| Metadata columns | As specified above | `PRECINCT CODE` and `PRECINCT NAME` are strings; vote/turnout columns are numbers |
| Candidate columns | number | Vote counts are integers (may be 0) |
| `Winning Candidate` | string | Full candidate name as it appears in candidate columns |
| `Winning Party` | string | Party abbreviation (e.g., "REP", "DEM") |

### Data Validation Rules

1. **One row per precinct**: Each `PRECINCT CODE` should appear exactly once per CSV file
2. **Vote counts**: Candidate columns must contain numeric values (integers ≥ 0)
3. **Turnout consistency**: `BALLOTS CAST TOTAL` should equal sum of candidate votes + `BALLOTS CAST BLANK` + `OVER VOTES` + `UNDER VOTES` (within rounding)
4. **Winning candidate**: `Winning Candidate` must match one of the candidate column names exactly
5. **Winning party**: `Winning Party` must match the party abbreviation from the winning candidate's column name

---

## 4. Backward Compatibility

### Legacy Manifest Format

The application supports legacy manifest format (array of strings) for backward compatibility:

```json
["Governor_2024.csv", "State_Senator_District_8_2024.csv"]
```

Legacy entries are automatically normalized:
- `year` is extracted from filename pattern `_YYYY.csv`
- `category` is inferred from filename using categorization rules
- `displayName` is set to `undefined`

### Legacy CSV Filenames

The application supports both naming conventions:
- **With year suffix**: `Governor_2024.csv`
- **Without year suffix**: `Governor.csv`

Both formats work as long as they are correctly referenced in the manifest.

---

## 5. Schema Reference Implementation

The frontend application uses `js/electionSchema.js` as the single source of truth for schema definitions. This module contains:

- `ELECTION_MANIFEST_SCHEMA`: Manifest entry shape and configuration
- `CSV_SCHEMA`: CSV column definitions and metadata
- Utility functions: `getCandidateColumns()`, `buildCSVPath()`, `normalizeManifestEntry()`

**Important**: When updating this specification, also update `js/electionSchema.js` to maintain consistency.

---

## 6. Change Management

### Making Schema Changes

If you need to change the data layout:

1. **Document the change**: Update this specification document
2. **Update schema module**: Modify `js/electionSchema.js` to reflect changes
3. **Test compatibility**: Ensure existing data still works
4. **Coordinate with frontend**: Notify frontend team of changes
5. **Version the spec**: Update version number and date in this document

### Breaking Changes

Breaking changes require:
- Frontend code updates
- Data migration scripts
- Coordinated deployment
- Version bump (e.g., v2.0 → v3.0)

### Non-Breaking Changes

Non-breaking changes (additive only):
- Adding optional fields to manifest entries
- Adding optional columns to CSV files
- Supporting new file path structures

---

## 7. Examples

### Example 1: Simple Race (Governor)

**Manifest Entry**:
```json
{
  "filename": "Governor_2024.csv",
  "year": 2024,
  "category": "State",
  "displayName": "Governor (2024)"
}
```

**CSV Header**:
```csv
COUNTY NUMBER,PRECINCT CODE,PRECINCT NAME,REGISTERED VOTERS TOTAL,BALLOTS CAST TOTAL,BALLOTS CAST BLANK,REP Greg Abbott,DEM Beto O'Rourke,LIB Mark Tippetts,GRN Delilah Barrios,Write-in,OVER VOTES,UNDER VOTES,Winning Candidate,Winning Party
```

### Example 2: District Race (State Senator)

**Manifest Entry**:
```json
{
  "filename": "State_Senator_District_8_2024.csv",
  "year": 2024,
  "category": "State",
  "displayName": "State Senator District 8 (2024)"
}
```

**CSV Header**:
```csv
COUNTY NUMBER,PRECINCT CODE,PRECINCT NAME,REGISTERED VOTERS TOTAL,BALLOTS CAST TOTAL,BALLOTS CAST BLANK,Dem Rachel Mello,Rep Angela Paxton,OVER VOTES,UNDER VOTES,Winning Candidate,Winning Party
```

### Example 3: Future Subdirectory Layout

**Manifest Entry**:
```json
{
  "filename": "2024/Governor.csv",
  "year": 2024,
  "category": "State",
  "displayName": "Governor (2024)"
}
```

**CSV Path**: `data/2024/Governor.csv`

---

## 8. Checklist for Data Engineers

When preparing new election data:

- [ ] Manifest file (`data/elections.json`) follows the entry schema
- [ ] All required fields (`filename`) are present
- [ ] CSV files exist at paths specified in manifest `filename` fields
- [ ] CSV files have required metadata columns (`PRECINCT CODE`, `PRECINCT NAME`)
- [ ] Candidate columns follow naming pattern: `{PARTY} {Name}`
- [ ] Vote counts are numeric (integers ≥ 0)
- [ ] One row per precinct (no duplicate `PRECINCT CODE` values)
- [ ] `Winning Candidate` matches a candidate column name exactly
- [ ] `Winning Party` matches party abbreviation from winning candidate
- [ ] Test with frontend application to verify compatibility

---

## 9. Checklist for Frontend Developers

When adapting to new data layouts:

- [ ] Review this specification document
- [ ] Update `js/electionSchema.js` if schema changed
- [ ] Test manifest loading with new format
- [ ] Test CSV loading with new path structure
- [ ] Verify candidate column detection works correctly
- [ ] Test backward compatibility with legacy formats
- [ ] Update tests in `js/dataLoader.test.js` if needed
- [ ] Manual smoke test: load election, view map, trends, export

---

**Questions or Issues?** Contact the data engineering team or frontend team lead.
