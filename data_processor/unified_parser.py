"""
Unified Election Data Parser

Parses election CSV files in multiple formats:
1. Multi-row header (row 0 = race names, row 1 = candidate names)
2. Single-header CSV
3. One race per file

Outputs canonical schema CSVs with year in filename.
"""

import pandas as pd
import os
import re
import logging
from pathlib import Path
from typing import Optional, List, Dict, Tuple

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Canonical schema columns (in order)
CANONICAL_STATIC_COLS = [
    'COUNTY NUMBER',
    'PRECINCT CODE',
    'PRECINCT NAME',
    'REGISTERED VOTERS TOTAL',
    'BALLOTS CAST TOTAL',
    'BALLOTS CAST BLANK'
]

CANONICAL_META_COLS = [
    'OVER VOTES',
    'UNDER VOTES',
    'Winning Candidate',
    'Winning Party'
]


def categorize_election_python(filename: str) -> str:
    """
    Categorize election based on filename (Python version of JS categorizeElection).
    
    Args:
        filename: Election filename
        
    Returns:
        Category: Federal, State, County, City, ISD, MUD
    """
    if not filename or not isinstance(filename, str):
        return 'County'
    
    normalized = filename.lower()
    
    # Federal races
    if any(term in normalized for term in ['president', 'united_states_senator', 
                                          'u._s._representative', 'united_states_representative']):
        return 'Federal'
    
    # MUD races (check before City)
    if '_mud_' in normalized or 'mud_no' in normalized:
        return 'MUD'
    
    # ISD races (check before City)
    if any(term in normalized for term in ['_isd_', '_isd-', 'for_school_trustee']):
        return 'ISD'
    
    # City races
    if any(term in normalized for term in ['_city_of_', ',_city_of_', 'mayor_', 
                                          'city_council', 'seat_no_', 'alderman']):
        return 'City'
    
    # State races
    if any(term in normalized for term in ['governor', 'lieutenant_governor', 
                                          'attorney_general', 'comptroller', 
                                          'commissioner_of_', 'railroad_commissioner',
                                          'state_representative', 'state_senator',
                                          'state_board_of_education', 'court_of_criminal_appeals',
                                          'supreme_court', 'court_of_appeals_district']):
        return 'State'
    
    # County races
    if any(term in normalized for term in ['county_', 'district_', 'sheriff', 
                                          'constable', 'justice_of_the_peace']):
        return 'County'
    
    return 'County'  # Default


def detect_csv_format(file_path: str) -> str:
    """
    Detect the format of a CSV file.
    
    Args:
        file_path: Path to CSV file
        
    Returns:
        Format type: 'multi_header', 'single_header', or 'one_race'
    """
    # Read first few rows to detect format
    try:
        df_preview = pd.read_csv(file_path, nrows=5, header=None)
        
        # Check if it looks like multi-row header (first row has repeated values)
        first_row = df_preview.iloc[0].astype(str).tolist()
        if len(set(first_row)) < len(first_row) * 0.5:  # Many repeated values
            return 'multi_header'
        
        # Check if it's a single-header CSV
        df_single = pd.read_csv(file_path, nrows=1)
        if len(df_single.columns) > 5:  # Reasonable number of columns
            return 'single_header'
        
        return 'one_race'
    except Exception as e:
        logger.warning(f"Error detecting format for {file_path}: {e}")
        return 'single_header'  # Default fallback


def parse_multi_header_csv(file_path: str, year: Optional[int] = None) -> List[Dict]:
    """
    Parse a multi-row header CSV (like current election_splitter.py format).
    
    Args:
        file_path: Path to CSV file
        year: Optional year for output filename
        
    Returns:
        List of dicts: {race_name, df, output_filename}
    """
    logger.info(f"Parsing multi-header CSV: {file_path}")
    
    try:
        df = pd.read_csv(file_path, header=[0, 1])
    except Exception as e:
        logger.error(f"Failed to read multi-header CSV {file_path}: {e}")
        return []
    
    # Extract static columns
    static_cols = CANONICAL_STATIC_COLS
    static_df = df.loc[:, df.columns.get_level_values(0).isin(static_cols)]
    
    # Get all unique race names (first-level header), excluding static columns
    all_races = [
        race for race in df.columns.get_level_values(0).unique()
        if race not in static_cols
    ]
    
    results = []
    
    for race in all_races:
        # Select static columns + this race's columns
        race_cols = df.loc[:, df.columns.get_level_values(0) == race]
        combined_df = pd.concat([static_df, race_cols], axis=1)
        
        # Flatten MultiIndex
        flattened = []
        for col in combined_df.columns:
            if col[0] in static_cols:
                flattened.append(col[0])
            else:
                flattened.append(col[1])
        combined_df.columns = flattened
        
        # Aggregate by precinct
        keep_fields = ["COUNTY NUMBER", "PRECINCT CODE", "PRECINCT NAME", "REGISTERED VOTERS TOTAL"]
        agg_dict = {}
        for colname in combined_df.columns:
            if colname in keep_fields:
                agg_dict[colname] = "first"
            else:
                agg_dict[colname] = "sum"
        
        agg_df = combined_df.groupby(
            ["COUNTY NUMBER", "PRECINCT CODE", "PRECINCT NAME"],
            as_index=False
        ).agg(agg_dict)
        
        # Compute winning candidate and party
        agg_df = compute_winning_candidate(agg_df)
        
        # Ensure canonical column order
        agg_df = ensure_canonical_columns(agg_df)
        
        # Generate output filename
        safe_race_name = sanitize_filename(race)
        if year:
            output_filename = f"{safe_race_name}_{year}.csv"
        else:
            output_filename = f"{safe_race_name}.csv"
        
        results.append({
            'race_name': race,
            'df': agg_df,
            'output_filename': output_filename
        })
    
    return results


