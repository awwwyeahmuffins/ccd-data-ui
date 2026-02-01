"""
Test script for unified parser using existing election data.
"""

import sys
from pathlib import Path
from unified_parser import parse_election_file, write_parsed_races
from manifest_generator import generate_manifest, format_display_name, categorize_election_python

# Test with existing 2024_election.csv
test_file = '2024_election.csv'

if not Path(test_file).exists():
    print(f"Test file not found: {test_file}")
    sys.exit(1)

print(f"Testing parser with: {test_file}")
print("=" * 60)

# Parse the file
parsed_races = parse_election_file(test_file, year=2024)

print(f"\nParsed {len(parsed_races)} races:")
for i, race in enumerate(parsed_races[:5], 1):  # Show first 5
    print(f"  {i}. {race['race_name']} -> {race['output_filename']}")
    print(f"     Shape: {race['df'].shape}, Columns: {len(race['df'].columns)}")

if len(parsed_races) > 5:
    print(f"  ... and {len(parsed_races) - 5} more")

# Test manifest generation
print("\n" + "=" * 60)
print("Testing manifest generation...")

manifest_entries = []
for race_data in parsed_races[:10]:  # Use first 10 for testing
    filename = race_data['output_filename']
    category = categorize_election_python(filename)
    display_name = format_display_name(filename, 2024)
    
    manifest_entries.append({
        'filename': filename,
        'year': 2024,
        'category': category,
        'displayName': display_name
    })

print(f"\nSample manifest entries ({len(manifest_entries)}):")
for entry in manifest_entries[:5]:
    print(f"  {entry}")

print("\n" + "=" * 60)
print("Parser test complete!")
