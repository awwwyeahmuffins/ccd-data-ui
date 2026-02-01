"""
Manifest Generator

Generates data/elections.json manifest from parsed election files.
"""

import json
import logging
from pathlib import Path
from typing import List, Dict, Optional
from unified_parser import categorize_election_python

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def format_display_name(filename: str, year: Optional[int] = None) -> str:
    """
    Format a display name from filename.
    
    Args:
        filename: CSV filename
        year: Optional year
        
    Returns:
        Display name
    """
    # Remove .csv extension and year suffix if present
    name = filename.replace('.csv', '')
    if year and name.endswith(f'_{year}'):
        name = name[:-len(f'_{year}')]
    
    # Replace underscores with spaces
    name = name.replace('_', ' ')
    
    # Add year if provided
    if year:
        return f"{name} ({year})"
    return name


def generate_manifest(parsed_files: List[Dict], output_path: str = 'data/elections.json') -> str:
    """
    Generate elections.json manifest from parsed files.
    
    Args:
        parsed_files: List of dicts with keys: filename, year, category, displayName (optional)
        output_path: Output path for manifest JSON
        
    Returns:
        Path to generated manifest
    """
    logger.info(f"Generating manifest: {output_path}")
    
    manifest = []
    
    for file_info in parsed_files:
        filename = file_info.get('filename', '')
        year = file_info.get('year')
        category = file_info.get('category')
        display_name = file_info.get('displayName')
        
        # Infer category if not provided
        if not category:
            category = categorize_election_python(filename)
        
        # Generate display name if not provided
        if not display_name:
            display_name = format_display_name(filename, year)
        
        manifest_entry = {
            'filename': filename,
            'year': year,
            'category': category
        }
        
        if display_name:
            manifest_entry['displayName'] = display_name
        
        manifest.append(manifest_entry)
    
    # Sort by year (descending), then category, then filename
    manifest.sort(key=lambda x: (
        x.get('year') or 0,
        x.get('category', ''),
        x.get('filename', '')
    ), reverse=True)
    
    # Write manifest
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    
    logger.info(f"Manifest written: {output_file} ({len(manifest)} entries)")
    return str(output_file)