def parse_single_header_csv(file_path: str, year: Optional[int] = None) -> List[Dict]:
    """
    Parse a single-header CSV.
    
    Args:
        file_path: Path to CSV file
        year: Optional year for output filename
        
    Returns:
        List of dicts: {race_name, df, output_filename}
    """
    logger.info(f"Parsing single-header CSV: {file_path}")
    
    try:
        df = pd.read_csv(file_path)
    except Exception as e:
        logger.error(f"Failed to read single-header CSV {file_path}: {e}")
        return []
    
    # Try to detect race column or infer from filename
    race_col = None
    for col in ['Race', 'race', 'RACE', 'Contest', 'contest']:
        if col in df.columns:
            race_col = col
            break
    
    if race_col:
        # Multiple races in one file
        results = []
        for race_name in df[race_col].unique():
            race_df = df[df[race_col] == race_name].copy()
            race_df = normalize_single_header_df(race_df, race_name)
            race_df = compute_winning_candidate(race_df)
            race_df = ensure_canonical_columns(race_df)
            
            safe_race_name = sanitize_filename(str(race_name))
            if year:
                output_filename = f"{safe_race_name}_{year}.csv"
            else:
                output_filename = f"{safe_race_name}.csv"
            
            results.append({
                'race_name': str(race_name),
                'df': race_df,
                'output_filename': output_filename
            })
        return results
    else:
        # Single race in file - infer race name from filename
        race_name = Path(file_path).stem
        df = normalize_single_header_df(df, race_name)
        df = compute_winning_candidate(df)
        df = ensure_canonical_columns(df)
        
        safe_race_name = sanitize_filename(race_name)
        if year:
            output_filename = f"{safe_race_name}_{year}.csv"
        else:
            output_filename = f"{safe_race_name}.csv"
        
        return [{
            'race_name': race_name,
            'df': df,
            'output_filename': output_filename
        }]


def normalize_single_header_df(df: pd.DataFrame, race_name: str) -> pd.DataFrame:
    """
    Normalize a single-header DataFrame to canonical schema.
    
    Args:
        df: Input DataFrame
        race_name: Race name
        
    Returns:
        Normalized DataFrame
    """
    # Map common column name variations
    column_mapping = {
        'County Number': 'COUNTY NUMBER',
        'County': 'COUNTY NUMBER',
        'Precinct Code': 'PRECINCT CODE',
        'Precinct': 'PRECINCT CODE',
        'Precinct Name': 'PRECINCT NAME',
        'Registered Voters Total': 'REGISTERED VOTERS TOTAL',
        'Registered Voters': 'REGISTERED VOTERS TOTAL',
        'Ballots Cast Total': 'BALLOTS CAST TOTAL',
        'Ballots Cast': 'BALLOTS CAST TOTAL',
        'Ballots Cast Blank': 'BALLOTS CAST BLANK',
        'Over Votes': 'OVER VOTES',
        'Under Votes': 'UNDER VOTES',
    }
    
    # Rename columns
    df = df.rename(columns=column_mapping)
    
    # Ensure static columns exist (fill with defaults if missing)
    for col in CANONICAL_STATIC_COLS:
        if col not in df.columns:
            if col == 'COUNTY NUMBER':
                df[col] = 'COLL'  # Default for Collin County
            elif col in ['REGISTERED VOTERS TOTAL', 'BALLOTS CAST TOTAL', 'BALLOTS CAST BLANK']:
                df[col] = 0
            else:
                df[col] = ''
    
    # Identify candidate columns (numeric columns that aren't metadata)
    meta_keys = set(CANONICAL_STATIC_COLS + CANONICAL_META_COLS + ['Write-in'])
    candidate_cols = [col for col in df.columns 
                     if col not in meta_keys and pd.api.types.is_numeric_dtype(df[col])]
    
    # If no candidate columns found, try to infer from column names
    if not candidate_cols:
        candidate_cols = [col for col in df.columns 
                         if col not in meta_keys and 
                         not col.lower().startswith(('precinct', 'county', 'registered', 'ballot', 'over', 'under'))]
    
    # Aggregate by precinct if needed
    if 'PRECINCT CODE' in df.columns:
        keep_fields = ["COUNTY NUMBER", "PRECINCT CODE", "PRECINCT NAME", "REGISTERED VOTERS TOTAL"]
        agg_dict = {}
        for colname in df.columns:
            if colname in keep_fields:
                agg_dict[colname] = "first"
            elif colname in candidate_cols or colname in ['OVER VOTES', 'UNDER VOTES', 'BALLOTS CAST TOTAL', 'BALLOTS CAST BLANK']:
                agg_dict[colname] = "sum"
            else:
                agg_dict[colname] = "first"
        
        df = df.groupby(
            ["COUNTY NUMBER", "PRECINCT CODE", "PRECINCT NAME"],
            as_index=False
        ).agg(agg_dict)
    
    return df


