#!/usr/bin/env python3
"""
Improve Manifest Years

This script attempts to infer years for manifest entries that don't have years.
It checks:
1. Filename patterns
2. File modification dates (as a fallback)
3. Common election years (2022, 2024)
"""

import json
import re
from pathlib import Path
from datetime import datetime
from typing import Optional

def infer_year_from_filename(filename: str) -> Optional[int]:
    """Try multiple patterns to extract year from filename."""
    # Pattern 1: _YYYY.csv
    match = re.search(r'_(\d{4})\.csv$', filename)
    if match:
        return int(match.group(1))
    
    # Pattern 2: YYYY_.csv
    match = re.search(r'^(\d{4})_', filename)
    if match:
        return int(match.group(1))
    
    # Pattern 3: (YYYY) in filename
    match = re.search(r'\((\d{4})\)', filename)
    if match:
        return int(match.group(1))
    
    return None

def infer_year_from_file_date(file_path: Path) -> Optional[int]:
    """Infer likely election year from file modification date."""
    try:
        mtime = file_path.stat().st_mtime
        mod_year = datetime.fromtimestamp(mtime).year
        
        # Common election years in recent history
        common_years = [2024, 2022, 2020, 2018, 2016]
        
        # If modified in election year or year after, likely that year
        if mod_year in common_years:
            return mod_year
        elif mod_year == 2025 or mod_year == 2026:
            # Likely 2024 data
            return 2024
        elif mod_year == 2023:
            # Likely 2022 data
            return 2022
        
        return None
    except:
        return None

def improve_manifest_years():
    """Improve year assignments in manifest."""
    manifest_path = Path('data/elections.json')
    
    if not manifest_path.exists():
        print(f"Error: {manifest_path} not found")
        return False
    
    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)
    
    updated = 0
    for entry in manifest:
        filename = entry.get('filename', '')
        current_year = entry.get('year')
        
        # Skip if already has year
        if current_year:
            continue
        
        file_path = Path('data') / filename
        
        # Try to infer year
        inferred_year = infer_year_from_filename(filename)
        
        if not inferred_year and file_path.exists():
            inferred_year = infer_year_from_file_date(file_path)
        
        if inferred_year:
            entry['year'] = inferred_year
            updated += 1
            print(f"  Updated {filename}: {inferred_year}")
    
    if updated > 0:
        # Re-sort by year
        manifest.sort(key=lambda x: (
            x.get('year') or 0,
            x.get('category', ''),
            x.get('filename', '')
        ), reverse=True)
        
        # Write updated manifest
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        
        print(f"\n✅ Updated {updated} entries with inferred years")
    else:
        print("No entries needed year updates")
    
    return True

if __name__ == '__main__':
    improve_manifest_years()
