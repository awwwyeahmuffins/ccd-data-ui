#!/usr/bin/env python3
"""
Fix Manifest Script

This script:
1. Scans all CSV files in the data directory
2. Adds missing files to the elections.json manifest
3. Extracts year from filename and categorizes elections
"""

import json
import re
from pathlib import Path
from typing import Optional, Dict, List
import sys

# Add data_processor to path
sys.path.insert(0, str(Path(__file__).parent / 'data_processor'))

from manifest_generator import format_display_name, categorize_election_python

def extract_year_from_filename(filename: str) -> Optional[int]:
    """Extract year from filename (e.g., 'Race_2024.csv' -> 2024)."""
    # Try pattern: _YYYY.csv
    match = re.search(r'_(\d{4})\.csv$', filename)
    if match:
        return int(match.group(1))
    
    # Try pattern: YYYY.csv
    match = re.search(r'^(\d{4})_', filename)
    if match:
        return int(match.group(1))
    
    return None

def validate_csv_structure(file_path: Path) -> bool:
    """Check if CSV file has valid structure."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            first_line = f.readline().strip()
            if not first_line:
                return False
            
            # Check for required columns
            required_cols = ['PRECINCT CODE', 'PRECINCT NAME']
            has_required = all(col in first_line for col in required_cols)
            
            # Check if file has at least one data row
            second_line = f.readline().strip()
            has_data = bool(second_line)
            
            return has_required and has_data
    except Exception as e:
        print(f"  Warning: Could not validate {file_path.name}: {e}")
        return False

def fix_manifest():
    """Fix the elections.json manifest by adding missing CSV files."""
    data_dir = Path('data')
    manifest_path = data_dir / 'elections.json'
    
    if not manifest_path.exists():
        print(f"Error: {manifest_path} not found")
        return False
    
    # Load existing manifest
    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)
    
    # Create set of existing filenames (case-insensitive)
    existing_files = {entry['filename'].lower() for entry in manifest}
    
    # Find all CSV files
    csv_files = list(data_dir.glob('*.csv'))
    print(f"Found {len(csv_files)} CSV files in data directory")
    print(f"Found {len(manifest)} entries in manifest")
    
    # Find missing files
    missing_files = []
    for csv_file in csv_files:
        if csv_file.name.lower() not in existing_files:
            # Validate structure
            if validate_csv_structure(csv_file):
                missing_files.append(csv_file.name)
            else:
                print(f"  Skipping invalid file: {csv_file.name}")
    
    print(f"\nFound {len(missing_files)} valid CSV files missing from manifest")
    
    if not missing_files:
        print("No missing files to add!")
        return True
    
    # Add missing files to manifest
    new_entries = []
    for filename in missing_files:
        year = extract_year_from_filename(filename)
        category = categorize_election_python(filename)
        display_name = format_display_name(filename, year)
        
        entry = {
            'filename': filename,
            'year': year,
            'category': category
        }
        
        if display_name:
            entry['displayName'] = display_name
        
        new_entries.append(entry)
        print(f"  Adding: {filename} (year: {year}, category: {category})")
    
    # Add new entries to manifest
    manifest.extend(new_entries)
    
    # Sort by year (descending), then category, then filename
    manifest.sort(key=lambda x: (
        x.get('year') or 0,
        x.get('category', ''),
        x.get('filename', '')
    ), reverse=True)
    
    # Write updated manifest
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ Updated manifest: {len(manifest)} total entries ({len(new_entries)} added)")
    return True

if __name__ == '__main__':
    success = fix_manifest()
    sys.exit(0 if success else 1)