def compute_winning_candidate(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute winning candidate and party for each precinct.
    
    Args:
        df: DataFrame with candidate vote columns
        
    Returns:
        DataFrame with 'Winning Candidate' and 'Winning Party' columns added
    """
    # Identify candidate columns
    meta_keys = set(CANONICAL_STATIC_COLS + CANONICAL_META_COLS + ['Write-in'])
    candidate_cols = [col for col in df.columns 
                     if col not in meta_keys and 
                     pd.api.types.is_numeric_dtype(df[col])]
    
    if not candidate_cols:
        df['Winning Candidate'] = None
        df['Winning Party'] = None
        return df
    
    # Find winning candidate (max votes)
    df['Winning Candidate'] = df[candidate_cols].idxmax(axis=1)
    
    # Extract party from candidate name (first token)
    def extract_party(candidate):
        if pd.isna(candidate) or not isinstance(candidate, str):
            return None
        parts = candidate.split()
        if parts:
            return parts[0]
        return None
    
    df['Winning Party'] = df['Winning Candidate'].apply(extract_party)
    
    return df


def ensure_canonical_columns(df: pd.DataFrame) -> pd.DataFrame:
    """
    Ensure DataFrame has canonical column order and all required columns.
    
    Args:
        df: Input DataFrame
        
    Returns:
        DataFrame with canonical column order
    """
    # Start with static columns
    ordered_cols = CANONICAL_STATIC_COLS.copy()
    
    # Add candidate columns (numeric columns that aren't metadata)
    meta_keys = set(CANONICAL_STATIC_COLS + CANONICAL_META_COLS + ['Write-in'])
    candidate_cols = [col for col in df.columns 
                     if col not in meta_keys and 
                     pd.api.types.is_numeric_dtype(df[col])]
    
    # Add Write-in if present
    if 'Write-in' in df.columns:
        ordered_cols.append('Write-in')
    
    # Add candidate columns
    ordered_cols.extend(sorted(candidate_cols))
    
    # Add meta columns
    for col in ['OVER VOTES', 'UNDER VOTES', 'Winning Candidate', 'Winning Party']:
        if col in df.columns:
            ordered_cols.append(col)
    
    # Add any remaining columns
    for col in df.columns:
        if col not in ordered_cols:
            ordered_cols.append(col)
    
    # Reorder DataFrame
    return df[[col for col in ordered_cols if col in df.columns]]


def sanitize_filename(name: str) -> str:
    """
    Sanitize a race name for use as a filename.
    
    Args:
        name: Race name
        
    Returns:
        Sanitized filename
    """
    # Replace problematic characters
    safe = re.sub(r'[^\w\s\-]', '_', name)
    safe = re.sub(r'[\s/]+', '_', safe)
    safe = re.sub(r'_+', '_', safe)  # Collapse multiple underscores
    return safe.strip('_')


def parse_election_file(file_path: str, year: Optional[int] = None, 
                        election_name: Optional[str] = None) -> List[Dict]:
    """
    Parse an election file, detecting format automatically.
    
    Args:
        file_path: Path to CSV file
        year: Optional year for output filename
        election_name: Optional election name for metadata
        
    Returns:
        List of dicts: {race_name, df, output_filename}
    """
    format_type = detect_csv_format(file_path)
    
    if format_type == 'multi_header':
        return parse_multi_header_csv(file_path, year)
    elif format_type == 'one_race':
        return parse_single_header_csv(file_path, year)
    else:  # single_header
        return parse_single_header_csv(file_path, year)


def write_parsed_races(parsed_races: List[Dict], output_dir: str = 'data'):
    """
    Write parsed races to CSV files.
    
    Args:
        parsed_races: List of {race_name, df, output_filename} dicts
        output_dir: Output directory
        
    Returns:
        List of output file paths
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    output_files = []
    
    for race_data in parsed_races:
        df = race_data['df']
        filename = race_data['output_filename']
        output_file = output_path / filename
        
        # Remove last row if it looks like a total/summary row
        # (common pattern: all zeros or very high values)
        if len(df) > 0:
            last_row = df.iloc[-1]
            # Heuristic: if last row has very high values or all zeros, it might be a total row
            numeric_cols = df.select_dtypes(include=['number']).columns
            if len(numeric_cols) > 0:
                last_row_numeric = last_row[numeric_cols]
                if last_row_numeric.sum() > df[numeric_cols].iloc[:-1].sum().sum() * 0.5:
                    # Likely a total row, exclude it
                    df = df.iloc[:-1]
        
        df.to_csv(output_file, index=False)
        output_files.append(str(output_file))
        logger.info(f"Wrote: {output_file}")
    
    return output_files
