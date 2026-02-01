"""
Process existing election CSV files and generate manifest.

This script processes the existing 2022_election.csv and 2024_election.csv files
and generates the new manifest format with year and category.
"""

import sys
from pathlib import Path
from unified_parser import parse_election_file, write_parsed_races
from manifest_generator import generate_manifest, format_display_name, categorize_election_python

def process_existing_files():
    """Process existing election CSV files."""
    # Use absolute path to data directory
    script_dir = Path(__file__).parent
    output_dir = script_dir.parent / 'data'
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Process 2024 election
    file_2024 = Path('2024_election.csv')
    if file_2024.exists():
        print(f"Processing {file_2024}...")
        parsed_races_2024 = parse_election_file(str(file_2024), year=2024)
        write_parsed_races(parsed_races_2024, output_dir=str(output_dir))
        print(f"  Processed {len(parsed_races_2024)} races")
    else:
        print(f"File not found: {file_2024}")
        parsed_races_2024 = []
    
    # Process 2022 election
    file_2022 = Path('2022_election.csv')
    if file_2022.exists():
        print(f"Processing {file_2022}...")
        parsed_races_2022 = parse_election_file(str(file_2022), year=2022)
        write_parsed_races(parsed_races_2022, output_dir=str(output_dir))
        print(f"  Processed {len(parsed_races_2022)} races")
    else:
        print(f"File not found: {file_2022}")
        parsed_races_2022 = []
    
    # Generate manifest
    manifest_entries = []
    
    for race_data in parsed_races_2024:
        filename = race_data['output_filename']
        category = categorize_election_python(filename)
        display_name = format_display_name(filename, 2024)
        manifest_entries.append({
            'filename': filename,
            'year': 2024,
            'category': category,
            'displayName': display_name
        })
    
    for race_data in parsed_races_2022:
        filename = race_data['output_filename']
        category = categorize_election_python(filename)
        display_name = format_display_name(filename, 2022)
        manifest_entries.append({
            'filename': filename,
            'year': 2022,
            'category': category,
            'displayName': display_name
        })
    
    # Generate manifest
    manifest_path = generate_manifest(manifest_entries, output_path=str(output_dir / 'elections.json'))
    print(f"\nManifest generated: {manifest_path}")
    print(f"Total entries: {len(manifest_entries)}")

if __name__ == '__main__':
    process_existing_files()
