import pandas as pd
import os

# Path to the input CSV file
input_file = 'data_processor/2022_election.csv'

# Read the CSV with a two‐row header
df = pd.read_csv(input_file, header=[0, 1])

# Define the “static” columns that should appear in every split
static_cols = [
    'COUNTY NUMBER',
    'PRECINCT CODE',
    'PRECINCT NAME',
    'REGISTERED VOTERS TOTAL',
    'BALLOTS CAST TOTAL',
    'BALLOTS CAST BLANK'
]

# Extract the static columns into their own DataFrame
static_df = df.loc[:, df.columns.get_level_values(0).isin(static_cols)]

# Get all unique race names (first‐level header), excluding the static columns
all_races = [
    race for race in df.columns.get_level_values(0).unique()
    if race not in static_cols
]

# Create an output directory to store the split/aggregated CSVs
output_dir = 'data'
os.makedirs(output_dir, exist_ok=True)

for race in all_races:
    # 1) Select only the static columns + this race’s columns
    race_cols = df.loc[:, df.columns.get_level_values(0) == race]
    combined_df = pd.concat([static_df, race_cols], axis=1)

    # 2) Flatten the MultiIndex so:
    #    • static columns keep their original name,
    #    • race columns use level‐1 (candidate names, “OVER VOTES”, etc.)
    flattened = []
    for col in combined_df.columns:
        if col[0] in static_cols:
            flattened.append(col[0])
        else:
            flattened.append(col[1])
    combined_df.columns = flattened

    # 3) Build an aggregation dictionary:
    #    • Keep “COUNTY NUMBER”, “PRECINCT CODE”, “PRECINCT NAME” as‐is (take first)
    #    • Keep “REGISTERED VOTERS TOTAL” as‐is (take first)
    #    • Sum every other numeric column (all vote‐count fields)
    keep_fields = [
        "COUNTY NUMBER",
        "PRECINCT CODE",
        "PRECINCT NAME",
        "REGISTERED VOTERS TOTAL"
    ]
    agg_dict = {}
    for colname in combined_df.columns:
        if colname in keep_fields:
            agg_dict[colname] = "first"
        else:
            agg_dict[colname] = "sum"

    # 4) Group by the precinct key fields, apply the aggregation
    agg_df = combined_df.groupby(
        ["COUNTY NUMBER", "PRECINCT CODE", "PRECINCT NAME"],
        as_index=False
    ).agg(agg_dict)

    # NEW: Determine the winning candidate and its party for each precinct
    # Get candidate columns by excluding the static fields used in the groupby/aggregation
    candidate_cols = [col for col in agg_df.columns 
                      if col not in ["COUNTY NUMBER", "PRECINCT CODE", "PRECINCT NAME", "REGISTERED VOTERS TOTAL", "BALLOTS CAST TOTAL", "BALLOTS CAST BLANK", "Write-in", "OVER VOTES", "UNDER VOTES"]]

    print(f"Processing {race}")
    # Determine the winning candidate: candidate with the maximum votes across the candidate columns
    agg_df['Winning Candidate'] = agg_df[candidate_cols].idxmax(axis=1)
    
    # Extract the party from the winning candidate by splitting on spaces 
    # and taking the first token as the party abbreviation.
    agg_df['Winning Party'] = agg_df['Winning Candidate'].apply(
        lambda candidate: candidate.split()[0] if isinstance(candidate, str) and candidate.split() else None
    )

    # 5) Write the aggregated results to CSV
    # BUG [LOW]: Only replaces '/' and ' ', but commas, periods, and other special
    # characters remain which may cause issues on some file systems
    # FIX: Use regex: re.sub(r'[^\w\-]', '_', race)
    safe_race_name = race.replace('/', '_').replace(' ', '_')
    output_file = os.path.join(output_dir, f"{safe_race_name}.csv")
    # BUG [HIGH]: iloc[:-1] drops the LAST ROW of data!
    # If intentional (removing a total/summary row), add a comment explaining why.
    # Otherwise, remove iloc[:-1] to include all precincts.
    agg_df.iloc[:-1].to_csv(output_file, index=False)

print(f"Split + aggregated CSVs saved in: {output_dir}")